"""
Generic CRUD engine.

An entity is declared once as a ``Resource`` (fields, filters, search, sorting, policy, rules);
the five REST endpoints are derived from it. SQL fragments in a ``Resource`` are code constants;
every client-supplied value is passed as a query parameter.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field

from psycopg import sql

from app import audit, db
from app.config import get_setting
from app.http import Forbidden, NotFound, Request, Router, ValidationFailed, created, no_content, ok
from app.rbac import CREATE, DELETE, READ, UPDATE, Policy
from app.validation import Field, coerce, parse_id, validate_fields


@dataclass(frozen=True)
class Filter:
    """A query-string filter. ``column`` is a SQL expression over the resource's ``source``."""

    column: str
    kind: str = "string"
    op: str = "="  # "=", ">=", "<="
    multi: bool = False  # comma-separated values match any (IN)
    choices: tuple = ()
    me: bool = False  # the value "me" means the current user's id
    predicate: str | None = None  # boolean filter: condition applied for true, negated for false


@dataclass
class WriteContext:
    """Passed to ``before_write`` hooks. Hooks may add/modify ``values`` (what gets written)."""

    request: Request
    values: dict
    existing: dict | None = None

    @property
    def user(self) -> dict:
        """The acting user."""
        return self.request.user

    @property
    def merged(self) -> dict:
        """The record as it will look after the write."""
        return {**(self.existing or {}), **self.values}

    def changed(self, name: str) -> bool:
        """True when ``name`` is being set to a different value."""
        return name in self.values and (self.existing is None or self.existing.get(name) != self.values[name])


@dataclass(frozen=True)
class Resource:  # pylint: disable=too-many-instance-attributes
    """Declarative description of one REST collection backed by one table (alias ``t``)."""

    name: str  # URL segment, e.g. "projects"
    table: str
    fields: dict[str, Field]
    policy: Policy
    select: str = "t.*"
    source: str = ""  # FROM clause; defaults to "<table> t"
    filters: dict[str, Filter] = field(default_factory=dict)
    search: tuple[str, ...] = ()
    sorts: dict[str, str] = field(default_factory=dict)
    default_sort: str = "id"
    hidden: tuple[str, ...] = ()
    before_write: Callable[[WriteContext], None] | None = None
    before_delete: Callable[[Request, dict], None] | None = None
    resolve: Callable[[str], int] | None = None  # maps a path segment (e.g. a key like ENG-12) to an id

    @property
    def from_sql(self) -> sql.Composable:
        """The FROM clause."""
        return sql.SQL(self.source or f"{self.table} t")


# ---------------------------------------------------------------------------
# Query building
# ---------------------------------------------------------------------------

def _escape_like(text: str) -> str:
    return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _filter_condition(spec: Filter, name: str, raw: str, user: dict) -> tuple[sql.Composable, list]:
    column = sql.SQL(spec.column)
    if spec.predicate:
        wanted = coerce(Field("boolean"), raw)
        condition = sql.SQL(spec.predicate)
        return (condition if wanted else sql.SQL("NOT ({})").format(condition)), []
    values = [v.strip() for v in raw.split(",")] if spec.multi else [raw]
    parsed = []
    for value in values:
        if spec.me and value == "me":
            parsed.append(user["id"])
        else:
            parsed.append(coerce(Field(spec.kind, choices=spec.choices, nullable=False), value))
    if spec.multi:
        return sql.SQL("{} = ANY(%s)").format(column), [parsed]
    if spec.op not in ("=", ">=", "<="):
        raise ValueError(f"unsupported operator for filter {name}")
    return sql.SQL("{} {} %s").format(column, sql.SQL(spec.op)), parsed


def _paging(query: dict) -> tuple[int, int, dict]:
    errors = {}
    limit = get_setting("api.default_page_size")
    offset = 0
    maximum = get_setting("api.max_page_size")
    if "limit" in query:
        try:
            limit = int(query["limit"])
            if not 1 <= limit <= maximum:
                raise ValueError
        except ValueError:
            errors["limit"] = f"must be an integer between 1 and {maximum}"
    if "offset" in query:
        try:
            offset = int(query["offset"])
            if offset < 0:
                raise ValueError
        except ValueError:
            errors["offset"] = "must be a non-negative integer"
    return limit, offset, errors


