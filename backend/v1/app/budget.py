"""Budget report: planned vs spent per project, with spend by category and by month."""

from __future__ import annotations

from psycopg import sql

from app import db, health
from app.crud import record_id_from
from app.resources import PROJECTS, project_visibility
from app.validation import parse_id


def _money(value: object) -> float:
    return round(float(value or 0), 2)


def project_row(row: dict) -> dict:
    """Budget figures of one project row."""
    planned, spent = _money(row["planned_budget"]), _money(row["budget_spent"])
    figures = health.computed_fields(row)
    return {
        "id": row["id"], "key": row["key"], "name": row["name"], "status": row["status"],
        "department_name": row["department_name"], "planned_budget": planned, "spent": spent,
        "remaining": round(planned - spent, 2), "burn_pct": figures["budget_burn_pct"],
        "progress_pct": row["progress_pct"], "over_budget": spent > planned > 0 or (spent > 0 and planned == 0),
        "health": figures["health"],
    }


def build_report(user: dict, query: dict) -> dict:
    """``GET /reports/budget?project_id=<id or key>&department_id=``: figures for the visible projects."""
    conditions: list[sql.Composable] = []
    params: list = []
    if "project_id" in query:
        conditions.append(sql.SQL("t.id = %s"))
        params.append(record_id_from(PROJECTS, query["project_id"]))
    if "department_id" in query:
        conditions.append(sql.SQL("t.department_id = %s"))
        params.append(parse_id(query["department_id"]))
    scope = project_visibility("t", user)
    if scope is not None:
        conditions.append(sql.SQL("({})").format(scope[0]))
        params += scope[1]
    where = sql.SQL(" WHERE ") + sql.SQL(" AND ").join(conditions) if conditions else sql.SQL("")
    rows = db.fetch_all(
        sql.SQL("SELECT {} FROM {}{} ORDER BY t.key").format(
            sql.SQL(PROJECTS.select), sql.SQL(PROJECTS.source), where), params)
    projects = [project_row(r) for r in rows]

    ids = [p["id"] for p in projects]
    by_category = db.fetch_all(
        "SELECT category, sum(amount) AS amount FROM expenses WHERE project_id = ANY(%s)"
        " GROUP BY category ORDER BY 2 DESC, 1", (ids,))
    by_month = db.fetch_all(
        "SELECT to_char(date_trunc('month', spent_on), 'YYYY-MM') AS month, sum(amount) AS amount FROM expenses"
        " WHERE project_id = ANY(%s) GROUP BY 1 ORDER BY 1", (ids,))

    planned = round(sum(p["planned_budget"] for p in projects), 2)
    spent = round(sum(p["spent"] for p in projects), 2)
    return {
        "totals": {
            "projects": len(projects), "planned_budget": planned, "spent": spent,
            "remaining": round(planned - spent, 2),
            "burn_pct": round(spent / planned * 100, 1) if planned > 0 else None,
            "over_budget": sum(p["over_budget"] for p in projects),
        },
        "data": projects,
        "by_category": [{"category": r["category"], "amount": _money(r["amount"])} for r in by_category],
        "by_month": [{"month": r["month"], "amount": _money(r["amount"])} for r in by_month],
    }
