"""
Capacity maths, the capacity report and the per-project team view.

Workload comes from the deliverables people own; nobody reserves a percentage of anyone's week.
For a person and a date window (inclusive), with ``hours_per_day = weekly capacity / working days per week``:

    capacity    = hours_per_day x working days in the window
    available   = capacity - hours_per_day x working days on leave
    allocated   = hours reserved inside the window (below)
    utilization = allocated / available

A deliverable reserves its remaining hours, ``estimate x (100 - progress) / 100``, on its owner's
capacity *before its deadline*: they are spread evenly over the working days from today to the due date
(overdue work is reserved today). The window counts the share that falls inside it, so work due next
quarter already takes some of this month. Completed deliverables and those on completed or cancelled
projects reserve nothing. Deliverables without an estimate or a due date cannot be placed in time; they
are reported as ``uncounted_count`` instead of being guessed at.

Over-allocated means ``allocated`` exceeds ``available`` by more than the configured threshold, so
planned leave can tip someone over.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import UTC, date, datetime, timedelta
from typing import Any

from psycopg import sql

from app import db
from app.config import get_setting
from app.crud import fetch, record_id_from
from app.http import ValidationFailed
from app.resources import PROJECTS, project_visibility
from app.validation import Field, coerce

MAX_WINDOW_DAYS = 366
CLOSED_PROJECT_STATUSES = ("completed", "cancelled")
_EPSILON = 1e-9


def working_days_between(start: date, end: date, working_days: set[int] | frozenset[int]) -> int:
    """Number of working weekdays (ISO: Monday=1) in ``start..end`` inclusive; 0 when ``end < start``."""
    if end < start:
        return 0
    weeks, extra = divmod((end - start).days + 1, 7)
    count = weeks * len(working_days)
    first = start.isoweekday()
    return count + sum(1 for offset in range(extra) if (first - 1 + offset) % 7 + 1 in working_days)


def _overlap(a_start: date, a_end: date, b_start: date, b_end: date) -> tuple[date, date] | None:
    start, end = max(a_start, b_start), min(a_end, b_end)
    return (start, end) if start <= end else None


def _today() -> date:
    """Today's date in UTC, the same day the database's ``current_date`` reports (a function so tests can pin it)."""
    return datetime.now(UTC).date()


def reserved_hours(remaining: float, due: date, window: tuple[date, date], today: date,
                   working_days: set[int] | frozenset[int]) -> float:
    """Hours of ``remaining`` work that fall inside ``window`` when spread over today..``due``."""
    if remaining <= 0:
        return 0.0
    end = max(due, today)  # overdue work is reserved today
    total = working_days_between(today, end, working_days)
    if total == 0:  # the whole period is a day off: it lands on the next working day
        day = today
        while day.isoweekday() not in working_days:
            day += timedelta(days=1)
        return remaining if window[0] <= day <= window[1] else 0.0
    span = _overlap(today, end, *window)
    return remaining * working_days_between(*span, working_days) / total if span else 0.0


def person_capacity(
    weekly_hours: float,
    window: tuple[date, date],
    leaves: list[tuple[date, date]],
    allocated_hours: float,
    working_days: set[int] | frozenset[int],
    threshold_pct: float,
) -> dict[str, Any]:
    """Capacity figures for one person, given the hours of work assigned to them."""
    hours_per_day = float(weekly_hours) / len(working_days)
    capacity = hours_per_day * working_days_between(*window, working_days)

    leave_days = 0
    for start, end in leaves:
        span = _overlap(*window, start, end)
        leave_days += working_days_between(*span, working_days) if span else 0
    leave_hours = hours_per_day * leave_days
    available = max(capacity - leave_hours, 0.0)

    return {
        "capacity_hours": round(capacity, 1),
        "leave_days": leave_days,
        "leave_hours": round(leave_hours, 1),
        "available_hours": round(available, 1),
        "allocated_hours": round(allocated_hours, 1),
        "free_hours": round(available - allocated_hours, 1),
        "utilization_pct": round(allocated_hours / available * 100, 1) if available > 0 else None,
        "over_allocated": allocated_hours > available * threshold_pct / 100 + _EPSILON,
    }


def _parse_window(query: dict) -> tuple[date, date]:
    errors: dict[str, str] = {}
    parsed: dict[str, date] = {}
    for name in ("from", "to"):
        if name in query:
            try:
                parsed[name] = coerce(Field("date", nullable=False), query[name])
            except ValueError as exc:
                errors[name] = str(exc)
    if errors:
        raise ValidationFailed(errors)
    days = get_setting("capacity.default_window_days")
    start = parsed.get("from") or (parsed["to"] - timedelta(days=days - 1) if "to" in parsed else _today())
    end = parsed.get("to") or start + timedelta(days=days - 1)
    if end < start:
        raise ValidationFailed({"to": "must be on or after from"})
    if (end - start).days + 1 > MAX_WINDOW_DAYS:
        raise ValidationFailed({"to": f"the window may span at most {MAX_WINDOW_DAYS} days"})
    return start, end


def _parse_filters(query: dict) -> dict[str, int]:
    filters, errors = {}, {}
    for name in ("team_id", "department_id", "user_id"):
        if name in query:
            try:
                filters[name] = coerce(Field("ref", nullable=False), query[name])
            except ValueError as exc:
                errors[name] = str(exc)
    unknown = set(query) - {"from", "to", "team_id", "department_id", "user_id"}
    errors.update({name: "is not a supported filter" for name in sorted(unknown)})
    if errors:
        raise ValidationFailed(errors)
    return filters


def _people(filters: dict[str, int]) -> list[dict]:
    conditions = [sql.SQL("u.is_active"), sql.SQL("u.role <> 'viewer'")]
    params: list = []
    for name, column in (("team_id", "u.team_id"), ("department_id", "tm.department_id"), ("user_id", "u.id")):
        if name in filters:
            conditions.append(sql.SQL("{} = %s").format(sql.SQL(column)))
            params.append(filters[name])
    return db.fetch_all(
        sql.SQL("SELECT u.id, u.name, u.role, u.job_title, u.weekly_capacity_hours, u.team_id, tm.name AS team_name"
                " FROM users u LEFT JOIN teams tm ON tm.id = u.team_id WHERE {} ORDER BY u.name, u.id")
        .format(sql.SQL(" AND ").join(conditions)),
        params,
    )


def _open_deliverables(ids: list[int]) -> list[dict]:
    """Unfinished deliverables owned by ``ids`` on projects that are still running."""
    return db.fetch_all(
        "SELECT d.owner_id AS user_id, p.id AS project_id, p.key, p.name, d.estimated_hours, d.progress_pct,"
        " d.due_date FROM deliverables d JOIN projects p ON p.id = d.project_id"
        " WHERE d.owner_id = ANY(%s) AND d.status <> 'completed' AND p.status <> ALL(%s)",
        (ids, list(CLOSED_PROJECT_STATUSES)),
    )


def build_report(user: dict, query: dict) -> dict:
    """The capacity report for ``query`` (``from``, ``to``, ``team_id``, ``department_id``, ``user_id``)."""
    window = _parse_window(query)
    filters = _parse_filters(query)
    working = frozenset(get_setting("capacity.working_days"))
    threshold = get_setting("capacity.overallocation_threshold_pct")
    today = _today()

    people = _people(filters)
    ids = [p["id"] for p in people]
    leaves: dict[int, list[tuple[date, date]]] = defaultdict(list)
    work: dict[int, list[dict]] = defaultdict(list)
    visible: set[int] | None = None
    if ids:
        for row in db.fetch_all("SELECT user_id, start_date, end_date FROM leaves WHERE user_id = ANY(%s)"
                                " AND start_date <= %s AND end_date >= %s", (ids, window[1], window[0])):
            leaves[row["user_id"]].append((row["start_date"], row["end_date"]))
        for row in _open_deliverables(ids):
            work[row["user_id"]].append(row)
        scope = project_visibility("p", user)
        if scope is not None:
            visible = {r["id"] for r in db.fetch_all(
                sql.SQL("SELECT p.id FROM projects p WHERE ({})").format(scope[0]), scope[1])}

    rows = []
    for person in people:
        by_project: dict[Any, dict] = {}
        uncounted = 0
        total = 0.0
        for item in work[person["id"]]:
            if item["estimated_hours"] is None or item["due_date"] is None:
                uncounted += 1
                continue
            remaining = float(item["estimated_hours"]) * (100 - item["progress_pct"]) / 100
            hours = reserved_hours(remaining, item["due_date"], window, today, working)
            if hours <= 0:
                continue
            total += hours
            shown = visible is None or item["project_id"] in visible
            slot = item["project_id"] if shown else None  # hidden projects are pooled, never named
            entry = by_project.setdefault(slot, {
                "project_id": slot, "key": item["key"] if shown else None,
                "name": item["name"] if shown else "Other projects", "hours": 0.0,
            })
            entry["hours"] += hours
        figures = person_capacity(person["weekly_capacity_hours"], window, leaves[person["id"]], total, working,
                                  threshold)
        projects = sorted(({**e, "hours": round(e["hours"], 1)} for e in by_project.values()),
                          key=lambda e: (e["project_id"] is None, -e["hours"]))
        rows.append({
            "user_id": person["id"], "name": person["name"], "role": person["role"], "job_title": person["job_title"],
            "team_id": person["team_id"], "team_name": person["team_name"],
            "weekly_capacity_hours": float(person["weekly_capacity_hours"]), **figures,
            "uncounted_count": uncounted, "projects": projects,
        })

    totals = {key: round(sum(r[key] for r in rows), 1)
              for key in ("capacity_hours", "available_hours", "allocated_hours", "leave_hours")}
    return {
        "from": window[0], "to": window[1], "working_days": sorted(working), "threshold_pct": threshold,
        "data": rows,
        "summary": {"people": len(rows), "over_allocated": sum(r["over_allocated"] for r in rows), **totals},
    }


MAX_TEAM_ROWS = 2000


def project_team(user: dict, ref: str) -> dict:
    """Who works on a project: its deliverables grouped by owner, with hours and each owner's items."""
    project = fetch(PROJECTS, user, record_id_from(PROJECTS, ref))  # 404 when the project is not visible
    rows = db.fetch_all(
        "SELECT d.id, d.number, d.name, d.status, d.priority, d.due_date, d.estimated_hours, d.progress_pct,"
        " d.owner_id, u.name AS owner_name, u.role AS owner_role, u.job_title AS owner_job_title"
        " FROM deliverables d LEFT JOIN users u ON u.id = d.owner_id WHERE d.project_id = %s"
        " ORDER BY d.due_date NULLS LAST, d.number LIMIT %s", (project["id"], MAX_TEAM_ROWS + 1))
    today = _today()
    groups: dict[int | None, dict] = {}
    for row in rows[:MAX_TEAM_ROWS]:
        group = groups.setdefault(row["owner_id"], {
            "user_id": row["owner_id"], "name": row["owner_name"] or "Unassigned", "role": row["owner_role"],
            "job_title": row["owner_job_title"], "deliverables_total": 0, "deliverables_open": 0,
            "deliverables_completed": 0, "overdue": 0, "estimated_hours": 0.0, "remaining_hours": 0.0,
            "deliverables": [],
        })
        estimate = float(row["estimated_hours"] or 0)
        done = row["status"] == "completed"
        overdue = bool(row["due_date"] and row["due_date"] < today and not done)
        group["deliverables_total"] += 1
        group["deliverables_completed" if done else "deliverables_open"] += 1
        group["overdue"] += overdue
        group["estimated_hours"] += estimate
        group["remaining_hours"] += 0.0 if done else estimate * (100 - row["progress_pct"]) / 100
        group["deliverables"].append({
            "id": row["id"], "key": f"{project['key']}-{row['number']}", "name": row["name"], "status": row["status"],
            "priority": row["priority"], "due_date": row["due_date"], "estimated_hours": row["estimated_hours"],
            "progress_pct": row["progress_pct"], "is_overdue": overdue,
        })
    people = sorted(groups.values(), key=lambda g: (g["user_id"] is None, g["name"].lower()))
    for person in people:
        person["estimated_hours"] = round(person["estimated_hours"], 1)
        person["remaining_hours"] = round(person["remaining_hours"], 1)
    return {"project": {"id": project["id"], "key": project["key"], "name": project["name"]}, "data": people,
            "truncated": len(rows) > MAX_TEAM_ROWS}
