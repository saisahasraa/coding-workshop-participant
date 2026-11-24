"""Projects and deliverables: ownership, visibility, business rules, computed fields, filters."""

from datetime import date, timedelta

from app import db


def _deliverable(call, project, token, **fields):
    status, body = call("POST", "/deliverables", {"project_id": project["id"], "name": "Work", **fields}, token)
    assert status == 201, body
    return body


# -- projects ----------------------------------------------------------------------------

def test_pm_creates_project_they_manage(call, org, make_project):
    project = make_project(planned_budget="1500.50", start_date="2026-01-01", end_date="2026-06-30")
    pm = org["project_manager"]
    assert project["manager_id"] == pm["id"]
    assert project["manager_name"] == pm["name"]
    assert project["department_name"] == "Engineering"
    assert project["status"] == "planning" and project["visibility"] == "inherit"
    assert project["planned_budget"] == 1500.5
    assert project["progress_pct"] == 0 and project["deliverables_total"] == 0
    assert project["permissions"] == {"update": True, "delete": True,
                                      "editable_fields": sorted(set(project["permissions"]["editable_fields"]))}
    assert "manager_id" not in project["permissions"]["editable_fields"]


def test_project_create_rules(call, org):
    pm, admin = org["project_manager"], org["admin"]
    base = {"key": "xone", "name": "X", "department_id": org["department_id"]}
    assert call("POST", "/projects", {**base, "manager_id": org["pm2"]["id"]}, pm["token"])[0] == 403
    status, body = call("POST", "/projects", {**base, "manager_id": org["viewer"]["id"]}, admin["token"])
    assert status == 400 and "manager_id" in body["error"]["details"]
    status, body = call("POST", "/projects", {**base, "department_id": 999}, admin["token"])
    assert body["error"]["details"] == {"department_id": "departments 999 does not exist"}
    status, body = call("POST", "/projects", {**base, "start_date": "2026-05-01", "end_date": "2026-04-01"},
                        pm["token"])
    assert body["error"]["details"] == {"end_date": "must be on or after start_date"}
    status, body = call("POST", "/projects", {**base, "manager_id": org["pm2"]["id"]}, admin["token"])
    assert status == 201 and body["key"] == "XONE" and body["manager_id"] == org["pm2"]["id"]
    assert call("POST", "/projects", {**base}, admin["token"])[0] == 409  # duplicate code
    for role in ("team_lead", "team_member", "viewer"):
        assert call("POST", "/projects", base, org[role]["token"])[0] == 403


def test_only_owner_pm_or_admin_can_change_or_delete(call, org, make_project):
    project = make_project()
    path = f"/projects/{project['id']}"
    other = call("GET", path, token=org["pm2"]["token"])[1]
    assert other["permissions"] == {"update": False, "delete": False, "editable_fields": []}
    assert call("PUT", path, {"name": "Hijack"}, org["pm2"]["token"])[0] == 403
    assert call("DELETE", path, token=org["pm2"]["token"])[0] == 403
    assert call("PUT", path, {"name": "x"}, org["team_member"]["token"])[0] == 403
    assert call("PUT", path, {"manager_id": org["pm2"]["id"]}, org["project_manager"]["token"])[0] == 403
    assert call("PUT", path, {"manager_id": org["pm2"]["id"]}, org["admin"]["token"])[0] == 200
    assert call("DELETE", path, token=org["project_manager"]["token"])[0] == 403  # no longer theirs
    assert call("DELETE", path, token=org["pm2"]["token"])[0] == 204
    assert call("GET", path, token=org["admin"]["token"])[0] == 404


def test_project_completion_timestamp(call, org, make_project):
    project = make_project()
    path, token = f"/projects/{project['id']}", org["project_manager"]["token"]
    done = call("PUT", path, {"status": "completed"}, token)[1]
    assert done["completed_at"] is not None
    reopened = call("PUT", path, {"status": "active"}, token)[1]
    assert reopened["completed_at"] is None


def test_project_filters_search_and_sort(call, org, make_project):
    make_project(name="Website revamp", status="active", priority="high", end_date="2026-03-01")
    make_project(name="Mobile app", status="on_hold", end_date="2026-09-01")
    make_project(owner=org["pm2"], name="Data lake", status="planning")
    token = org["viewer"]["token"]

    def names(query):
        status, body = call("GET", "/projects", token=token, query=query)
        assert status == 200, body
        return [p["name"] for p in body["data"]]

    assert names({"status": "active,on_hold", "sort": "name"}) == ["Mobile app", "Website revamp"]
    assert names({"q": "revamp"}) == ["Website revamp"]
    assert names({"manager_id": str(org["pm2"]["id"])}) == ["Data lake"]
    assert names({"end_from": "2026-06-01"}) == ["Mobile app"]
    assert names({"priority": "high"}) == ["Website revamp"]
    pm_token = org["pm2"]["token"]
    assert [p["name"] for p in call("GET", "/projects", token=pm_token, query={"manager_id": "me"})[1]["data"]] \
        == ["Data lake"]
    assert call("GET", "/projects", token=token, query={"status": "done"})[0] == 400
    assert call("GET", "/projects", token=token, query={"end_from": "soon"})[0] == 400


