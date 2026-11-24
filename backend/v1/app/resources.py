"""
Entity declarations: fields, filters, search, sorting, access policy and business rules.

Each entity is declared once here; ``app.crud`` turns it into REST endpoints.
"""

from __future__ import annotations

import re
from datetime import UTC, datetime
from decimal import Decimal

from psycopg import sql

from app import db
from app.auth import check_password_policy
from app.config import get_setting
from app.crud import Filter, Resource, WriteContext
from app.http import Forbidden, NotFound, Request, ValidationFailed
from app.passwords import hash_password
from app.rbac import (
    ADMIN,
    ALL_ACTIONS,
    PROJECT_MANAGER,
    READ,
    ROLES,
    TEAM_LEAD,
    TEAM_MEMBER,
    UPDATE,
    VIEWER,
    Policy,
    Scope,
    User,
    has_role,
    is_admin,
)
from app.validation import Field

PROJECT_STATUSES = ("planning", "active", "on_hold", "completed", "cancelled")
DELIVERABLE_STATUSES = ("not_started", "in_progress", "blocked", "completed")
PRIORITIES = ("low", "medium", "high", "critical")
VISIBILITIES = ("inherit", "everyone", "members")

PROJECT_KEY_RE = re.compile(r"^[A-Z][A-Z0-9]{2,5}$")
DELIVERABLE_KEY_RE = re.compile(r"^([A-Za-z][A-Za-z0-9]{2,5})-([0-9]{1,9})$")

# Business logic works on status categories, so custom statuses can map onto them later.
DELIVERABLE_STATUS_CATEGORY = {"not_started": "todo", "in_progress": "active", "blocked": "blocked",
                               "completed": "done"}


def _now() -> datetime:
    return datetime.now(UTC)


# ---------------------------------------------------------------------------
# Shared rules
# ---------------------------------------------------------------------------

def project_visibility(alias: str, user: User) -> Scope:
    """Rows of project ``alias`` the user may see. Admins and project managers see all projects;
    others see projects visible to everyone, plus projects they manage or own deliverables in."""
    if has_role(user, ADMIN, PROJECT_MANAGER):
        return None
    condition = sql.SQL(
        "(CASE {a}.visibility WHEN 'inherit' THEN %s ELSE {a}.visibility END) = 'everyone'"
        " OR {a}.manager_id = %s"
        " OR EXISTS (SELECT 1 FROM deliverables vd WHERE vd.project_id = {a}.id AND vd.owner_id = %s)"
    ).format(a=sql.Identifier(alias))
    return condition, [get_setting("projects.default_visibility"), user["id"], user["id"]]


def _date_order(ctx: WriteContext, start: str, end: str) -> None:
    merged = ctx.merged
    if merged.get(start) and merged.get(end) and merged[end] < merged[start]:
        raise ValidationFailed({end: f"must be on or after {start}"})


def _require_user(user_id: int, field: str, roles: tuple[str, ...], message: str) -> None:
    row = db.fetch_one("SELECT role, is_active FROM users WHERE id = %s", (user_id,))
    if row is None or not row["is_active"] or row["role"] not in roles:
        raise ValidationFailed({field: message})


def _manages_project(user: User, project_id: int) -> bool:
    row = db.fetch_one("SELECT manager_id FROM projects WHERE id = %s", (project_id,))
    return row is not None and row["manager_id"] == user["id"]


# ---------------------------------------------------------------------------
# Users (people + accounts)
# ---------------------------------------------------------------------------

def _users_before_write(ctx: WriteContext) -> None:
    values, existing = ctx.values, ctx.existing
    if "password" in values:
        check_password_policy(values["password"])
        values["password_hash"] = hash_password(values.pop("password"))
    if existing is None:
        values.setdefault("weekly_capacity_hours", Decimal(get_setting("capacity.default_weekly_hours")))
        return
    # Admins cannot demote, deactivate or delete themselves. Since every request comes from an
    # active admin, this alone guarantees at least one active admin always remains.
    if existing["id"] == ctx.user["id"]:
        if ctx.changed("role"):
            raise ValidationFailed({"role": "you cannot change your own role"})
        if values.get("is_active") is False:
            raise ValidationFailed({"is_active": "you cannot deactivate your own account"})
    if ctx.changed("role") or ctx.changed("is_active") or "password_hash" in values:
        values["token_version"] = existing["token_version"] + 1  # sign the user out everywhere


