"""``GET /reports/summary``: the figures behind the dashboard, scoped to what the caller can see."""

from __future__ import annotations

from psycopg import sql

from app import budget, capacity, db, health
from app.config import get_setting
from app.resources import DELIVERABLE_STATUSES, PROJECT_STATUSES, project_visibility, visible_project_rows

CLOSED = ("completed", "cancelled")


def _projects(user: dict, list_size: int) -> tuple[dict, list[dict], list[dict]]:
    """Project counts, the ones needing attention, and the budget rows of the visible projects."""
    rows = visible_project_rows(user)
    by_status = dict.fromkeys(PROJECT_STATUSES, 0)
    by_health = dict.fromkeys(health.LEVELS, 0)
    attention = []
    budgets = []
    for row in rows:
        by_status[row["status"]] += 1
        figures = health.computed_fields(row)
        budgets.append(budget.project_row(row))
        if figures["health"]:
            by_health[figures["health"]] += 1
        if figures["health"] in ("amber", "red"):
            attention.append({
                "id": row["id"], "key": row["key"], "name": row["name"], "status": row["status"],
                "health": figures["health"], "health_reasons": figures["health_reasons"],
                "manager_name": row["manager_name"], "progress_pct": row["progress_pct"], "end_date": row["end_date"],
            })
    attention.sort(key=lambda p: (p["health"] != "red", -len(p["health_reasons"]), p["key"]))
    counts = {"total": len(rows), "running": sum(by_health.values()), "by_status": by_status, "by_health": by_health}
    return counts, attention[:list_size], budgets


def _deliverables(user: dict, owner_id: int | None = None) -> dict:
    """Figures for unfinished and finished work in projects that are still running."""
    days = get_setting("dashboard.due_soon_days")
    query = sql.SQL(
        "SELECT d.status, count(*) AS n,"
        " count(*) FILTER (WHERE d.status <> 'completed' AND d.due_date < current_date) AS overdue,"
        " count(*) FILTER (WHERE d.status <> 'completed' AND d.due_date BETWEEN current_date"
        "                  AND current_date + %s) AS due_soon,"
        " count(*) FILTER (WHERE d.status <> 'completed' AND d.owner_id IS NULL) AS unassigned"
        " FROM deliverables d JOIN projects p ON p.id = d.project_id WHERE p.status NOT IN ('completed', 'cancelled')"
    )
    params: list = [days]
    if owner_id is not None:
        query += sql.SQL(" AND d.owner_id = %s")
        params.append(owner_id)
    scope = project_visibility("p", user)
    if scope is not None:
        query += sql.SQL(" AND ({})").format(scope[0])
        params += scope[1]
    rows = db.fetch_all(query + sql.SQL(" GROUP BY d.status"), params)
    by_status = dict.fromkeys(DELIVERABLE_STATUSES, 0)
    by_status.update({r["status"]: r["n"] for r in rows})
    return {
        "by_status": by_status,
        "open": sum(n for status, n in by_status.items() if status != "completed"),
        "overdue": sum(r["overdue"] for r in rows), "due_soon": sum(r["due_soon"] for r in rows),
        "unassigned": sum(r["unassigned"] for r in rows), "due_soon_days": days,
    }


def _budget(rows: list[dict], list_size: int) -> dict:
    planned = round(sum(r["planned_budget"] for r in rows), 2)
    spent = round(sum(r["spent"] for r in rows), 2)
    running = [r for r in rows if r["status"] in health.JUDGED_STATUSES and r["burn_pct"] is not None]
    running.sort(key=lambda r: -r["burn_pct"])
    return {
        "planned_budget": planned, "spent": spent, "burn_pct": round(spent / planned * 100, 1) if planned else None,
        "over_budget": sum(r["over_budget"] for r in rows),
        "top": [{k: r[k] for k in ("id", "key", "name", "burn_pct", "spent", "planned_budget", "over_budget")}
                for r in running[:list_size]],
    }


def _capacity(user: dict, list_size: int) -> dict:
    report = capacity.build_report(user, {})
    summary = report["summary"]
    ranked = sorted((p for p in report["data"] if p["utilization_pct"] is not None or p["over_allocated"]),
                    key=lambda p: (not p["over_allocated"], -(p["utilization_pct"] or 0)))
    return {
        "from": report["from"], "to": report["to"], "people": summary["people"],
        "over_allocated": summary["over_allocated"],
        "utilization_pct": (round(summary["allocated_hours"] / summary["available_hours"] * 100, 1)
                            if summary["available_hours"] else None),
        "top": [{k: p[k] for k in ("user_id", "name", "utilization_pct", "over_allocated")}
                for p in ranked[:list_size]],
    }


def build_summary(user: dict) -> dict:
    """Everything the dashboard shows, in one response."""
    size = get_setting("dashboard.list_size")
    projects, attention, budgets = _projects(user, size)
    mine = _deliverables(user, owner_id=user["id"])
    return {
        "projects": projects,
        "needs_attention": attention,
        "deliverables": _deliverables(user),
        "budget": _budget(budgets, size),
        "capacity": _capacity(user, size),
        "mine": {k: mine[k] for k in ("open", "overdue", "due_soon")},
    }
