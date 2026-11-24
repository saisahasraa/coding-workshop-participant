"""Status, progress and ownership must never contradict each other, whichever way they change."""

import pytest

from app import db


@pytest.fixture
def project(make_project):
    return make_project(key="ENG")


def _item(call, org, project, **fields):
    status, body = call("POST", "/deliverables", {"project_id": project["id"], "name": "Work", **fields},
                        org["project_manager"]["token"])
    assert status == 201, body
    return body


def _put(call, org, key, **changes):
    return call("PUT", f"/deliverables/{key}", changes, org["project_manager"]["token"])


# --- deliverable status and progress ---------------------------------------------------------------------------

def test_progress_on_unstarted_work_starts_it(call, org, project):
    item = _item(call, org, project)
    status, body = _put(call, org, item["key"], progress_pct=50)
    assert status == 200 and (body["status"], body["progress_pct"]) == ("in_progress", 50)
    created = _item(call, org, project, progress_pct=20)
    assert created["status"] == "in_progress"


def test_lowering_progress_of_completed_work_reopens_it(call, org, project):
    item = _item(call, org, project, status="completed")
    body = _put(call, org, item["key"], progress_pct=40)[1]
    assert (body["status"], body["progress_pct"], body["completed_at"]) == ("in_progress", 40, None)


def test_completed_work_with_full_progress_stays_completed(call, org, project):
    item = _item(call, org, project, status="completed")
    body = _put(call, org, item["key"], progress_pct=100)[1]
    assert body["status"] == "completed" and body["completed_at"] is not None


def test_moving_work_back_to_not_started_resets_progress(call, org, project):
    item = _item(call, org, project, status="in_progress", progress_pct=60)
    body = _put(call, org, item["key"], status="not_started")[1]
    assert (body["status"], body["progress_pct"]) == ("not_started", 0)
    done = _item(call, org, project, status="completed")
    assert _put(call, org, done["key"], status="not_started")[1]["progress_pct"] == 0


def test_reopening_by_progress_blocks_dependents_again(call, org, project):
    pm = org["project_manager"]["token"]
    first, second = _item(call, org, project, status="completed"), _item(call, org, project)
    call("POST", f"/deliverables/{first['key']}/links", {"type": "blocks", "target": second["key"]}, pm)
    assert _put(call, org, second["key"], progress_pct=10)[1]["status"] == "in_progress"
    _put(call, org, first["key"], progress_pct=50)                       # reopens the blocker
    assert call("GET", f"/deliverables/{second['key']}", token=pm)[1]["status"] == "blocked"


# --- projects ---------------------------------------------------------------------------------------------------

def test_a_project_with_unfinished_work_cannot_be_completed(call, org, project):
    pm = org["project_manager"]["token"]
    item = _item(call, org, project)
    status, body = call("PUT", f"/projects/{project['id']}", {"status": "completed"}, pm)
    assert status == 400 and "1 deliverable(s) are not completed" in body["error"]["details"]["status"]
    _put(call, org, item["key"], status="completed")
    assert call("PUT", f"/projects/{project['id']}", {"status": "completed"}, pm)[0] == 200
    assert call("PUT", f"/projects/{project['id']}", {"status": "cancelled"}, pm)[0] == 200


def test_finished_projects_take_no_new_work(call, org, make_project, project):
    pm = org["project_manager"]["token"]
    other = make_project(key="OTH")
    item = _item(call, org, other)
    assert call("PUT", f"/projects/{project['id']}", {"status": "cancelled"}, pm)[0] == 200
    for body in ({"project_id": project["id"], "name": "Late"},):
        status, res = call("POST", "/deliverables", body, pm)
        assert status == 400 and "cancelled" in res["error"]["details"]["project_id"]
    assert _put(call, org, item["key"], project_id=project["id"])[0] == 400               # moving in is refused too
    call("PUT", f"/projects/{project['id']}", {"status": "active"}, pm)
    assert _put(call, org, item["key"], project_id=project["id"])[0] == 200               # reopened: fine again