def _users_before_delete(request: Request, record: dict) -> None:
    if record["id"] == request.user["id"]:
        raise ValidationFailed({"id": "you cannot delete your own account"})


USERS = Resource(
    name="users",
    table="users",
    fields={
        "email": Field("email", required=True, nullable=False, max_len=255),
        "name": Field("string", required=True, nullable=False, max_len=200),
        "role": Field("enum", nullable=False, choices=ROLES),
        "job_title": Field("string", max_len=100),
        "weekly_capacity_hours": Field("decimal", nullable=False, minimum=Decimal(0), maximum=Decimal(168)),
        "is_active": Field("boolean", nullable=False),
        "password": Field("string", nullable=False, max_len=128),
    },
    policy=Policy(),
    select="t.*, (t.password_hash IS NOT NULL) AS can_login",
    filters={
        "role": Filter("t.role", "enum", multi=True, choices=ROLES),
        "is_active": Filter("t.is_active", "boolean"),
    },
    search=("t.name", "t.email", "t.job_title"),
    sorts={"name": "t.name", "email": "t.email", "role": "t.role", "created_at": "t.created_at",
           "last_login_at": "t.last_login_at"},
    default_sort="name",
    hidden=("password_hash", "token_version"),
    before_write=_users_before_write,
    before_delete=_users_before_delete,
)


# ---------------------------------------------------------------------------
# Departments
# ---------------------------------------------------------------------------

def _departments_before_write(ctx: WriteContext) -> None:
    if ctx.values.get("code"):
        ctx.values["code"] = ctx.values["code"].upper()


DEPARTMENTS = Resource(
    name="departments",
    table="departments",
    fields={
        "name": Field("string", required=True, nullable=False, max_len=100),
        "code": Field("string", required=True, nullable=False, max_len=10),
        "description": Field("string", max_len=2000),
    },
    policy=Policy(),
    select="t.*, (SELECT count(*) FROM projects dp WHERE dp.department_id = t.id) AS project_count",
    search=("t.name", "t.code"),
    sorts={"name": "t.name", "code": "t.code"},
    default_sort="name",
    before_write=_departments_before_write,
)


# ---------------------------------------------------------------------------
# Projects
# ---------------------------------------------------------------------------

PROJECT_FIELDS = {
    "key": Field("string", required=True, nullable=False, max_len=6),
    "name": Field("string", required=True, nullable=False, max_len=200),
    "description": Field("string", max_len=5000),
    "department_id": Field("ref", required=True, nullable=False, ref="departments"),
    "manager_id": Field("ref", nullable=False, ref="users"),
    "status": Field("enum", nullable=False, choices=PROJECT_STATUSES),
    "priority": Field("enum", nullable=False, choices=PRIORITIES),
    "start_date": Field("date"),
    "end_date": Field("date"),
    "planned_budget": Field("decimal", nullable=False, minimum=Decimal(0), maximum=Decimal("999999999999")),
    "visibility": Field("enum", nullable=False, choices=VISIBILITIES),
}


class ProjectPolicy(Policy):
    """Admins: everything. Project managers: create, and change/delete projects they manage."""

    def actions(self, user: User) -> frozenset[str]:
        return ALL_ACTIONS if has_role(user, ADMIN, PROJECT_MANAGER) else frozenset({READ})

    def scope(self, user: User) -> Scope:
        return project_visibility("t", user)

    def check_create(self, user: User, values: dict) -> None:
        if not is_admin(user) and values.get("manager_id") != user["id"]:
            raise Forbidden("Project managers can only create projects they manage")

    def editable_fields(self, user: User, record: dict) -> frozenset[str] | None:
        # The key is fixed after creation: deliverable keys (ENG-12) are derived from it.
        if is_admin(user):
            return frozenset(PROJECT_FIELDS) - {"key"}
        if has_role(user, PROJECT_MANAGER) and record["manager_id"] == user["id"]:
            return frozenset(PROJECT_FIELDS) - {"key", "manager_id"}
        return frozenset()

    def can_delete(self, user: User, record: dict) -> bool:
        return is_admin(user) or (has_role(user, PROJECT_MANAGER) and record["manager_id"] == user["id"])