def _order_by(resource: Resource, raw: str | None) -> sql.Composable:
    parts = []
    for item in (raw or resource.default_sort).split(","):
        item = item.strip()
        descending = item.startswith("-")
        key = item.lstrip("-")
        expr = resource.sorts.get(key) or ("t.id" if key == "id" else None)
        if expr is None:
            allowed = ", ".join(sorted({*resource.sorts, "id"}))
            raise ValidationFailed({"sort": f"cannot sort by '{key}'; allowed: {allowed}"})
        parts.append(sql.SQL("{} {} NULLS LAST").format(sql.SQL(expr), sql.SQL("DESC" if descending else "ASC")))
    parts.append(sql.SQL("t.id ASC"))
    return sql.SQL(", ").join(parts)


def _where(resource: Resource, user: dict, query: dict) -> tuple[sql.Composable, list]:
    conditions: list[sql.Composable] = []
    params: list = []
    errors: dict = {}
    for key, raw in query.items():
        if key in ("limit", "offset", "sort"):
            continue
        if key == "q":
            text = raw.strip()
            if text and resource.search:
                like = f"%{_escape_like(text)}%"
                conditions.append(sql.SQL("({})").format(sql.SQL(" OR ").join(
                    sql.SQL("{} ILIKE %s").format(sql.SQL(col)) for col in resource.search)))
                params += [like] * len(resource.search)
            continue
        spec = resource.filters.get(key)
        if spec is None:
            errors[key] = "is not a supported filter"
            continue
        try:
            condition, values = _filter_condition(spec, key, raw, user)
        except ValueError as exc:
            errors[key] = str(exc)
            continue
        conditions.append(condition)
        params += values
    if errors:
        raise ValidationFailed(errors)
    scope = resource.policy.scope(user)
    if scope is not None:
        conditions.append(sql.SQL("({})").format(scope[0]))
        params += scope[1]
    where = sql.SQL(" WHERE ") + sql.SQL(" AND ").join(conditions) if conditions else sql.SQL("")
    return where, params


# ---------------------------------------------------------------------------
# Representation
# ---------------------------------------------------------------------------

def represent(resource: Resource, user: dict, row: dict) -> dict:
    """Public shape of a row: hidden columns removed, per-record permissions added."""
    body = {k: v for k, v in row.items() if k not in resource.hidden}
    body["permissions"] = resource.policy.record_permissions(user, row)
    return body


def fetch(resource: Resource, user: dict, record_id: int) -> dict:
    """Load one visible row (raw, including hidden columns) or raise 404."""
    scope = resource.policy.scope(user)
    where = sql.SQL("t.id = %s")
    params: list = [record_id]
    if scope is not None:
        where = sql.SQL("{} AND ({})").format(where, scope[0])
        params += scope[1]
    row = db.fetch_one(
        sql.SQL("SELECT {} FROM {} WHERE {}").format(sql.SQL(resource.select), resource.from_sql, where), params)
    if row is None:
        raise NotFound(f"{resource.name} {record_id} not found")
    return row


def check_references(fields: dict[str, Field], values: dict) -> None:
    """Return field-level 400s for ids that do not exist (instead of a generic FK error)."""
    errors = {}
    for name, value in values.items():
        spec = fields.get(name)
        if spec is None or spec.kind != "ref" or spec.ref is None or value is None:
            continue
        query = sql.SQL("SELECT 1 AS ok FROM {} WHERE id = %s").format(sql.Identifier(spec.ref))
        if db.fetch_one(query, (value,)) is None:
            errors[name] = f"{spec.ref} {value} does not exist"
    if errors:
        raise ValidationFailed(errors)


# ---------------------------------------------------------------------------
# Operations
# ---------------------------------------------------------------------------

def list_records(resource: Resource, request: Request) -> dict:
    """GET /<resource>: filtered, searched, sorted and paginated list."""
    user = request.user
    resource.policy.require(user, READ)
    query = dict(request.query)
    limit, offset, errors = _paging(query)
    if errors:
        raise ValidationFailed(errors)
    order = _order_by(resource, query.get("sort"))
    where, params = _where(resource, user, query)
    total = db.fetch_one(sql.SQL("SELECT count(*) AS n FROM {}{}").format(resource.from_sql, where), params)["n"]
    rows = db.fetch_all(
        sql.SQL("SELECT {} FROM {}{} ORDER BY {} LIMIT %s OFFSET %s").format(
            sql.SQL(resource.select), resource.from_sql, where, order),
        [*params, limit, offset],
    )
    return ok({"data": [represent(resource, user, r) for r in rows], "total": total, "limit": limit, "offset": offset})


