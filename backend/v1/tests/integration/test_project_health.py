"""Project health on the API: reasons, filter and live thresholds.

Dates are relative to today: every project starts 30 days ago and ends in 30 days (50% elapsed).
"""

from datetime import UTC, datetime, timedelta

from app import db
from app.config import settings

TODAY = datetime.now(UTC).date()   # the database's "today" is UTC


def _project(make_project, key, **fields):
    return make_project(key=key, status="active", start_date=(TODAY - timedelta(days=30)).isoformat(),
                        end_date=(TODAY + timedelta(days=30)).isoformat(), **fields)


def _deliverable(call, org, project, **fields):
    status, body = call("POST", "/deliverables", {"project_id": project["id"], "name": "Work", **fields},
                        org["project_manager"]["token"])
    assert status == 201, body
    return body


def _late(deliverable, days):
    db.execute("UPDATE deliverables SET due_date = current_date - %s WHERE id = %s", (days, deliverable["id"]))


def _health(call, token, key):
    body = call("GET", f"/projects/{key}", token=token)[1]
    return body["health"], [(r["level"], r["code"]) for r in body["health_reasons"]]


def test_green_amber_and_red_with_reasons(call, org, make_project):
    token = org["viewer"]["token"]
    done = TODAY.isoformat()
    green, amber, red = (_project(make_project, key, planned_budget=1000) for key in ("GRN", "AMB", "RED"))
    for project in (green, amber, red):  # one finished and one open deliverable: 50% complete at 50% elapsed
        _deliverable(call, org, project, status="completed", due_date=done)
        _deliverable(call, org, project, due_date=(TODAY + timedelta(days=20)).isoformat())
    _deliverable(call, org, amber, status="blocked", estimated_hours=0)            # weighted by count: 33% complete
    _late(_deliverable(call, org, red), 30)

    assert _health(call, token, "GRN") == ("green", [])
    level, reasons = _health(call, token, "AMB")
    assert level == "amber" and ("amber", "blocked") in reasons
    level, reasons = _health(call, token, "RED")
    assert level == "red" and ("red", "overdue") in reasons
    assert call("GET", "/projects/RED", token=token)[1]["schedule_elapsed_pct"] == 50.0


def test_projects_that_are_not_running_have_no_health(call, org, make_project):
    make_project(key="PLN")
    body = call("GET", "/projects/PLN", token=org["admin"]["token"])[1]
    assert body["status"] == "planning" and body["health"] is None and body["health_reasons"] == []


def test_filter_by_health(call, org, make_project):
    ok = _project(make_project, "OKK", planned_budget=1000)
    _deliverable(call, org, ok, status="completed", due_date=TODAY.isoformat())   # complete: not behind schedule
    broken = _project(make_project, "BAD", planned_budget=1000)
    _late(_deliverable(call, org, broken, due_date=TODAY.isoformat()), 20)
    token = org["viewer"]["token"]

    def keys(**query):
        status, body = call("GET", "/projects", query=query, token=token)
        assert status == 200
        return [p["key"] for p in body["data"]]

    assert keys(health="red") == ["BAD"]
    assert keys(health="green") == ["OKK"]
    assert keys(health="amber,red") == ["BAD"]
    assert keys(health="green,red") == ["BAD", "OKK"]
    assert keys(health="red", q="OK") == []
    assert call("GET", "/projects", query={"health": "purple"}, token=token)[0] == 400


def test_health_filter_respects_visibility(call, org, make_project):
    secret = _project(make_project, "SEC", visibility="members")
    db.execute("UPDATE projects SET end_date = current_date - 1 WHERE id = %s", (secret["id"],))  # red: past its end
    assert [p["key"] for p in call("GET", "/projects", query={"health": "red"}, token=org["admin"]["token"])[1]["data"]
            ] == ["SEC"]
    assert call("GET", "/projects", query={"health": "red"}, token=org["viewer"]["token"])[1]["data"] == []


def test_admin_retunes_health_without_a_redeploy(call, org, make_project):
    project = _project(make_project, "TUN", planned_budget=1000)
    _deliverable(call, org, project, status="in_progress", progress_pct=35, due_date=TODAY.isoformat())
    token = org["admin"]["token"]
    assert _health(call, token, "TUN") == ("amber", [("amber", "schedule")])    # 50% of the time, 35% done: gap 15
    assert call("PUT", "/settings/health.amber_schedule_gap_pct", {"value": 20}, token)[0] == 200
    assert _health(call, token, "TUN") == ("green", [])
    settings.invalidate()


def test_overdue_threshold_is_a_setting(call, org, make_project):
    project = _project(make_project, "LAT", planned_budget=1000)
    _late(_deliverable(call, org, project, due_date=TODAY.isoformat(), progress_pct=50), 5)
    token = org["admin"]["token"]
    assert ("amber", "overdue") in _health(call, token, "LAT")[1]
    call("PUT", "/settings/health.red_overdue_days", {"value": 2}, token)
    assert ("red", "overdue") in _health(call, token, "LAT")[1]