def _check_deliverables_within(project_id: int, start: object, end: object) -> None:
    """Reject project dates that would leave existing deliverables due outside the project."""
    outside = db.fetch_one(
        "SELECT count(*) FILTER (WHERE %(start)s::date IS NOT NULL AND due_date < %(start)s::date) AS before,"
        "       count(*) FILTER (WHERE %(end)s::date IS NOT NULL AND due_date > %(end)s::date) AS after"
        "  FROM deliverables WHERE project_id = %(project)s",
        {"start": start, "end": end, "project": project_id},
    )
    errors = {}
    if outside["before"]:
        errors["start_date"] = f"{outside['before']} deliverable(s) are due before this date; move them first"
    if outside["after"]:
        errors["end_date"] = f"{outside['after']} deliverable(s) are due after this date; move them first"
    if errors:
        raise ValidationFailed(errors)


def _projects_before_write(ctx: WriteContext) -> None:
    values = ctx.values
    if ctx.existing is None:
        values.setdefault("manager_id", ctx.user["id"])
    if "key" in values:
        values["key"] = values["key"].upper()
        if not PROJECT_KEY_RE.match(values["key"]):
            raise ValidationFailed({"key": "must be 3-6 letters or digits, starting with a letter (e.g. ENG, SRE)"})
    if ctx.changed("manager_id"):
        _require_user(values["manager_id"], "manager_id", (ADMIN, PROJECT_MANAGER),
                      "must be an active project manager or admin")
    _date_order(ctx, "start_date", "end_date")
    if ctx.existing is not None and (ctx.changed("start_date") or ctx.changed("end_date")):
        _check_deliverables_within(ctx.existing["id"], ctx.merged.get("start_date"), ctx.merged.get("end_date"))
    if ctx.changed("status"):
        values["completed_at"] = _now() if values["status"] == "completed" else None


def _resolve_project(raw: str) -> int:
    """``/projects/ENG`` → id of the project with key ENG."""
    row = db.fetch_one("SELECT id FROM projects WHERE key = %s", (raw.upper(),))
    if row is None:
        raise NotFound(f"projects {raw} not found")
    return row["id"]


_PROJECT_STATS = """
LEFT JOIN LATERAL (
    SELECT count(*) AS total,
           count(*) FILTER (WHERE x.status = 'completed') AS completed,
           count(*) FILTER (WHERE x.status = 'blocked') AS blocked,
           count(*) FILTER (WHERE x.due_date < current_date AND x.status <> 'completed') AS overdue,
           CASE WHEN bool_and(COALESCE(x.estimated_hours, 0) > 0)
                THEN sum(CASE WHEN x.status = 'completed' THEN 100 ELSE x.progress_pct END * x.estimated_hours)
                     / sum(x.estimated_hours)
                ELSE avg(CASE WHEN x.status = 'completed' THEN 100 ELSE x.progress_pct END)
           END AS progress
      FROM deliverables x WHERE x.project_id = t.id
) s ON true
"""

PROJECTS = Resource(
    name="projects",
    table="projects",
    fields=PROJECT_FIELDS,
    policy=ProjectPolicy(),
    select=(
        "t.*, d.name AS department_name, m.name AS manager_name,"
        " CASE t.visibility WHEN 'inherit' THEN NULL ELSE t.visibility END AS visibility_override,"
        " COALESCE(s.total, 0) AS deliverables_total, COALESCE(s.completed, 0) AS deliverables_completed,"
        " COALESCE(s.blocked, 0) AS deliverables_blocked, COALESCE(s.overdue, 0) AS deliverables_overdue,"
        " COALESCE(round(s.progress), 0)::int AS progress_pct"
    ),
    source=("projects t JOIN departments d ON d.id = t.department_id JOIN users m ON m.id = t.manager_id"
            + _PROJECT_STATS),
    filters={
        "status": Filter("t.status", "enum", multi=True, choices=PROJECT_STATUSES),
        "priority": Filter("t.priority", "enum", multi=True, choices=PRIORITIES),
        "department_id": Filter("t.department_id", "ref"),
        "manager_id": Filter("t.manager_id", "ref", me=True),
        "visibility": Filter("t.visibility", "enum", choices=VISIBILITIES),
        "start_from": Filter("t.start_date", "date", op=">="),
        "start_to": Filter("t.start_date", "date", op="<="),
        "end_from": Filter("t.end_date", "date", op=">="),
        "end_to": Filter("t.end_date", "date", op="<="),
    },
    search=("t.key", "t.name", "t.description"),
    sorts={"key": "t.key", "name": "t.name", "status": "t.status", "priority": "t.priority",
           "start_date": "t.start_date", "end_date": "t.end_date", "planned_budget": "t.planned_budget",
           "progress_pct": "s.progress", "department": "d.name", "manager": "m.name",
           "updated_at": "t.updated_at"},
    default_sort="key",
    hidden=("deliverable_seq",),
    before_write=_projects_before_write,
    resolve=_resolve_project,
)


