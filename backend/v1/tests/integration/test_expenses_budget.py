"""Expenses and the budget report."""

import pytest

from app import db
from app.config import settings


def _expense(call, user, project, **fields):
    body = {"project_id": project["id"], "amount": "100.50", "category": "software", "spent_on": "2026-03-10", **fields}
    return call("POST", "/expenses", body, user["token"])


def test_manager_records_edits_and_deletes_expenses(call, org, make_project):
    project = make_project(key="BUD", planned_budget=1000)
    pm = org["project_manager"]
    status, expense = _expense(call, pm, project, description="Licences")
    assert status == 201
    assert expense["project_key"] == "BUD" and expense["created_by_name"] == pm["name"]
    assert expense["permissions"]["update"] and expense["permissions"]["editable_fields"] != []
    assert "project_id" not in expense["permissions"]["editable_fields"]

    status, updated = call("PUT", f"/expenses/{expense['id']}", {"amount": "250", "category": "hardware"}, pm["token"])
    assert status == 200 and float(updated["amount"]) == 250
    assert call("PUT", f"/expenses/{expense['id']}", {"project_id": project["id"]}, pm["token"])[0] == 403
    assert call("DELETE", f"/expenses/{expense['id']}", token=pm["token"])[0] == 204
    assert call("GET", f"/expenses/{expense['id']}", token=pm["token"])[0] == 404
    actions = [r["action"] for r in db.fetch_all("SELECT action FROM audit_log WHERE entity = 'expenses' ORDER BY id")]
    assert actions == ["create", "update", "delete"]


def test_validation(call, org, make_project):
    project = make_project()
    pm = org["project_manager"]
    assert _expense(call, pm, project, amount="0")[0] == 400
    assert _expense(call, pm, project, amount="-5")[0] == 400
    status, body = _expense(call, pm, project, category="yacht")
    assert status == 400 and "must be one of" in body["error"]["details"]["category"]
    assert _expense(call, pm, project, spent_on="soon")[0] == 400
    assert _expense(call, pm, {"id": 99999})[0] == 400


def test_categories_are_configurable(call, org, make_project):
    project = make_project()
    db.execute("INSERT INTO app_settings (key, value) VALUES ('budget.expense_categories', '[\"cloud\"]'::jsonb)")
    settings.invalidate()
    assert _expense(call, org["project_manager"], project, category="cloud")[0] == 201
    assert _expense(call, org["project_manager"], project, category="software")[0] == 400


def test_admins_and_any_project_manager_write_everyone_else_reads(call, org, make_project):
    project = make_project()                                        # managed by the first project manager
    pm2 = org["pm2"]                                                # a project manager, but not this project's
    assert _expense(call, org["team_lead"], project)[0] == 403
    assert _expense(call, org["team_member"], project)[0] == 403
    assert _expense(call, org["viewer"], project)[0] == 403
    status, theirs = _expense(call, pm2, project)
    assert status == 201 and theirs["permissions"]["update"] and theirs["permissions"]["delete"]
    status, mine = _expense(call, org["admin"], project)
    assert status == 201
    assert call("PUT", f"/expenses/{mine['id']}", {"amount": 5}, pm2["token"])[0] == 200
    assert call("PUT", f"/expenses/{mine['id']}", {"amount": 6}, org["team_lead"]["token"])[0] == 403
    assert call("DELETE", f"/expenses/{mine['id']}", token=org["viewer"]["token"])[0] == 403
    assert call("DELETE", f"/expenses/{mine['id']}", token=pm2["token"])[0] == 204
    status, seen = call("GET", f"/expenses/{theirs['id']}", token=org["viewer"]["token"])
    assert status == 200 and seen["permissions"]["update"] is False


def test_any_project_manager_sets_the_planned_budget_but_nothing_else(call, org, make_project):
    project = make_project(key="BDG", planned_budget=1000)
    pm2, viewer = org["pm2"], org["viewer"]
    seen = call("GET", "/projects/BDG", token=pm2["token"])[1]["permissions"]
    assert seen["update"] is True and seen["editable_fields"] == ["planned_budget"] and seen["delete"] is False
    assert call("PUT", f"/projects/{project['id']}", {"planned_budget": 2500}, pm2["token"])[0] == 200
    assert float(call("GET", "/projects/BDG", token=pm2["token"])[1]["planned_budget"]) == 2500
    status, body = call("PUT", f"/projects/{project['id']}", {"name": "Renamed", "planned_budget": 1}, pm2["token"])
    assert status == 403 and "planned_budget" in body["error"]["message"]
    assert call("DELETE", f"/projects/{project['id']}", token=pm2["token"])[0] == 403
    assert call("PUT", f"/projects/{project['id']}", {"planned_budget": 9}, org["team_lead"]["token"])[0] == 403
    assert call("PUT", f"/projects/{project['id']}", {"planned_budget": 9}, viewer["token"])[0] == 403