def test_progress_is_weighted_by_estimates(call, org, make_project):
    project = make_project()
    token = org["project_manager"]["token"]
    _deliverable(call, project, token, estimated_hours=30, status="completed")
    _deliverable(call, project, token, estimated_hours=10, progress_pct=40)
    body = call("GET", f"/projects/{project['id']}", token=token)[1]
    assert body["progress_pct"] == 85  # (100*30 + 40*10) / 40
    assert body["deliverables_total"] == 2 and body["deliverables_completed"] == 1
    _deliverable(call, project, token, progress_pct=10)  # no estimate -> equal weights
    assert call("GET", f"/projects/{project['id']}", token=token)[1]["progress_pct"] == 50  # (100+40+10)/3


# -- visibility ---------------------------------------------------------------------------

def test_visibility_setting_and_per_project_override(call, org, make_project):
    open_project = make_project(name="Open")
    secret = make_project(name="Secret", visibility="members")
    member, viewer, admin = org["team_member"], org["viewer"], org["admin"]

    def visible(user):
        return {p["name"] for p in call("GET", "/projects", token=user["token"])[1]["data"]}

    assert visible(member) == {"Open"}
    assert call("GET", f"/projects/{secret['id']}", token=member["token"])[0] == 404
    assert visible(org["pm2"]) == {"Open", "Secret"}  # PMs and admins see everything

    _deliverable(call, secret, org["project_manager"]["token"], owner_id=member["id"])
    assert visible(member) == {"Open", "Secret"}  # owning a deliverable makes you a member
    assert visible(viewer) == {"Open"}
    assert call("GET", "/deliverables", token=viewer["token"])[1]["total"] == 0

    assert call("PUT", "/settings/projects.default_visibility", {"value": "members"}, admin["token"])[0] == 200
    assert visible(viewer) == set()
    assert call("PUT", f"/projects/{open_project['id']}", {"visibility": "everyone"},
                org["project_manager"]["token"])[0] == 200
    assert visible(viewer) == {"Open"}


# -- deliverables -------------------------------------------------------------------------

def test_deliverable_create_rules(call, org, make_project):
    project = make_project()
    assert call("POST", "/deliverables", {"project_id": project["id"], "name": "x"}, org["pm2"]["token"])[0] == 403
    assert call("POST", "/deliverables", {"project_id": project["id"], "name": "x"},
                org["team_member"]["token"])[0] == 403
    status, body = call("POST", "/deliverables", {"project_id": project["id"], "name": "x",
                                                  "owner_id": org["viewer"]["id"]}, org["project_manager"]["token"])
    assert status == 400 and "owner_id" in body["error"]["details"]
    status, body = call("POST", "/deliverables", {"project_id": project["id"], "name": "x", "progress_pct": 101},
                        org["admin"]["token"])
    assert body["error"]["details"] == {"progress_pct": "must be at most 100"}
    body = _deliverable(call, project, org["admin"]["token"], owner_id=org["team_member"]["id"], status="completed")
    assert body["progress_pct"] == 100 and body["completed_at"] and body["owner_name"] == org["team_member"]["name"]
    assert body["project_key"] == project["key"]
    assert body["key"] == f"{project['key']}-1"


def test_owner_can_update_status_and_progress_only(call, org, make_project):
    project = make_project()
    member = org["team_member"]
    item = _deliverable(call, project, org["project_manager"]["token"], owner_id=member["id"])
    path = f"/deliverables/{item['id']}"
    mine = call("GET", path, token=member["token"])[1]
    assert mine["permissions"] == {"update": True, "delete": False, "editable_fields": ["progress_pct", "status"]}
    assert call("PUT", path, {"progress_pct": 60, "status": "in_progress"}, member["token"])[0] == 200
    status, body = call("PUT", path, {"name": "Renamed"}, member["token"])
    assert status == 403 and "progress_pct, status" in body["error"]["message"]
    assert call("PUT", path, {"status": "blocked"}, org["team_lead"]["token"])[0] == 403  # not the owner
    assert call("DELETE", path, token=member["token"])[0] == 403

    done = call("PUT", path, {"status": "completed"}, member["token"])[1]
    assert done["progress_pct"] == 100 and done["completed_at"]
    reopened = call("PUT", path, {"status": "in_progress", "progress_pct": 90}, member["token"])[1]
    assert reopened["completed_at"] is None and reopened["progress_pct"] == 90


def test_pm_cannot_move_deliverable_to_foreign_project(call, org, make_project):
    mine = make_project()
    theirs = make_project(owner=org["pm2"])
    item = _deliverable(call, mine, org["project_manager"]["token"])
    path = f"/deliverables/{item['id']}"
    assert call("PUT", path, {"project_id": theirs["id"]}, org["project_manager"]["token"])[0] == 403
    assert call("PUT", path, {"project_id": theirs["id"]}, org["admin"]["token"])[0] == 200


