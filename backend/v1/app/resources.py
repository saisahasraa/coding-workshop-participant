"""
Entity declarations: fields, filters, search, sorting, access policy and business rules.

Each entity is declared once here; ``app.crud`` turns it into REST endpoints.
"""

from __future__ import annotations

import re
from datetime import UTC, datetime
from decimal import Decimal

from psycopg import sql

from app import audit, db, health
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
    """Rows of project ``alias`` the user may see. Admins and project managers see all projects; others see
    projects visible to everyone, plus projects they are a member of (they manage it or own a deliverable in it)."""
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
    _check_user_can_step_back(ctx)
    if ctx.changed("role") or ctx.changed("is_active") or "password_hash" in values:
        values["token_version"] = existing["token_version"] + 1  # sign the user out everywhere


def _check_user_can_step_back(ctx: WriteContext) -> None:
    """Deactivating or demoting someone must not strand what they hold.

    People who own unfinished work stay assignable; managers keep no open projects; a team loses its lead
    when its lead is no longer one.
    """
    values, user_id = ctx.values, ctx.existing["id"]
    deactivated = ctx.changed("is_active") and values["is_active"] is False
    role = values.get("role", ctx.existing["role"])
    field = "is_active" if deactivated else "role"
    if deactivated or (ctx.changed("role") and role == VIEWER):
        owned = db.fetch_one("SELECT count(*) AS n FROM deliverables WHERE owner_id = %s AND status <> 'completed'",
                             (user_id,))["n"]
        if owned:
            raise ValidationFailed({field: f"owns {owned} unfinished deliverable(s); reassign them first"})
    if deactivated or (ctx.changed("role") and role not in (ADMIN, PROJECT_MANAGER)):
        managed = db.fetch_one("SELECT count(*) AS n FROM projects WHERE manager_id = %s"
                               " AND status NOT IN ('completed', 'cancelled')", (user_id,))["n"]
        if managed:
            raise ValidationFailed({field: f"manages {managed} open project(s); assign another manager first"})
    if deactivated or (ctx.changed("role") and role != TEAM_LEAD):
        for team in db.fetch_all("UPDATE teams SET lead_id = NULL, updated_at = now() WHERE lead_id = %s"
                                 " RETURNING id", (user_id,)):
            audit.record(ctx.request, "update", "teams", team["id"], {"lead_id": {"from": user_id, "to": None}})


def _users_before_delete(request: Request, record: dict) -> None:
    if record["id"] == request.user["id"]:
        raise ValidationFailed({"id": "you cannot delete your own account"})


class UserPolicy(Policy):
    """Admins manage accounts. Team leads may change the weekly capacity of their own team's members."""

    def actions(self, user: User) -> frozenset[str]:
        if is_admin(user):
            return ALL_ACTIONS
        return frozenset({READ, UPDATE}) if has_role(user, TEAM_LEAD) else frozenset({READ})

    def editable_fields(self, user: User, record: dict) -> frozenset[str] | None:
        if is_admin(user):
            return None
        if has_role(user, TEAM_LEAD) and record.get("team_lead_id") == user["id"]:
            return frozenset({"weekly_capacity_hours"})
        return frozenset()


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
        "team_id": Field("ref", ref="teams"),
        "password": Field("string", nullable=False, max_len=128),
    },
    policy=UserPolicy(),
    select=("t.*, (t.password_hash IS NOT NULL) AS can_login, tm.name AS team_name, tm.lead_id AS team_lead_id,"
            " td.name AS department_name"),
    source=("users t LEFT JOIN teams tm ON tm.id = t.team_id"
            " LEFT JOIN departments td ON td.id = tm.department_id"),
    filters={
        "role": Filter("t.role", "enum", multi=True, choices=ROLES),
        "is_active": Filter("t.is_active", "boolean"),
        "team_id": Filter("t.team_id", "ref"),
        "department_id": Filter("tm.department_id", "ref"),
    },
    search=("t.name", "t.email", "t.job_title"),
    sorts={"name": "t.name", "email": "t.email", "role": "t.role", "created_at": "t.created_at",
           "last_login_at": "t.last_login_at", "team": "tm.name"},
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
        if values["status"] == "completed" and ctx.existing is not None:
            open_count = db.fetch_one("SELECT count(*) AS n FROM deliverables WHERE project_id = %s"
                                      " AND status <> 'completed'", (ctx.existing["id"],))["n"]
            if open_count:
                raise ValidationFailed({"status": f"cannot complete the project: {open_count} deliverable(s) "
                                                  "are not completed yet"})
        values["completed_at"] = _now() if values["status"] == "completed" else None