def test_expenses_can_still_be_filed_on_a_finished_project(call, org, project):
    pm = org["project_manager"]["token"]
    call("PUT", f"/projects/{project['id']}", {"status": "cancelled"}, pm)
    body = {"project_id": project["id"], "amount": 10, "category": "labor", "spent_on": "2026-01-01"}
    assert call("POST", "/expenses", body, pm)[0] == 201                                   # final invoices


def test_deleting_a_project_frees_work_it_was_blocking_elsewhere(call, org, make_project, project):
    pm = org["project_manager"]["token"]
    ops = make_project(key="OPS")
    blocker = _item(call, org, ops)
    waiting = _item(call, org, project)
    call("POST", f"/deliverables/{blocker['key']}/links", {"type": "blocks", "target": waiting["key"]}, pm)
    assert call("GET", f"/deliverables/{waiting['key']}", token=pm)[1]["status"] == "blocked"
    assert call("DELETE", f"/projects/{ops['id']}", token=pm)[0] == 204
    assert call("GET", f"/deliverables/{waiting['key']}", token=pm)[1]["status"] == "not_started"


def test_deleting_a_project_with_internal_dependencies_works(call, org, project):
    pm = org["project_manager"]["token"]
    a, b = _item(call, org, project), _item(call, org, project)
    call("POST", f"/deliverables/{a['key']}/links", {"type": "blocks", "target": b["key"]}, pm)
    assert call("DELETE", f"/projects/{project['id']}", token=pm)[0] == 204


# --- people -----------------------------------------------------------------------------------------------------

def test_people_who_own_unfinished_work_cannot_be_deactivated_or_made_viewers(call, org, project):
    member, admin = org["team_member"], org["admin"]["token"]
    item = _item(call, org, project, owner_id=member["id"])
    for change, field in (({"is_active": False}, "is_active"), ({"role": "viewer"}, "role")):
        status, body = call("PUT", f"/users/{member['id']}", change, admin)
        assert status == 400 and "reassign" in body["error"]["details"][field]
    _put(call, org, item["key"], status="completed")
    assert call("PUT", f"/users/{member['id']}", {"is_active": False}, admin)[0] == 200


def test_managers_of_open_projects_cannot_step_back(call, org, make_user, make_project):
    manager, admin = make_user("project_manager"), org["admin"]["token"]
    managed = make_project(owner=manager, key="MGR")
    for change, field in (({"role": "team_member"}, "role"), ({"is_active": False}, "is_active")):
        status, body = call("PUT", f"/users/{manager['id']}", change, admin)
        assert status == 400 and "assign another manager" in body["error"]["details"][field]
    assert call("PUT", f"/projects/{managed['id']}", {"status": "cancelled"}, admin)[0] == 200
    assert call("PUT", f"/users/{manager['id']}", {"role": "team_member"}, admin)[0] == 200   # nothing open left


def test_a_team_loses_its_lead_when_the_lead_stops_being_one(call, org, team):
    admin = org["admin"]["token"]
    assert call("PUT", f"/users/{org['team_lead']['id']}", {"role": "team_member"}, admin)[0] == 200
    assert call("GET", f"/teams/{team['id']}", token=admin)[1]["lead_id"] is None
    entries = db.fetch_all("SELECT changes FROM audit_log WHERE entity = 'teams' AND action = 'update'")
    assert entries and entries[-1]["changes"]["lead_id"]["to"] is None


def test_unassigned_filter(call, org, project):
    _item(call, org, project, owner_id=org["team_member"]["id"])
    orphan = _item(call, org, project)
    token = org["viewer"]["token"]
    unowned = call("GET", "/deliverables", query={"unassigned": "true"}, token=token)[1]["data"]
    assert [d["key"] for d in unowned] == [orphan["key"]]
    assert call("GET", "/deliverables", query={"unassigned": "false"}, token=token)[1]["total"] == 1
