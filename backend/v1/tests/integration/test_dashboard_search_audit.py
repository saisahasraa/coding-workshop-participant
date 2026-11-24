"""Dashboard summary, global search and the audit log."""

from datetime import date, timedelta

import pytest

from app import db
from app.config import settings

TODAY = date.today()


def _project(make_project, key, **fields):
    return make_project(key=key, status="active", start_date=(TODAY - timedelta(days=30)).isoformat(),
                        end_date=(TODAY + timedelta(days=30)).isoformat(), **fields)


def _item(call, org, project, **fields):
    status, body = call("POST", "/deliverables", {"project_id": project["id"], "name": "Work", **fields},
                        org["project_manager"]["token"])
    assert status == 201, body
    return body


# --- dashboard --------------------------------------------------------------------------------------------------

@pytest.fixture
def portfolio(call, org, make_project):
    """GRN is fine; BAD has overdue work and overspent; SEC is hidden from outsiders."""
    pm = org["project_manager"]["token"]
    green = _project(make_project, "GRN", planned_budget=1000)
    _item(call, org, green, status="completed", due_date=TODAY.isoformat())
    bad = _project(make_project, "BAD", planned_budget=100)
    late = _item(call, org, bad, owner_id=org["team_member"]["id"], due_date=TODAY.isoformat(), estimated_hours=8)
    db.execute("UPDATE deliverables SET due_date = current_date - 20 WHERE id = %s", (late["id"],))
    _item(call, org, bad, due_date=(TODAY + timedelta(days=3)).isoformat())
    expense = {"project_id": bad["id"], "amount": 150, "category": "labor", "spent_on": TODAY.isoformat()}
    call("POST", "/expenses", expense, pm)
    secret = _project(make_project, "SEC", visibility="members", planned_budget=500)
    _item(call, org, secret, due_date=TODAY.isoformat())
    return green, bad, secret


def test_summary_answers_the_business_questions(call, org, portfolio):
    status, body = call("GET", "/reports/summary", token=org["admin"]["token"])
    assert status == 200
    assert body["projects"]["total"] == 3 and body["projects"]["running"] == 3
    assert body["projects"]["by_status"]["active"] == 3 and body["projects"]["by_status"]["completed"] == 0
    assert body["projects"]["by_health"]["red"] >= 1
    assert body["needs_attention"][0]["key"] == "BAD" and body["needs_attention"][0]["health"] == "red"
    assert any(r["code"] == "over_budget" for r in body["needs_attention"][0]["health_reasons"])
    work = body["deliverables"]
    assert work["by_status"]["completed"] == 1 and work["open"] == 3 and work["overdue"] == 1
    assert work["due_soon"] == 2 and work["unassigned"] == 2 and work["due_soon_days"] == 7
    assert body["budget"]["planned_budget"] == 1600.0 and body["budget"]["spent"] == 150.0
    assert body["budget"]["over_budget"] == 1 and body["budget"]["top"][0]["key"] == "BAD"
    assert body["capacity"]["people"] >= 1 and isinstance(body["capacity"]["top"], list)


def test_summary_respects_visibility_and_is_personal(call, org, portfolio):
    viewer = call("GET", "/reports/summary", token=org["viewer"]["token"])[1]
    assert viewer["projects"]["total"] == 2                                  # SEC is hidden
    assert viewer["deliverables"]["open"] == 2
    assert viewer["mine"] == {"open": 0, "overdue": 0, "due_soon": 0}
    member = call("GET", "/reports/summary", token=org["team_member"]["token"])[1]
    assert member["mine"] == {"open": 1, "overdue": 1, "due_soon": 0}
    assert call("GET", "/reports/summary")[0] == 401


def test_finished_projects_do_not_pad_deliverable_figures(call, org, portfolio):
    green, _, _ = portfolio
    call("PUT", f"/projects/{green['id']}", {"status": "completed"}, org["admin"]["token"])
    body = call("GET", "/reports/summary", token=org["admin"]["token"])[1]
    assert body["deliverables"]["by_status"]["completed"] == 0
    assert body["projects"]["by_status"]["completed"] == 1 and body["projects"]["running"] == 2


def test_dashboard_lists_follow_settings(call, org, portfolio):
    db.execute("INSERT INTO app_settings (key, value) VALUES ('dashboard.list_size', '1'::jsonb)")
    settings.invalidate()
    body = call("GET", "/reports/summary", token=org["admin"]["token"])[1]
    assert len(body["needs_attention"]) <= 1 and len(body["budget"]["top"]) <= 1


def test_empty_system_summary(call, org):
    body = call("GET", "/reports/summary", token=org["admin"]["token"])[1]
    assert body["projects"]["total"] == 0 and body["needs_attention"] == [] and body["budget"]["burn_pct"] is None
    assert body["deliverables"]["open"] == 0 and body["capacity"]["over_allocated"] == 0


# --- search -----------------------------------------------------------------------------------------------------

