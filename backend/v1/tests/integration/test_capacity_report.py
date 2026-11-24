"""GET /reports/capacity: workload comes from the deliverables people own."""

from datetime import date

import pytest

from app import capacity

WINDOW = {"from": "2026-03-02", "to": "2026-03-13"}  # ten working days


@pytest.fixture(autouse=True)
def pinned_today(monkeypatch):
    """Reservations run from today, so pin it to the first day of the report window (a Monday)."""
    monkeypatch.setattr(capacity, "_today", lambda: date(2026, 3, 2))


def _owned(call, org, project, owner, **fields):
    body = {"project_id": project["id"], "name": "Work", "owner_id": owner["id"], **fields}
    status, item = call("POST", "/deliverables", body, org["project_manager"]["token"])
    assert status == 201, item
    return item


def _row(call, token, user, **query):
    status, body = call("GET", "/reports/capacity", token=token, query={**WINDOW, "user_id": str(user["id"]), **query})
    assert status == 200, body
    return body["data"][0], body


def _leave(call, org, user, start="2026-03-09", end="2026-03-11"):
    body = {"user_id": user["id"], "type": "vacation", "start_date": start, "end_date": end}
    assert call("POST", "/leaves", body, org["admin"]["token"])[0] == 201


def test_report_matches_hand_calculation(call, org, make_project):
    first, second = make_project(), make_project()
    member = org["team_member"]
    _owned(call, org, first, member, estimated_hours=40, progress_pct=50, due_date="2026-03-10")   # 20 h left
    _owned(call, org, second, member, estimated_hours=28, due_date="2026-03-13")                   # 28 h left
    _leave(call, org, member)
    row, body = _row(call, org["viewer"]["token"], member)
    assert (body["from"], body["to"], body["working_days"], body["threshold_pct"]) == (
        "2026-03-02", "2026-03-13", [1, 2, 3, 4, 5], 100)
    assert row["capacity_hours"] == 80.0 and row["leave_days"] == 3 and row["available_hours"] == 56.0
    assert row["allocated_hours"] == 48.0 and row["utilization_pct"] == 85.7 and row["over_allocated"] is False
    assert [(p["key"], p["hours"]) for p in row["projects"]] == [(second["key"], 28.0), (first["key"], 20.0)]
    assert body["summary"] == {"people": 1, "over_allocated": 0, "capacity_hours": 80.0, "available_hours": 56.0,
                               "allocated_hours": 48.0, "leave_hours": 24.0}


def test_work_across_projects_adds_up_to_over_allocation(call, org, make_project):
    member = org["team_member"]
    for _ in range(3):
        _owned(call, org, make_project(), member, estimated_hours=30, due_date="2026-03-12")
    row, body = _row(call, org["admin"]["token"], member)
    assert row["allocated_hours"] == 90.0 and row["utilization_pct"] == 112.5 and row["over_allocated"] is True
    assert len(row["projects"]) == 3 and body["summary"]["over_allocated"] == 1


def test_reassigning_a_deliverable_moves_the_load(call, org, make_project):
    project, dan, carol = make_project(), org["team_member"], org["team_lead"]
    item = _owned(call, org, project, dan, estimated_hours=100, due_date="2026-03-12")
    admin = org["admin"]["token"]
    row, _ = _row(call, admin, dan)
    assert row["allocated_hours"] == 100.0 and row["over_allocated"] is True
    assert _row(call, admin, carol)[0]["allocated_hours"] == 0.0

    reassigned = call("PUT", f"/deliverables/{item['id']}", {"owner_id": carol["id"]}, org["project_manager"]["token"])
    assert reassigned[0] == 200
    after_dan, after_carol = _row(call, admin, dan)[0], _row(call, admin, carol)[0]
    assert after_dan["allocated_hours"] == 0.0 and after_dan["over_allocated"] is False
    assert after_carol["allocated_hours"] == 100.0 and after_carol["over_allocated"] is True


def test_progress_and_completion_reduce_the_load(call, org, make_project):
    project, member, pm = make_project(), org["team_member"], org["project_manager"]["token"]
    item = _owned(call, org, project, member, estimated_hours=40, due_date="2026-03-12")
    admin = org["admin"]["token"]
    assert _row(call, admin, member)[0]["allocated_hours"] == 40.0
    call("PUT", f"/deliverables/{item['id']}", {"progress_pct": 75}, pm)
    assert _row(call, admin, member)[0]["allocated_hours"] == 10.0
    call("PUT", f"/deliverables/{item['id']}", {"status": "completed"}, pm)
    assert _row(call, admin, member)[0]["allocated_hours"] == 0.0


def test_leave_can_turn_a_full_load_into_over_allocation(call, org, make_project):
    member, admin = org["team_member"], org["admin"]["token"]
    _owned(call, org, make_project(), member, estimated_hours=80, due_date="2026-03-12")
    assert _row(call, admin, member)[0]["over_allocated"] is False                          # exactly 100%
    _leave(call, org, member, "2026-03-04", "2026-03-04")
    assert _row(call, admin, member)[0]["over_allocated"] is True


def test_what_counts_and_what_does_not(call, org, make_project):
    project, closed, member = make_project(), make_project(), org["team_member"]
    _owned(call, org, project, member, estimated_hours=16, due_date="2026-01-15")               # overdue still counts
    _owned(call, org, project, member, estimated_hours=88, due_date="2026-04-30")               # 10 of 44 days: 20 h
    _owned(call, org, project, member, estimated_hours=30, status="completed", due_date="2026-03-05")
    _owned(call, org, project, member, name="No estimate", due_date="2026-03-06")               # cannot be counted
    _owned(call, org, project, member, estimated_hours=5)                                       # no due date: same
    _owned(call, org, closed, member, estimated_hours=50, due_date="2026-03-04")
    call("PUT", f"/projects/{closed['id']}", {"status": "cancelled"}, org["project_manager"]["token"])
    row, _ = _row(call, org["admin"]["token"], member)
    assert row["allocated_hours"] == 36.0 and row["uncounted_count"] == 2
    assert [p["hours"] for p in row["projects"]] == [36.0]