# ---------------------------------------------------------------------------
# Deliverables
# ---------------------------------------------------------------------------

OWNER_EDITABLE = frozenset({"status", "progress_pct"})


class DeliverablePolicy(Policy):
    """Admins: everything. A project's manager: everything in it. Owners: status and progress."""

    def actions(self, user: User) -> frozenset[str]:
        if has_role(user, ADMIN, PROJECT_MANAGER):
            return ALL_ACTIONS
        if has_role(user, TEAM_LEAD, TEAM_MEMBER):
            return frozenset({READ, UPDATE})
        return frozenset({READ})

    def scope(self, user: User) -> Scope:
        return project_visibility("p", user)

    def check_create(self, user: User, values: dict) -> None:
        if not is_admin(user) and not _manages_project(user, values["project_id"]):
            raise Forbidden("Only the project's manager can add deliverables")

    def editable_fields(self, user: User, record: dict) -> frozenset[str] | None:
        if is_admin(user) or (has_role(user, PROJECT_MANAGER) and record["project_manager_id"] == user["id"]):
            return None
        if not has_role(user, VIEWER) and record["owner_id"] == user["id"]:
            return OWNER_EDITABLE
        return frozenset()

    def can_delete(self, user: User, record: dict) -> bool:
        return is_admin(user) or (has_role(user, PROJECT_MANAGER) and record["project_manager_id"] == user["id"])


def _check_due_within_project(project_id: int, due: object) -> None:
    """A deliverable must be due within its project's start and target end dates."""
    project = db.fetch_one("SELECT start_date, end_date FROM projects WHERE id = %s", (project_id,))
    if project["start_date"] and due < project["start_date"]:
        raise ValidationFailed({"due_date": f"must be on or after the project start date ({project['start_date']})"})
    if project["end_date"] and due > project["end_date"]:
        raise ValidationFailed({"due_date": f"must be on or before the project target end date "
                                            f"({project['end_date']})"})


def _next_number(project_id: int) -> int:
    """Allocate the next deliverable number in a project. The row lock taken by UPDATE serializes
    concurrent creators, so numbers are unique and never reused (even after deletes)."""
    return db.fetch_one(
        "UPDATE projects SET deliverable_seq = deliverable_seq + 1 WHERE id = %s RETURNING deliverable_seq",
        (project_id,),
    )["deliverable_seq"]


def _open_blockers(deliverable_id: int) -> list[str]:
    rows = db.fetch_all(
        "SELECT p.key || '-' || s.number AS key FROM deliverable_links l"
        "  JOIN deliverables s ON s.id = l.source_id JOIN projects p ON p.id = s.project_id"
        " WHERE l.type = 'blocks' AND l.target_id = %s AND s.status <> 'completed' ORDER BY 1",
        (deliverable_id,),
    )
    return [r["key"] for r in rows]


def _deliverables_before_write(ctx: WriteContext) -> None:
    values = ctx.values
    if ctx.existing is None:
        values["number"] = _next_number(values["project_id"])
        values.setdefault("reporter_id", ctx.user["id"])
    elif ctx.changed("project_id"):
        values["number"] = _next_number(values["project_id"])  # a moved deliverable gets a key in its new project
    if ctx.changed("reporter_id") and values["reporter_id"] is not None:
        _require_user(values["reporter_id"], "reporter_id", ROLES, "must be an active user")
    if ctx.existing is not None and ctx.changed("project_id") and not is_admin(ctx.user) \
            and not _manages_project(ctx.user, values["project_id"]):
        raise Forbidden("You can only move deliverables into projects you manage")
    if (ctx.changed("due_date") or ctx.changed("project_id")) and ctx.merged.get("due_date"):
        _check_due_within_project(ctx.merged["project_id"], ctx.merged["due_date"])
    if ctx.changed("owner_id") and values["owner_id"] is not None:
        _require_user(values["owner_id"], "owner_id", (ADMIN, PROJECT_MANAGER, TEAM_LEAD, TEAM_MEMBER),
                      "must be an active user who is not a viewer")
    if ctx.existing is not None and ctx.changed("status") and values["status"] == "completed":
        blockers = _open_blockers(ctx.existing["id"])
        if blockers:
            raise ValidationFailed({"status": f"cannot complete while blocked by {', '.join(blockers)}"})
    if ctx.existing is None or ctx.changed("status"):
        if ctx.merged.get("status") == "completed":
            values["progress_pct"] = 100
            values["completed_at"] = _now()
        elif ctx.existing is not None:
            values["completed_at"] = None