def test_search_finds_projects_deliverables_and_people(call, org, make_project, make_user):
    pm = org["project_manager"]
    project = make_project(key="PAY", name="Payments platform")
    for name in ("Card tokenization", "Fraud rules"):
        _item(call, org, project, name=name)
    make_user("team_member", name="Payton Reed")
    status, body = call("GET", "/search", query={"q": "pay"}, token=org["viewer"]["token"])
    assert status == 200 and body["q"] == "pay"
    assert [p["key"] for p in body["projects"]] == ["PAY"]
    assert {d["key"] for d in body["deliverables"]} == {"PAY-1", "PAY-2"}          # matched through the project name
    assert [p["name"] for p in body["people"]] == ["Payton Reed"]
    exact = call("GET", "/search", query={"q": "pay-2"}, token=pm["token"])[1]
    assert exact["deliverables"][0]["key"] == "PAY-2"


def test_search_hides_what_the_caller_cannot_see(call, org, make_project):
    secret = make_project(key="SEC", name="Secret plan", visibility="members")
    _item(call, org, secret, name="Secret task")
    assert call("GET", "/search", query={"q": "secret"}, token=org["viewer"]["token"])[1]["projects"] == []
    assert call("GET", "/search", query={"q": "secret"}, token=org["viewer"]["token"])[1]["deliverables"] == []
    assert len(call("GET", "/search", query={"q": "secret"}, token=org["admin"]["token"])[1]["projects"]) == 1


def test_search_skips_inactive_people_and_limits_results(call, org, make_user, make_project):
    make_user("team_member", name="Gone Person", active=False)
    for n in range(4):
        make_user("team_member", name=f"Sam {n}")
    admin = org["admin"]["token"]
    assert call("GET", "/search", query={"q": "gone"}, token=admin)[1]["people"] == []
    assert len(call("GET", "/search", query={"q": "sam"}, token=admin)[1]["people"]) == 4
    db.execute("INSERT INTO app_settings (key, value) VALUES ('search.results_per_type', '2'::jsonb)")
    settings.invalidate()
    assert len(call("GET", "/search", query={"q": "sam"}, token=admin)[1]["people"]) == 2


def test_search_validates_the_text(call, org):
    token = org["viewer"]["token"]
    assert call("GET", "/search", token=token)[0] == 400
    assert call("GET", "/search", query={"q": "a"}, token=token)[0] == 400
    assert call("GET", "/search", query={"q": "  "}, token=token)[0] == 400
    assert call("GET", "/search", query={"q": "zz"})[0] == 401
    assert call("GET", "/search", query={"q": "100%_"}, token=token)[0] == 200      # LIKE wildcards are escaped


# --- audit log --------------------------------------------------------------------------------------------------

def test_audit_log_is_admin_only_and_read_only(call, org, make_project):
    make_project(key="AUD")
    assert call("GET", "/audit-log", token=org["admin"]["token"])[0] == 200
    for role in ("project_manager", "team_lead", "team_member", "viewer"):
        assert call("GET", "/audit-log", token=org[role]["token"])[0] == 403
    assert call("GET", "/audit-log")[0] == 401
    admin = org["admin"]["token"]
    assert call("POST", "/audit-log", {"entity": "x"}, admin)[0] == 405          # nothing writes the trail via the API
    assert call("DELETE", "/audit-log/1", token=admin)[0] == 405
    assert call("PUT", "/audit-log/1", {}, admin)[0] == 405
    assert call("GET", "/audit-log/999999", token=admin)[0] == 404


def test_audit_log_filters(call, org, make_project):
    admin, pm = org["admin"], org["project_manager"]
    project = make_project(key="AUD")
    call("PUT", f"/projects/{project['id']}", {"name": "Renamed"}, pm["token"])
    call("PUT", "/settings/health.red_overdue_days", {"value": 3}, admin["token"])

    def rows(**query):
        status, body = call("GET", "/audit-log", query=query, token=admin["token"])
        assert status == 200, body
        return body["data"]

    settings_rows = rows(entity="app_settings", entity_id="health.red_overdue_days")
    assert len(settings_rows) == 1 and settings_rows[0]["actor_name"] == admin["name"]
    assert settings_rows[0]["changes"]["value"] == {"from": 7, "to": 3}
    assert {r["entity"] for r in rows(entity="projects,app_settings")} == {"projects", "app_settings"}
    assert all(r["actor_id"] == pm["id"] for r in rows(actor_id=str(pm["id"])))
    assert [r["action"] for r in rows(entity="projects", action="update")] == ["update"]
    assert rows(entity="projects", action="create")[0]["entity_id"] == str(project["id"])
    assert rows(**{"from": TODAY.isoformat(), "to": TODAY.isoformat()}) != []
    assert rows(**{"to": (TODAY - timedelta(days=1)).isoformat()}) == []
    assert all("AUD" not in r["entity"] for r in rows(q="app_settings"))
    assert rows(q=admin["name"]) != []
    assert rows(sort="entity")[0]["entity"] <= rows(sort="-entity")[0]["entity"]
    newest = rows()
    assert [r["id"] for r in newest] == sorted((r["id"] for r in newest), reverse=True)
    assert call("GET", "/audit-log", query={"action": "explode"}, token=admin["token"])[0] == 400
    assert call("GET", "/audit-log", query={"to": "soon"}, token=admin["token"])[0] == 400


def test_capabilities_reflect_audit_access(call, org):
    admin = call("GET", "/auth/me", token=org["admin"]["token"])[1]["permissions"]
    viewer = call("GET", "/auth/me", token=org["viewer"]["token"])[1]["permissions"]
    assert admin["audit-log"] == ["read"] and viewer["audit-log"] == []