def test_deliverable_filters_and_overdue(call, org, make_project):
    project = make_project()
    pm, member = org["project_manager"], org["team_member"]
    yesterday = (date.today() - timedelta(days=1)).isoformat()
    _deliverable(call, project, pm["token"], name="Late", due_date=yesterday, owner_id=member["id"])
    _deliverable(call, project, pm["token"], name="Done late", due_date=yesterday, status="completed")
    _deliverable(call, project, pm["token"], name="Future", due_date="2099-01-01", priority="critical")

    def names(query, token=pm["token"]):
        status, body = call("GET", "/deliverables", token=token, query=query)
        assert status == 200, body
        return [d["name"] for d in body["data"]]

    assert names({"overdue": "true"}) == ["Late"]
    assert set(names({"overdue": "false"})) == {"Done late", "Future"}
    assert names({"owner_id": "me"}, member["token"]) == ["Late"]
    assert names({"priority": "critical"}) == ["Future"]
    assert names({"project_id": str(project["id"]), "sort": "-due_date"})[0] == "Future"
    assert names({"q": project["key"].lower(), "status": "completed"}) == ["Done late"]
    assert call("GET", f"/projects/{project['id']}", token=pm["token"])[1]["deliverables_overdue"] == 1


def test_deleting_project_cascades_deliverables(call, org, make_project):
    project = make_project()
    _deliverable(call, project, org["project_manager"]["token"])
    assert call("DELETE", f"/projects/{project['id']}", token=org["project_manager"]["token"])[0] == 204
    assert db.fetch_one("SELECT count(*) AS n FROM deliverables")["n"] == 0


def test_writes_are_audited_with_secrets_redacted(call, org, make_project):
    project = make_project()
    call("PUT", f"/projects/{project['id']}", {"status": "active", "name": project["name"]},
         org["project_manager"]["token"])
    call("POST", "/users", {"email": "z@acme.example", "name": "Z", "password": "Secret#1234"}, org["admin"]["token"])
    rows = db.fetch_all("SELECT actor_id, action, entity, changes FROM audit_log ORDER BY id")
    assert [(r["action"], r["entity"]) for r in rows] == [("create", "projects"), ("update", "projects"),
                                                         ("create", "users")]
    assert rows[1]["changes"] == {"status": {"from": "planning", "to": "active"}}  # unchanged name not logged
    assert rows[1]["actor_id"] == org["project_manager"]["id"]
    assert rows[2]["changes"]["after"]["password_hash"] == "***"


# -- schedule consistency -----------------------------------------------------------------

def test_deliverable_due_date_must_fall_within_project(call, org, make_project):
    project = make_project(start_date="2026-01-01", end_date="2026-06-30")
    token = org["project_manager"]["token"]
    base = {"project_id": project["id"], "name": "x"}
    status, body = call("POST", "/deliverables", {**base, "due_date": "2026-07-01"}, token)
    assert status == 400
    assert body["error"]["details"] == {"due_date": "must be on or before the project target end date (2026-06-30)"}
    status, body = call("POST", "/deliverables", {**base, "due_date": "2025-12-31"}, token)
    assert body["error"]["details"]["due_date"].startswith("must be on or after the project start date")
    item = _deliverable(call, project, token, due_date="2026-06-30")  # boundary is inclusive
    assert item["project_end_date"] == "2026-06-30"
    assert call("PUT", f"/deliverables/{item['id']}", {"due_date": "2026-08-01"}, token)[0] == 400
    assert _deliverable(call, project, token)["due_date"] is None  # no due date is fine


def test_moving_deliverable_rechecks_target_project_dates(call, org, make_project):
    long_project = make_project(end_date="2026-12-31")
    short_project = make_project(end_date="2026-03-31")
    token = org["project_manager"]["token"]
    item = _deliverable(call, long_project, token, due_date="2026-10-01")
    status, body = call("PUT", f"/deliverables/{item['id']}", {"project_id": short_project["id"]}, token)
    assert status == 400 and "due_date" in body["error"]["details"]


def test_project_dates_cannot_exclude_existing_deliverables(call, org, make_project):
    project = make_project(start_date="2026-01-01", end_date="2026-06-30")
    token = org["project_manager"]["token"]
    _deliverable(call, project, token, due_date="2026-06-15")
    _deliverable(call, project, token, due_date="2026-02-01")
    path = f"/projects/{project['id']}"
    status, body = call("PUT", path, {"end_date": "2026-05-31"}, token)
    assert status == 400
    assert body["error"]["details"] == {"end_date": "1 deliverable(s) are due after this date; move them first"}
    status, body = call("PUT", path, {"start_date": "2026-03-01", "end_date": "2026-05-01"}, token)
    assert set(body["error"]["details"]) == {"start_date", "end_date"}
    assert call("PUT", path, {"end_date": "2026-06-15"}, token)[0] == 200  # still covers every deliverable
    assert call("PUT", path, {"end_date": None, "start_date": None}, token)[0] == 200  # open-ended is fine