def resolve_deliverable(raw: str) -> int:
    """``ENG-12`` (case-insensitive) → deliverable id."""
    match = DELIVERABLE_KEY_RE.match(raw)
    row = match and db.fetch_one(
        "SELECT d.id FROM deliverables d JOIN projects p ON p.id = d.project_id WHERE p.key = %s AND d.number = %s",
        (match.group(1).upper(), int(match.group(2))),
    )
    if not row:
        raise NotFound(f"deliverables {raw} not found")
    return row["id"]


DELIVERABLES = Resource(
    name="deliverables",
    table="deliverables",
    fields={
        "project_id": Field("ref", required=True, nullable=False, ref="projects"),
        "name": Field("string", required=True, nullable=False, max_len=200),
        "description": Field("string", max_len=10000),
        "acceptance_criteria": Field("string", max_len=10000),
        "owner_id": Field("ref", ref="users"),
        "reporter_id": Field("ref", ref="users"),
        "status": Field("enum", nullable=False, choices=DELIVERABLE_STATUSES),
        "priority": Field("enum", nullable=False, choices=PRIORITIES),
        "due_date": Field("date"),
        "estimated_hours": Field("decimal", minimum=Decimal(0), maximum=Decimal(100000)),
        "progress_pct": Field("integer", nullable=False, minimum=Decimal(0), maximum=Decimal(100)),
    },
    policy=DeliverablePolicy(),
    select=(
        "t.*, p.key || '-' || t.number AS key, p.key AS project_key, p.name AS project_name,"
        " p.manager_id AS project_manager_id, p.start_date AS project_start_date, p.end_date AS project_end_date,"
        " o.name AS owner_name, r.name AS reporter_name,"
        " (t.due_date < current_date AND t.status <> 'completed') AS is_overdue"
    ),
    source=("deliverables t JOIN projects p ON p.id = t.project_id"
            " LEFT JOIN users o ON o.id = t.owner_id LEFT JOIN users r ON r.id = t.reporter_id"),
    filters={
        "project_id": Filter("t.project_id", "ref"),
        "owner_id": Filter("t.owner_id", "ref", me=True),
        "reporter_id": Filter("t.reporter_id", "ref", me=True),
        "status": Filter("t.status", "enum", multi=True, choices=DELIVERABLE_STATUSES),
        "priority": Filter("t.priority", "enum", multi=True, choices=PRIORITIES),
        "due_from": Filter("t.due_date", "date", op=">="),
        "due_to": Filter("t.due_date", "date", op="<="),
        "overdue": Filter("t.due_date", predicate="t.due_date < current_date AND t.status <> 'completed'"),
    },
    search=("p.key || '-' || t.number", "t.name", "t.description", "p.name"),
    sorts={"key": "p.key || '-' || lpad(t.number::text, 9, '0')", "name": "t.name", "status": "t.status",
           "priority": "t.priority", "due_date": "t.due_date",
           "progress_pct": "t.progress_pct", "project": "p.key", "owner": "o.name",
           "updated_at": "t.updated_at"},
    default_sort="due_date",
    before_write=_deliverables_before_write,
    resolve=resolve_deliverable,
)



RESOURCES: tuple[Resource, ...] = (USERS, DEPARTMENTS, PROJECTS, DELIVERABLES)


def capabilities(user: User) -> dict[str, list[str]]:
    """Role-level actions per resource, for the UI's navigation and buttons."""
    caps = {r.name: sorted(r.policy.actions(user)) for r in RESOURCES}
    if is_admin(user):
        caps["settings"] = ["read", "update"]
        caps["audit_log"] = ["read"]
    return caps