def _projects_before_delete(request: Request, record: dict) -> None:
    """Deleting a project frees work in other projects that its deliverables were blocking."""
    rows = db.fetch_all(
        "SELECT DISTINCT l.target_id FROM deliverable_links l JOIN deliverables s ON s.id = l.source_id"
        " JOIN deliverables t ON t.id = l.target_id WHERE l.type = 'blocks' AND s.project_id = %s"
        " AND t.project_id <> %s", (record["id"], record["id"]))
    db.execute("DELETE FROM deliverable_links WHERE source_id IN (SELECT id FROM deliverables WHERE project_id = %s)",
               (record["id"],))
    release_unblocked(request, [r["target_id"] for r in rows])


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
           max(current_date - x.due_date) FILTER (WHERE x.due_date < current_date AND x.status <> 'completed')
               AS max_overdue_days,
           CASE WHEN bool_and(COALESCE(x.estimated_hours, 0) > 0)
                THEN sum(CASE WHEN x.status = 'completed' THEN 100 ELSE x.progress_pct END * x.estimated_hours)
                     / sum(x.estimated_hours)
                ELSE avg(CASE WHEN x.status = 'completed' THEN 100 ELSE x.progress_pct END)
           END AS progress
      FROM deliverables x WHERE x.project_id = t.id
) s ON true
LEFT JOIN LATERAL (SELECT sum(amount) AS spent FROM expenses WHERE project_id = t.id) e ON true
"""


def _project_ids_with_health(levels: list[str], user: User) -> list[int]:
    """Ids of the visible projects whose health is one of ``levels`` (health is computed in Python)."""
    scope = project_visibility("t", user)
    query = sql.SQL("SELECT {} FROM {}").format(sql.SQL(PROJECTS.select), sql.SQL(PROJECTS.source))
    params: list = []
    if scope is not None:
        query += sql.SQL(" WHERE ({})").format(scope[0])
        params = scope[1]
    return [row["id"] for row in db.fetch_all(query, params) if health.computed_fields(row)["health"] in levels]

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
        " COALESCE(round(s.progress), 0)::int AS progress_pct, COALESCE(s.max_overdue_days, 0) AS max_overdue_days,"
        " COALESCE(e.spent, 0) AS budget_spent"
    ),
    source=("projects t JOIN departments d ON d.id = t.department_id JOIN users m ON m.id = t.manager_id"
            + _PROJECT_STATS),
    filters={
        "status": Filter("t.status", "enum", multi=True, choices=PROJECT_STATUSES),
        "priority": Filter("t.priority", "enum", multi=True, choices=PRIORITIES),
        "department_id": Filter("t.department_id", "ref"),
        "manager_id": Filter("t.manager_id", "ref", me=True),
        "visibility": Filter("t.visibility", "enum", choices=VISIBILITIES),
        "health": Filter("t.id", "enum", multi=True, choices=health.LEVELS, ids=_project_ids_with_health),
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
    hidden=("deliverable_seq", "max_overdue_days"),
    before_write=_projects_before_write,
    before_delete=_projects_before_delete,
    resolve=_resolve_project,
    computed=health.computed_fields,
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


def _reconcile_progress(ctx: WriteContext) -> None:
    """Keep status and progress telling the same story.

    Progress on work that has not started starts it; lowering the progress of completed work reopens it;
    moving work back to "not started" resets its progress.
    """
    values, merged = ctx.values, ctx.merged
    status, progress = merged.get("status", "not_started"), merged.get("progress_pct", 0)
    if status == "completed":
        if "progress_pct" in values and "status" not in values and progress < 100 and ctx.existing is not None:
            values["status"] = "in_progress"
    elif status == "not_started":
        if "progress_pct" in values and progress > 0:
            values["status"] = "in_progress"
        elif "status" in values and ctx.existing is not None:
            values["progress_pct"] = 0


def _require_open_project(project_id: int) -> None:
    """New work cannot be added to a project that is finished or cancelled."""
    row = db.fetch_one("SELECT status FROM projects WHERE id = %s", (project_id,))
    if row["status"] in ("completed", "cancelled"):
        raise ValidationFailed({"project_id": f"the project is {row['status']}; reopen it to add or move work here"})


def _deliverables_before_write(ctx: WriteContext) -> None:
    values = ctx.values
    if ctx.existing is None or ctx.changed("project_id"):
        _require_open_project(ctx.merged["project_id"])
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
    _reconcile_progress(ctx)
    verbs = {"completed": "complete", "in_progress": "start"}
    if ctx.existing is not None and ctx.changed("status") and values["status"] in verbs:
        blockers = _open_blockers(ctx.existing["id"])
        if blockers:
            raise ValidationFailed({"status": f"cannot {verbs[values['status']]} while blocked by "
                                              f"{', '.join(blockers)}"})
    if ctx.existing is None or ctx.changed("status"):
        if ctx.merged.get("status") == "completed":
            values["progress_pct"] = 100
            values["completed_at"] = _now()
        elif ctx.existing is not None:
            values["completed_at"] = None

_OPEN_BLOCKER = ("EXISTS (SELECT 1 FROM deliverable_links l JOIN deliverables s ON s.id = l.source_id"
                 " WHERE l.type = 'blocks' AND l.target_id = d.id AND s.status <> 'completed')")


def _move(request: Request, rows: list[dict], before: str) -> None:
    for row in rows:
        audit.record(request, "update", "deliverables", row["id"], {"status": {"from": before, "to": row["status"]}})


def release_unblocked(request: Request, target_ids: list[int]) -> None:
    """Move deliverables marked blocked back to work once nothing unfinished blocks them any more."""
    query = sql.SQL(
        "UPDATE deliverables d SET status = CASE WHEN d.progress_pct > 0 THEN 'in_progress' ELSE 'not_started' END,"
        " updated_at = now() WHERE d.id = ANY(%s) AND d.status = 'blocked' AND NOT {open}"
        " RETURNING d.id, d.status").format(open=sql.SQL(_OPEN_BLOCKER))
    _move(request, db.fetch_all(query, (target_ids,)), "blocked")


def block_waiting(request: Request, target_ids: list[int]) -> None:
    """Mark deliverables that are waiting on unfinished work as blocked (finished work is left alone)."""
    query = sql.SQL(
        "UPDATE deliverables d SET status = 'blocked', updated_at = now()"
        " WHERE d.id = ANY(%s) AND d.status IN ('not_started', 'in_progress') AND {open}"
        " RETURNING d.id, d.status").format(open=sql.SQL(_OPEN_BLOCKER))
    for row in db.fetch_all(query, (target_ids,)):
        audit.record(request, "update", "deliverables", row["id"], {"status": {"from": "waiting", "to": "blocked"}})


def _blocked_by(deliverable_id: int) -> list[int]:
    """Ids of the deliverables that ``deliverable_id`` blocks."""
    rows = db.fetch_all("SELECT target_id FROM deliverable_links WHERE type = 'blocks' AND source_id = %s",
                        (deliverable_id,))
    return [r["target_id"] for r in rows]


def _deliverables_after_write(ctx: WriteContext, record_id: int) -> None:
    """Dependents follow their blockers: finishing one releases the work it held up, reopening it blocks that
    work again."""
    if not ctx.changed("status"):
        return
    if ctx.values["status"] == "completed":
        release_unblocked(ctx.request, _blocked_by(record_id))
    elif ctx.existing["status"] == "completed":
        block_waiting(ctx.request, _blocked_by(record_id))


def _deliverables_before_delete(request: Request, record: dict) -> None:
    """Deleting a blocker frees the work it was holding up (the links go with it)."""
    targets = _blocked_by(record["id"])
    db.execute("DELETE FROM deliverable_links WHERE source_id = %s", (record["id"],))
    release_unblocked(request, targets)


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
        " (t.due_date < current_date AND t.status <> 'completed') AS is_overdue,"
        " (SELECT count(*) FROM deliverable_links bl JOIN deliverables bs ON bs.id = bl.source_id"
        "   WHERE bl.type = 'blocks' AND bl.target_id = t.id AND bs.status <> 'completed') AS open_blockers"
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
    after_write=_deliverables_after_write,
    before_delete=_deliverables_before_delete,
    resolve=resolve_deliverable,
)



# ---------------------------------------------------------------------------
# Teams
# ---------------------------------------------------------------------------

def _teams_before_write(ctx: WriteContext) -> None:
    if ctx.changed("lead_id") and ctx.values["lead_id"] is not None:
        _require_user(ctx.values["lead_id"], "lead_id", (TEAM_LEAD,), "must be an active user with the team lead role")


TEAMS = Resource(
    name="teams",
    table="teams",
    fields={
        "department_id": Field("ref", required=True, nullable=False, ref="departments"),
        "name": Field("string", required=True, nullable=False, max_len=100),
        "lead_id": Field("ref", ref="users"),
    },
    policy=Policy(),
    select=("t.*, d.name AS department_name, l.name AS lead_name,"
            " (SELECT count(*) FROM users m WHERE m.team_id = t.id) AS member_count"),
    source=("teams t JOIN departments d ON d.id = t.department_id LEFT JOIN users l ON l.id = t.lead_id"),
    filters={
        "department_id": Filter("t.department_id", "ref"),
        "lead_id": Filter("t.lead_id", "ref", me=True),
    },
    search=("t.name", "d.name", "l.name"),
    sorts={"name": "t.name", "department": "d.name", "lead": "l.name"},
    default_sort="name",
    before_write=_teams_before_write,
)


def _leads_team_of(user: User, member_id: int) -> bool:
    """Whether ``user`` is a team lead of the team ``member_id`` belongs to."""
    if not has_role(user, TEAM_LEAD):
        return False
    row = db.fetch_one(
        "SELECT 1 AS ok FROM users u JOIN teams t ON t.id = u.team_id WHERE u.id = %s AND t.lead_id = %s",
        (member_id, user["id"]),
    )
    return row is not None


def _is_lead_of_record(user: User, record: dict) -> bool:
    return has_role(user, TEAM_LEAD) and record.get("team_lead_id") == user["id"]


# ---------------------------------------------------------------------------
# Leave
# ---------------------------------------------------------------------------

LEAVE_FIELDS = {
    "user_id": Field("ref", nullable=False, ref="users"),  # defaults to the person recording it
    "type": Field("string", required=True, nullable=False, max_len=30),
    "start_date": Field("date", required=True, nullable=False),
    "end_date": Field("date", required=True, nullable=False),
    "note": Field("string", max_len=1000),
}


class LeavePolicy(Policy):
    """Everyone reads. People record their own leave; team leads their team's; admins anyone's."""

    def actions(self, user: User) -> frozenset[str]:
        return ALL_ACTIONS if has_role(user, ADMIN, TEAM_LEAD, TEAM_MEMBER) else frozenset({READ})

    def _manages(self, user: User, record: dict) -> bool:
        return is_admin(user) or record["user_id"] == user["id"] or _is_lead_of_record(user, record)

    def check_create(self, user: User, values: dict) -> None:
        if is_admin(user) or values["user_id"] == user["id"] or _leads_team_of(user, values["user_id"]):
            return
        scope = " or your team" if has_role(user, TEAM_LEAD) else ""
        raise Forbidden(f"You can only record leave for yourself{scope}")

    def editable_fields(self, user: User, record: dict) -> frozenset[str] | None:
        if is_admin(user):
            return None
        return frozenset(LEAVE_FIELDS) - {"user_id"} if self._manages(user, record) else frozenset()

    def can_delete(self, user: User, record: dict) -> bool:
        return self._manages(user, record)


def _leaves_before_write(ctx: WriteContext) -> None:
    values = ctx.values
    if ctx.existing is None:
        values.setdefault("user_id", ctx.user["id"])
        values["created_by"] = ctx.user["id"]
    if ctx.changed("user_id"):
        _require_user(values["user_id"], "user_id", ROLES, "must be an active user")
    if ctx.changed("type") and values["type"] not in get_setting("leaves.types"):
        raise ValidationFailed({"type": f"must be one of: {', '.join(get_setting('leaves.types'))}"})
    _date_order(ctx, "start_date", "end_date")
    merged = ctx.merged
    clash = db.fetch_one(
        "SELECT start_date, end_date FROM leaves WHERE user_id = %s AND id IS DISTINCT FROM %s"
        " AND start_date <= %s AND end_date >= %s LIMIT 1",
        (merged["user_id"], ctx.existing["id"] if ctx.existing else None, merged["end_date"], merged["start_date"]),
    )
    if clash:
        raise ValidationFailed({"start_date": "overlaps existing leave "
                                              f"({clash['start_date']} to {clash['end_date']})"})


LEAVES = Resource(
    name="leaves",
    table="leaves",
    fields=LEAVE_FIELDS,
    policy=LeavePolicy(),
    select="t.*, u.name AS user_name, u.team_id, tm.name AS team_name, tm.lead_id AS team_lead_id",
    source="leaves t JOIN users u ON u.id = t.user_id LEFT JOIN teams tm ON tm.id = u.team_id",
    filters={
        "user_id": Filter("t.user_id", "ref", me=True),
        "team_id": Filter("u.team_id", "ref"),
        "type": Filter("t.type", "string", multi=True),
        "from": Filter("t.end_date", "date", op=">="),  # leave overlapping [from, to]
        "to": Filter("t.start_date", "date", op="<="),
    },
    search=("u.name", "t.note", "t.type"),
    sorts={"start_date": "t.start_date", "end_date": "t.end_date", "user": "u.name", "type": "t.type"},
    default_sort="-start_date",
    hidden=("created_by",),
    before_write=_leaves_before_write,
)


# ---------------------------------------------------------------------------
# Expenses
# ---------------------------------------------------------------------------

EXPENSE_FIELDS = {
    "project_id": Field("ref", required=True, nullable=False, ref="projects"),
    "amount": Field("decimal", required=True, nullable=False, minimum=Decimal("0.01"), maximum=Decimal("999999999999")),
    "category": Field("string", required=True, nullable=False, max_len=50),
    "spent_on": Field("date", required=True, nullable=False),
    "description": Field("string", max_len=1000),
}


class ExpensePolicy(Policy):
    """Everyone who can see a project reads its expenses; its manager and admins record them."""

    def actions(self, user: User) -> frozenset[str]:
        return ALL_ACTIONS if has_role(user, ADMIN, PROJECT_MANAGER) else frozenset({READ})

    def scope(self, user: User) -> Scope:
        return project_visibility("p", user)

    def _manages(self, user: User, record: dict) -> bool:
        return is_admin(user) or (has_role(user, PROJECT_MANAGER) and record["project_manager_id"] == user["id"])

    def check_create(self, user: User, values: dict) -> None:
        if not is_admin(user) and not _manages_project(user, values["project_id"]):
            raise Forbidden("Only the project's manager can record expenses")

    def editable_fields(self, user: User, record: dict) -> frozenset[str] | None:
        return frozenset(EXPENSE_FIELDS) - {"project_id"} if self._manages(user, record) else frozenset()

    def can_delete(self, user: User, record: dict) -> bool:
        return self._manages(user, record)


def _expenses_before_write(ctx: WriteContext) -> None:
    if ctx.existing is None:
        ctx.values["created_by"] = ctx.user["id"]
    if ctx.changed("category"):
        categories = get_setting("budget.expense_categories")
        if ctx.values["category"] not in categories:
            raise ValidationFailed({"category": f"must be one of: {', '.join(categories)}"})


EXPENSES = Resource(
    name="expenses",
    table="expenses",
    fields=EXPENSE_FIELDS,
    policy=ExpensePolicy(),
    select=("t.*, p.key AS project_key, p.name AS project_name, p.manager_id AS project_manager_id,"
            " u.name AS created_by_name"),
    source="expenses t JOIN projects p ON p.id = t.project_id LEFT JOIN users u ON u.id = t.created_by",
    filters={
        "project_id": Filter("t.project_id", "ref"),
        "category": Filter("t.category", "string", multi=True),
        "from": Filter("t.spent_on", "date", op=">="),
        "to": Filter("t.spent_on", "date", op="<="),
    },
    search=("t.description", "t.category", "p.key"),
    sorts={"spent_on": "t.spent_on", "amount": "t.amount", "category": "t.category", "project": "p.key"},
    default_sort="-spent_on",
    hidden=("created_by",),
    before_write=_expenses_before_write,
)


RESOURCES: tuple[Resource, ...] = (USERS, DEPARTMENTS, TEAMS, PROJECTS, DELIVERABLES, LEAVES, EXPENSES)


def capabilities(user: User) -> dict[str, list[str]]:
    """Role-level actions per resource, for the UI's navigation and buttons."""
    caps = {r.name: sorted(r.policy.actions(user)) for r in RESOURCES}
    if is_admin(user):
        caps["settings"] = ["read", "update"]
        caps["audit_log"] = ["read"]
    return caps