def test_hidden_projects_hide_their_expenses(call, org, make_project):
    secret = make_project(key="SEC", visibility="members")
    open_project = make_project(key="OPN")
    _expense(call, org["project_manager"], secret)
    _expense(call, org["project_manager"], open_project)
    status, body = call("GET", "/expenses", token=org["viewer"]["token"])
    assert status == 200 and [e["project_key"] for e in body["data"]] == ["OPN"]
    assert call("GET", "/expenses", query={"project_id": secret["id"]}, token=org["viewer"]["token"])[1]["total"] == 0


def test_filters_and_deleting_a_project_removes_its_expenses(call, org, make_project):
    project = make_project()
    pm = org["project_manager"]
    _expense(call, pm, project, category="travel", spent_on="2026-01-05")
    _expense(call, pm, project, category="software", spent_on="2026-02-05")
    _expense(call, pm, project, category="software", spent_on="2026-03-05")
    query = {"project_id": project["id"], "category": "software", "from": "2026-03-01"}
    assert call("GET", "/expenses", query=query, token=pm["token"])[1]["total"] == 1
    assert call("GET", "/expenses", query={"sort": "amount"}, token=pm["token"])[0] == 200
    assert call("DELETE", f"/projects/{project['id']}", token=pm["token"])[0] == 204
    assert call("GET", "/expenses", token=pm["token"])[1]["total"] == 0


def test_project_shows_spend_and_burn(call, org, make_project):
    project = make_project(key="BUD", planned_budget=1000, start_date="2026-01-01", end_date="2026-12-31")
    assert project["budget_spent"] == 0 and project["budget_burn_pct"] == 0.0
    _expense(call, org["project_manager"], project, amount="250")
    _expense(call, org["project_manager"], project, amount="250")
    status, body = call("GET", "/projects/BUD", token=org["viewer"]["token"])
    assert status == 200 and float(body["budget_spent"]) == 500 and body["budget_burn_pct"] == 50.0
    assert "max_overdue_days" not in body
    make_project(key="FRE")
    assert call("GET", "/projects/FRE", token=org["viewer"]["token"])[1]["budget_burn_pct"] is None


def test_budget_report(call, org, make_project):
    pm = org["project_manager"]
    over = make_project(key="OVR", planned_budget=100, status="active")
    fine = make_project(key="FIN", planned_budget=1000, status="active")
    secret = make_project(key="SEC", visibility="members", planned_budget=500)
    _expense(call, pm, over, amount="150", category="travel", spent_on="2026-01-15")
    _expense(call, pm, fine, amount="200", category="software", spent_on="2026-01-20")
    _expense(call, pm, fine, amount="100", category="software", spent_on="2026-02-02")
    _expense(call, pm, secret, amount="400", category="labor", spent_on="2026-02-03")

    status, body = call("GET", "/reports/budget", token=org["viewer"]["token"])
    assert status == 200
    assert [p["key"] for p in body["data"]] == ["FIN", "OVR"]                       # SEC is hidden from the viewer
    assert body["totals"] == {"projects": 2, "planned_budget": 1100.0, "spent": 450.0, "remaining": 650.0,
                              "burn_pct": 40.9, "over_budget": 1}
    ovr = next(p for p in body["data"] if p["key"] == "OVR")
    assert ovr["over_budget"] is True and ovr["remaining"] == -50.0 and ovr["burn_pct"] == 150.0
    assert body["by_category"] == [{"category": "software", "amount": 300.0}, {"category": "travel", "amount": 150.0}]
    assert body["by_month"] == [{"month": "2026-01", "amount": 350.0}, {"month": "2026-02", "amount": 100.0}]

    status, admin_view = call("GET", "/reports/budget", token=org["admin"]["token"])
    assert admin_view["totals"]["projects"] == 3 and admin_view["totals"]["spent"] == 850.0


def test_budget_report_filters(call, org, make_project):
    one = make_project(key="ONE", planned_budget=100)
    make_project(key="TWO", planned_budget=100)
    token = org["admin"]["token"]
    by_key = call("GET", "/reports/budget", query={"project_id": "one"}, token=token)[1]
    assert [p["key"] for p in by_key["data"]] == ["ONE"]
    by_id = call("GET", "/reports/budget", query={"project_id": str(one["id"])}, token=token)[1]
    assert by_id["totals"]["projects"] == 1
    assert call("GET", "/reports/budget", query={"department_id": str(org["department_id"])}, token=token)[1]["totals"][
        "projects"] == 2
    assert call("GET", "/reports/budget", query={"department_id": "9999"}, token=token)[1]["data"] == []
    assert call("GET", "/reports/budget", query={"project_id": "NOPE"}, token=token)[0] == 404
    assert call("GET", "/reports/budget", query={"department_id": "x"}, token=token)[0] == 400
    assert call("GET", "/reports/budget")[0] == 401


@pytest.mark.parametrize("spent", [0, 10])
def test_budget_without_plan_has_no_burn(call, org, make_project, spent):
    project = make_project(key="NOB", planned_budget=0)
    if spent:
        _expense(call, org["project_manager"], project, amount=spent)
    row = call("GET", "/reports/budget", token=org["admin"]["token"])[1]["data"][0]
    assert row["burn_pct"] is None and row["over_budget"] is bool(spent)