def test_threshold_and_working_days_come_from_settings(call, org, make_project):
    _owned(call, org, make_project(), org["team_member"], estimated_hours=60, due_date="2026-03-12")
    admin = org["admin"]["token"]
    assert _row(call, admin, org["team_member"])[0]["over_allocated"] is False                  # 75% of 80 h
    call("PUT", "/settings/capacity.overallocation_threshold_pct", {"value": 70}, admin)
    assert _row(call, admin, org["team_member"])[0]["over_allocated"] is True
    call("PUT", "/settings/capacity.working_days", {"value": [1, 2, 3, 4]}, admin)              # four-day week
    row, body = _row(call, admin, org["team_member"])
    assert body["working_days"] == [1, 2, 3, 4] and row["capacity_hours"] == 80.0               # 10 h/day x 8 days


def _ids(call, token, **query):
    body = call("GET", "/reports/capacity", token=token, query={**WINDOW, **query})[1]
    return [r["user_id"] for r in body["data"]]


def test_filters_viewers_and_defaults(call, org, team):
    admin = org["admin"]["token"]
    everyone = _ids(call, admin)
    assert org["viewer"]["id"] not in everyone and len(everyone) == 5                      # viewers have no capacity
    in_team = {org["team_lead"]["id"], org["team_member"]["id"]}
    assert set(_ids(call, admin, team_id=str(team["id"]))) == in_team
    assert set(_ids(call, admin, department_id=str(org["department_id"]))) == in_team
    assert call("PUT", f"/users/{org['team_lead']['id']}", {"is_active": False}, admin)[0] == 200
    assert org["team_lead"]["id"] not in _ids(call, admin)                                  # inactive people drop out
    body = call("GET", "/reports/capacity", token=org["viewer"]["token"])[1]               # default window: 28 days
    assert (date.fromisoformat(body["to"]) - date.fromisoformat(body["from"])).days == 27


def test_window_and_filter_validation(call, org):
    token = org["viewer"]["token"]
    for query in (
        {"from": "soon"}, {"from": "2026-03-10", "to": "2026-03-01"}, {"from": "2026-01-01", "to": "2027-06-01"},
        {"team_id": "abc"}, {"bogus": "1"},
    ):
        assert call("GET", "/reports/capacity", token=token, query=query)[0] == 400
    assert call("GET", "/reports/capacity")[0] == 401
    assert call("GET", "/reports/capacity", token=token, query={"to": "2026-03-28"})[1]["from"] == "2026-03-01"


def test_hidden_projects_are_pooled_not_named(call, org, make_project):
    secret, visible, member = make_project(visibility="members"), make_project(), org["team_member"]
    _owned(call, org, secret, org["project_manager"], estimated_hours=16, due_date="2026-03-10")  # not the member's
    _owned(call, org, secret, member, estimated_hours=16, due_date="2026-03-10")
    _owned(call, org, visible, member, estimated_hours=24, due_date="2026-03-10")
    outsider_view, _ = _row(call, org["viewer"]["token"], member)
    assert outsider_view["allocated_hours"] == 40.0                                          # totals stay honest
    assert [(p["key"], p["hours"]) for p in outsider_view["projects"]] == [(visible["key"], 24.0), (None, 16.0)]
    pooled = outsider_view["projects"][1]
    assert pooled["name"] == "Other projects" and pooled["project_id"] is None
    admin_view, _ = _row(call, org["admin"]["token"], member)
    assert {p["key"] for p in admin_view["projects"]} == {secret["key"], visible["key"]}


def test_hours_are_reserved_up_to_the_deadline(call, org, make_project):
    member, admin = org["team_member"], org["admin"]["token"]
    _owned(call, org, make_project(), member, estimated_hours=40, due_date="2026-03-27")      # 20 working days away
    assert _row(call, admin, member)[0]["allocated_hours"] == 20.0                            # half falls in the window
    next_week = {"from": "2026-03-09", "to": "2026-03-13"}
    assert _row(call, admin, member, **next_week)[0]["allocated_hours"] == 10.0               # 5 of the 20 days
    past = {"from": "2026-02-02", "to": "2026-02-13"}
    assert _row(call, admin, member, **past)[0]["allocated_hours"] == 0.0                     # nothing before today
    far = {"from": "2026-03-30", "to": "2026-04-10"}
    assert _row(call, admin, member, **far)[0]["allocated_hours"] == 0.0                      # after the deadline


def test_assigning_far_future_work_already_loads_the_assignee_now(call, org, make_project):
    """The reported case: a deliverable due months away still moves load when it is reassigned."""
    project, dan, carol = make_project(), org["team_member"], org["team_lead"]
    item = _owned(call, org, project, dan, estimated_hours=88, due_date="2026-04-30")
    admin = org["admin"]["token"]
    assert _row(call, admin, dan)[0]["allocated_hours"] == 20.0
    call("PUT", f"/deliverables/{item['id']}", {"owner_id": carol["id"]}, org["project_manager"]["token"])
    assert _row(call, admin, dan)[0]["allocated_hours"] == 0.0
    assert _row(call, admin, carol)[0]["allocated_hours"] == 20.0