def record_id_from(resource: Resource, raw: str) -> int:
    """The id for path segment ``raw``: a numeric id, or whatever ``resource.resolve`` accepts."""
    if resource.resolve and not raw.isdigit():
        return resource.resolve(raw)
    return parse_id(raw)


def get_record(resource: Resource, request: Request) -> dict:
    """GET /<resource>/{id}."""
    resource.policy.require(request.user, READ)
    row = fetch(resource, request.user, record_id_from(resource, request.params["id"]))
    return ok(represent(resource, request.user, row))


def _write(resource: Resource, values: dict, record_id: int | None = None) -> int:
    columns = list(values)
    if record_id is None:
        query = sql.SQL("INSERT INTO {} ({}) VALUES ({}) RETURNING id").format(
            sql.Identifier(resource.table),
            sql.SQL(", ").join(map(sql.Identifier, columns)),
            sql.SQL(", ").join(sql.Placeholder() * len(columns)),
        )
        return db.fetch_one(query, [values[c] for c in columns])["id"]
    assignments = [sql.SQL("{} = %s").format(sql.Identifier(c)) for c in columns]
    assignments.append(sql.SQL("updated_at = now()"))
    query = sql.SQL("UPDATE {} SET {} WHERE id = %s").format(sql.Identifier(resource.table),
                                                           sql.SQL(", ").join(assignments))
    db.execute(query, [*(values[c] for c in columns), record_id])
    return record_id


def create_record(resource: Resource, request: Request) -> dict:
    """POST /<resource>."""
    user = request.user
    resource.policy.require(user, CREATE)
    values = validate_fields(resource.fields, request.body)
    check_references(resource.fields, values)
    ctx = WriteContext(request, values)
    if resource.before_write:
        resource.before_write(ctx)
    resource.policy.check_create(user, ctx.values)
    record_id = _write(resource, ctx.values)
    audit.record(request, "create", resource.table, record_id, {"after": ctx.values})
    return created(represent(resource, user, fetch(resource, user, record_id)))


def update_record(resource: Resource, request: Request) -> dict:
    """PUT /<resource>/{id}: partial update."""
    user = request.user
    resource.policy.require(user, UPDATE)
    record_id = record_id_from(resource, request.params["id"])
    existing = fetch(resource, user, record_id)
    values = validate_fields(resource.fields, request.body, partial=True)
    resource.policy.check_update(user, existing, values)
    check_references(resource.fields, values)
    ctx = WriteContext(request, values, existing)
    if resource.before_write:
        resource.before_write(ctx)
    changes = audit.diff(existing, ctx.values)
    if changes:
        _write(resource, {k: ctx.values[k] for k in changes}, record_id)
        audit.record(request, "update", resource.table, record_id, changes)
    return ok(represent(resource, user, fetch(resource, user, record_id)))


def delete_record(resource: Resource, request: Request) -> dict:
    """DELETE /<resource>/{id}."""
    user = request.user
    resource.policy.require(user, DELETE)
    record_id = record_id_from(resource, request.params["id"])
    existing = fetch(resource, user, record_id)
    if not resource.policy.can_delete(user, existing):
        raise Forbidden()
    if resource.before_delete:
        resource.before_delete(request, existing)
    db.execute(sql.SQL("DELETE FROM {} WHERE id = %s").format(sql.Identifier(resource.table)), (record_id,))
    audit.record(request, "delete", resource.table, record_id,
                 {"before": {k: v for k, v in existing.items() if k not in resource.hidden}})
    return no_content()


def register(router: Router, resource: Resource) -> None:
    """Add the five CRUD routes for ``resource``."""
    base = f"/{resource.name}"
    router.add("GET", base, lambda r: list_records(resource, r))
    router.add("POST", base, lambda r: create_record(resource, r))
    router.add("GET", base + "/{id}", lambda r: get_record(resource, r))
    router.add("PUT", base + "/{id}", lambda r: update_record(resource, r))
    router.add("DELETE", base + "/{id}", lambda r: delete_record(resource, r))

