"""Project keys, deliverable keys/numbering, comments and linked work items."""

import psycopg
from psycopg import sql

from app import db, migrations


def _deliverable(call, project, token, **fields):
    status, body = call("POST", "/deliverables", {"project_id": project["id"], "name": "Work", **fields}, token)
    assert status == 201, body
    return body


# -- project keys -------------------------------------------------------------------------

def test_project_key_format_and_uniqueness(call, org, make_project):
    token = org["project_manager"]["token"]
    base = {"name": "X", "department_id": org["department_id"]}
    for bad in ("EN", "ENGINEER", "1ENG", "EN-G", "e g"):
        status, body = call("POST", "/projects", {**base, "key": bad}, token)
        assert status == 400 and "key" in body["error"]["details"], bad
    project = make_project(key="devops")
    assert project["key"] == "DEVOPS"
    assert call("POST", "/projects", {**base, "key": "DevOps"}, token)[0] == 409
    assert "deliverable_seq" not in project


def test_project_key_is_fixed_after_creation(call, org, make_project):
    project = make_project(key="SRE")
    for user in ("project_manager", "admin"):
        assert "key" not in call("GET", "/projects/SRE", token=org[user]["token"])[1]["permissions"]["editable_fields"]
        assert call("PUT", f"/projects/{project['id']}", {"key": "OPS"}, org[user]["token"])[0] == 403


def test_projects_resolve_by_key(call, org, make_project):
    project = make_project(key="ENG")
    token = org["viewer"]["token"]
    assert call("GET", "/projects/eng", token=token)[1]["id"] == project["id"]
    assert call("GET", "/projects/NOPE", token=token)[0] == 404
    assert call("PUT", "/projects/ENG", {"name": "Engineering"}, org["project_manager"]["token"])[0] == 200


# -- deliverable keys ---------------------------------------------------------------------

def test_deliverables_are_numbered_per_project_and_never_reused(call, org, make_project):
    token = org["project_manager"]["token"]
    eng, web = make_project(key="ENG"), make_project(key="WEB")
    first, second = _deliverable(call, eng, token), _deliverable(call, eng, token)
    assert (first["key"], second["key"]) == ("ENG-1", "ENG-2")
    assert _deliverable(call, web, token)["key"] == "WEB-1"
    assert call("DELETE", "/deliverables/ENG-2", token=token)[0] == 204
    assert _deliverable(call, eng, token)["key"] == "ENG-3"  # 2 is not reused
    assert first["reporter_id"] == org["project_manager"]["id"]
    assert first["reporter_name"] == org["project_manager"]["name"]


def test_deliverable_lookup_and_search_by_key(call, org, make_project):
    token = org["project_manager"]["token"]
    eng = make_project(key="ENG")
    item = _deliverable(call, eng, token, name="Pipeline")
    for _ in range(10):
        _deliverable(call, eng, token)
    assert call("GET", "/deliverables/eng-1", token=token)[1]["id"] == item["id"]
    for missing in ("ENG-999", "XYZ-1", "ENG1", "-1"):
        assert call("GET", f"/deliverables/{missing}", token=token)[0] in (400, 404)
    found = call("GET", "/deliverables", token=token, query={"q": "ENG-1"})[1]["data"]
    assert {d["key"] for d in found} == {"ENG-1", "ENG-10", "ENG-11"}
    ordered = call("GET", "/deliverables", token=token, query={"sort": "key", "limit": "3"})[1]["data"]
    assert [d["key"] for d in ordered] == ["ENG-1", "ENG-2", "ENG-3"]  # numeric, not text, order


def test_moved_deliverable_gets_a_key_in_its_new_project(call, org, make_project):
    token = org["admin"]["token"]
    eng, web = make_project(key="ENG"), make_project(key="WEB")
    item = _deliverable(call, eng, token)
    _deliverable(call, web, token)
    moved = call("PUT", f"/deliverables/{item['id']}", {"project_id": web["id"]}, token)[1]
    assert moved["key"] == "WEB-2"
    assert call("GET", "/deliverables/ENG-1", token=token)[0] == 404


def test_reporter_and_acceptance_criteria(call, org, make_project):
    pm = org["project_manager"]
    item = _deliverable(call, make_project(), pm["token"], acceptance_criteria="- loads in < 2s\n- passes a11y")
    assert item["acceptance_criteria"].startswith("- loads")
    path = f"/deliverables/{item['id']}"
    assert call("PUT", path, {"reporter_id": org["team_lead"]["id"]}, pm["token"])[1]["reporter_name"] \
        == org["team_lead"]["name"]
    db.execute("UPDATE users SET is_active = false WHERE id = %s", (org["viewer"]["id"],))
    assert call("PUT", path, {"reporter_id": org["viewer"]["id"]}, pm["token"])[0] == 400


# -- comments -----------------------------------------------------------------------------

def test_comment_lifecycle_and_permissions(call, org, make_project):
    pm, member, lead, viewer = org["project_manager"], org["team_member"], org["team_lead"], org["viewer"]
    item = _deliverable(call, make_project(), pm["token"], owner_id=member["id"])
    base = f"/deliverables/{item['key']}/comments"

    status, comment = call("POST", base, {"body": "  Started on this  "}, member["token"])
    assert status == 201 and comment["body"] == "Started on this" and comment["author_name"] == member["name"]
    assert comment["permissions"] == {"update": True, "delete": True}
    assert call("POST", base, {"body": ""}, member["token"])[0] == 400
    assert call("POST", base, {"body": "x" * 5001}, member["token"])[0] == 400
    assert call("POST", base, {"body": "nope"}, viewer["token"])[0] == 403
    assert call("POST", base, {"body": "Looks good"}, lead["token"])[0] == 201

    listed = call("GET", base, token=viewer["token"])[1]
    assert [c["body"] for c in listed["data"]] == ["Started on this", "Looks good"]
    assert listed["data"][0]["permissions"] == {"update": False, "delete": False}

    path = f"/comments/{comment['id']}"
    assert call("PUT", path, {"body": "edited"}, lead["token"])[0] == 403
    edited = call("PUT", path, {"body": "Halfway done"}, member["token"])[1]
    assert edited["body"] == "Halfway done"
    assert call("DELETE", path, token=lead["token"])[0] == 403
    assert call("DELETE", path, token=pm["token"])[0] == 204  # project manager moderates
    assert call("DELETE", path, token=pm["token"])[0] == 404
    assert call("PUT", "/comments/999999", {"body": "x"}, pm["token"])[0] == 404


def test_comments_follow_deliverable_visibility(call, org, make_project):
    secret = make_project(visibility="members")
    item = _deliverable(call, secret, org["project_manager"]["token"])
    _, comment = call("POST", f"/deliverables/{item['id']}/comments", {"body": "hidden"}, org["admin"]["token"])
    assert call("GET", f"/deliverables/{item['id']}/comments", token=org["team_member"]["token"])[0] == 404
    assert call("PUT", f"/comments/{comment['id']}", {"body": "x"}, org["team_member"]["token"])[0] == 404


# -- links --------------------------------------------------------------------------------

def test_links_both_directions_and_relates(call, org, make_project):
    token = org["project_manager"]["token"]
    project = make_project(key="ENG")
    a, b, c = (_deliverable(call, project, token, name=n) for n in ("API", "UI", "Docs"))
    status, link = call("POST", f"/deliverables/{a['key']}/links", {"type": "blocks", "target": "ENG-2"}, token)
    assert status == 201 and link == {**link, "type": "blocks", "key": "ENG-2", "name": "UI"}
    assert call("POST", f"/deliverables/{c['key']}/links", {"type": "relates_to", "target": "eng-1"}, token)[0] == 201

    from_b = call("GET", f"/deliverables/{b['key']}/links", token=token)[1]["data"]
    assert [(x["type"], x["key"]) for x in from_b] == [("is_blocked_by", "ENG-1")]
    from_a = call("GET", f"/deliverables/{a['key']}/links", token=token)[1]["data"]
    assert {(x["type"], x["key"]) for x in from_a} == {("blocks", "ENG-2"), ("relates_to", "ENG-3")}

    assert call("POST", f"/deliverables/{a['key']}/links", {"type": "relates_to", "target": "ENG-3"}, token)[0] == 409
    assert call("POST", f"/deliverables/{b['key']}/links", {"type": "is_blocked_by", "target": "ENG-1"},
                token)[0] == 409
    assert call("POST", f"/deliverables/{a['key']}/links", {"type": "blocks", "target": "ENG-1"}, token)[0] == 400
    assert call("POST", f"/deliverables/{a['key']}/links", {"type": "blocks", "target": "ENG-99"}, token)[0] == 400
    assert call("POST", f"/deliverables/{a['key']}/links", {"type": "duplicates", "target": "ENG-2"}, token)[0] == 400

    assert call("DELETE", f"/deliverables/{c['key']}/links/{link['id']}", token=token)[0] == 404  # not c's link
    assert call("DELETE", f"/deliverables/{b['key']}/links/{link['id']}", token=token)[0] == 204
    assert call("GET", f"/deliverables/{a['key']}/links", token=token)[1]["data"][0]["type"] == "relates_to"


def test_circular_blocking_is_rejected(call, org, make_project):
    token = org["project_manager"]["token"]
    project = make_project(key="ENG")
    for _ in range(3):
        _deliverable(call, project, token)
    assert call("POST", "/deliverables/ENG-1/links", {"type": "blocks", "target": "ENG-2"}, token)[0] == 201
    assert call("POST", "/deliverables/ENG-2/links", {"type": "blocks", "target": "ENG-3"}, token)[0] == 201
    status, body = call("POST", "/deliverables/ENG-3/links", {"type": "blocks", "target": "ENG-1"}, token)
    assert status == 400 and "circular" in body["error"]["details"]["target"]
    assert call("POST", "/deliverables/ENG-1/links", {"type": "is_blocked_by", "target": "ENG-3"}, token)[0] == 400


def test_cannot_complete_while_blocked(call, org, make_project):
    pm, member = org["project_manager"], org["team_member"]
    project = make_project(key="ENG")
    blocker = _deliverable(call, project, pm["token"])
    item = _deliverable(call, project, pm["token"], owner_id=member["id"])
    call("POST", f"/deliverables/{item['key']}/links", {"type": "is_blocked_by", "target": blocker["key"]}, pm["token"])
    status, body = call("PUT", f"/deliverables/{item['key']}", {"status": "completed"}, member["token"])
    assert status == 400 and body["error"]["details"]["status"] == "cannot complete while blocked by ENG-1"
    assert call("PUT", f"/deliverables/{blocker['key']}", {"status": "completed"}, pm["token"])[0] == 200
    assert call("PUT", f"/deliverables/{item['key']}", {"status": "completed"}, member["token"])[0] == 200


def test_links_need_edit_rights_and_hidden_items_cannot_be_linked_or_seen(call, org, make_project):
    pm, member = org["project_manager"], org["team_member"]
    open_item = _deliverable(call, make_project(key="OPEN"), pm["token"], owner_id=member["id"])
    secret_item = _deliverable(call, make_project(key="SEC", visibility="members"), pm["token"])
    status, body = call("POST", f"/deliverables/{open_item['key']}/links", {"type": "relates_to", "target": "SEC-1"},
                        member["token"])
    assert status == 400 and body["error"]["details"] == {"target": "SEC-1 not found"}     # may link, cannot see it
    assert call("POST", f"/deliverables/{open_item['key']}/links", {"type": "relates_to", "target": "SEC-1"},
                org["viewer"]["token"])[0] == 403
    assert call("POST", f"/deliverables/{open_item['key']}/links", {"type": "relates_to", "target": secret_item["key"]},
                pm["token"])[0] == 201
    assert call("GET", f"/deliverables/{open_item['key']}/links", token=member["token"])[1]["data"] == []
    assert len(call("GET", f"/deliverables/{open_item['key']}/links", token=pm["token"])[1]["data"]) == 1


# -- migration of existing data -----------------------------------------------------------

def test_migration_3_converts_codes_and_numbers_existing_deliverables(monkeypatch):
    """Apply migrations 1-2 to a scratch database, add legacy data, then upgrade to 3."""
    scratch = "acme_test_mig"
    admin_info = db.conninfo().replace(f"dbname={db.ENV.postgres_name}", "dbname=postgres")
    with psycopg.connect(admin_info, autocommit=True) as admin:
        admin.execute(sql.SQL("DROP DATABASE IF EXISTS {} WITH (FORCE)").format(sql.Identifier(scratch)))
        admin.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(scratch)))
    scratch_info = db.conninfo().replace(f"dbname={db.ENV.postgres_name}", f"dbname={scratch}")
    db.close()
    monkeypatch.setattr(db, "conninfo", lambda: scratch_info)
    try:
        monkeypatch.setattr(migrations, "MIGRATIONS", migrations.MIGRATIONS[:2])
        migrations.migrate()
        uid = db.fetch_one("INSERT INTO users (email, name, role) VALUES ('m@x.io', 'M', 'admin') RETURNING id")["id"]
        dept = db.fetch_one("INSERT INTO departments (name, code) VALUES ('D', 'D') RETURNING id")["id"]
        ids = {}
        for code in ("WEB-01", "WEB-02", "x-1", "DATAWAREHOUSE"):
            ids[code] = db.fetch_one("INSERT INTO projects (code, name, department_id, manager_id)"
                                     " VALUES (%s, 'n', %s, %s) RETURNING id", (code, dept, uid))["id"]
        for _ in range(3):
            db.execute("INSERT INTO deliverables (project_id, name) VALUES (%s, 'w')", (ids["WEB-01"],))
        monkeypatch.undo()
        monkeypatch.setattr(db, "conninfo", lambda: scratch_info)
        assert migrations.migrate() == migrations.latest_version()
        keys = {r["id"]: r["key"] for r in db.fetch_all("SELECT id, key FROM projects")}
        assert keys[ids["WEB-01"]] == "WEB" and keys[ids["WEB-02"]] == "WEB2"
        assert keys[ids["x-1"]].startswith("P") and keys[ids["DATAWAREHOUSE"]] == "DATAWA"
        rows = db.fetch_all("SELECT number, reporter_id FROM deliverables ORDER BY number")
        assert [r["number"] for r in rows] == [1, 2, 3] and {r["reporter_id"] for r in rows} == {uid}
        seq = db.fetch_one("SELECT deliverable_seq FROM projects WHERE id = %s", (ids["WEB-01"],))
        assert seq["deliverable_seq"] == 3
    finally:
        db.close()
        monkeypatch.undo()
        with psycopg.connect(admin_info, autocommit=True) as admin:
            admin.execute(sql.SQL("DROP DATABASE IF EXISTS {} WITH (FORCE)").format(sql.Identifier(scratch)))


def test_open_blockers_count_follows_the_blockers_status(call, org, make_project):
    pm = org["project_manager"]["token"]
    project = make_project(key="ENG")
    for _ in range(3):
        _deliverable(call, project, pm)
    call("POST", "/deliverables/ENG-3/links", {"type": "is_blocked_by", "target": "ENG-1"}, pm)
    call("POST", "/deliverables/ENG-3/links", {"type": "is_blocked_by", "target": "ENG-2"}, pm)
    assert call("GET", "/deliverables/ENG-3", token=pm)[1]["open_blockers"] == 2
    # Blocking others does not make ENG-1 blocked itself.
    assert call("GET", "/deliverables/ENG-1", token=pm)[1]["open_blockers"] == 0
    call("PUT", "/deliverables/ENG-1", {"status": "completed"}, pm)
    assert call("GET", "/deliverables/ENG-3", token=pm)[1]["open_blockers"] == 1
    call("PUT", "/deliverables/ENG-2", {"status": "completed"}, pm)
    assert call("GET", "/deliverables/ENG-3", token=pm)[1]["open_blockers"] == 0


def _blocked_pair(call, org, make_project, **second):
    """ENG-1 blocks ENG-2, and ENG-2 is marked blocked."""
    pm = org["project_manager"]["token"]
    project = make_project(key="ENG")
    for name, extra in (("First", {}), ("Second", {"status": "blocked", **second})):
        call("POST", "/deliverables", {"project_id": project["id"], "name": name, **extra}, pm)
    call("POST", "/deliverables/ENG-1/links", {"type": "blocks", "target": "ENG-2"}, pm)
    return pm


def test_finishing_the_last_blocker_releases_blocked_work(call, org, make_project):
    pm = _blocked_pair(call, org, make_project)
    project_id = call("GET", "/projects/ENG", token=pm)[1]["id"]
    third = call("POST", "/deliverables", {"project_id": project_id, "name": "Third"}, pm)[1]
    call("POST", f"/deliverables/{third['key']}/links", {"type": "blocks", "target": "ENG-2"}, pm)

    call("PUT", "/deliverables/ENG-1", {"status": "completed"}, pm)
    assert call("GET", "/deliverables/ENG-2", token=pm)[1]["status"] == "blocked"       # ENG-3 still blocks it
    call("PUT", f"/deliverables/{third['key']}", {"status": "completed"}, pm)
    assert call("GET", "/deliverables/ENG-2", token=pm)[1]["status"] == "not_started"
    second_id = call("GET", "/deliverables/ENG-2", token=pm)[1]["id"]
    changes = db.fetch_one("SELECT changes FROM audit_log WHERE entity = 'deliverables' AND entity_id = %s::text"
                           " AND changes ? 'status' ORDER BY id DESC LIMIT 1", (second_id,))
    assert changes["changes"]["status"] == {"from": "blocked", "to": "not_started"}


def test_released_work_resumes_in_progress_when_it_had_started(call, org, make_project):
    pm = _blocked_pair(call, org, make_project, progress_pct=30)
    call("PUT", "/deliverables/ENG-1", {"status": "completed"}, pm)
    assert call("GET", "/deliverables/ENG-2", token=pm)[1]["status"] == "in_progress"


def test_unlinking_the_last_blocker_releases_blocked_work(call, org, make_project):
    pm = _blocked_pair(call, org, make_project)
    link = call("GET", "/deliverables/ENG-1/links", token=pm)[1]["data"][0]
    assert call("DELETE", f"/deliverables/ENG-1/links/{link['id']}", token=pm)[0] == 204
    assert call("GET", "/deliverables/ENG-2", token=pm)[1]["status"] == "not_started"


def test_work_blocked_by_hand_stays_blocked(call, org, make_project):
    pm = org["project_manager"]["token"]
    project = make_project(key="ENG")
    call("POST", "/deliverables", {"project_id": project["id"], "name": "Manual", "status": "blocked"}, pm)
    call("POST", "/deliverables", {"project_id": project["id"], "name": "Other"}, pm)
    call("PUT", "/deliverables/ENG-2", {"status": "completed"}, pm)
    assert call("GET", "/deliverables/ENG-1", token=pm)[1]["status"] == "blocked"


def test_reopening_a_blocker_blocks_the_waiting_work_again(call, org, make_project):
    pm = _blocked_pair(call, org, make_project)
    call("PUT", "/deliverables/ENG-1", {"status": "completed"}, pm)
    assert call("GET", "/deliverables/ENG-2", token=pm)[1]["status"] == "not_started"
    call("PUT", "/deliverables/ENG-2", {"status": "in_progress", "progress_pct": 30}, pm)
    call("PUT", "/deliverables/ENG-1", {"status": "in_progress"}, pm)
    assert call("GET", "/deliverables/ENG-2", token=pm)[1]["status"] == "blocked"
    call("PUT", "/deliverables/ENG-1", {"status": "completed"}, pm)
    assert call("GET", "/deliverables/ENG-2", token=pm)[1]["status"] == "in_progress"   # progress was kept (not 0)


def test_reopening_does_not_touch_finished_dependents(call, org, make_project):
    pm = _blocked_pair(call, org, make_project)
    call("PUT", "/deliverables/ENG-1", {"status": "completed"}, pm)
    call("PUT", "/deliverables/ENG-2", {"status": "completed"}, pm)
    call("PUT", "/deliverables/ENG-1", {"status": "not_started"}, pm)
    assert call("GET", "/deliverables/ENG-2", token=pm)[1]["status"] == "completed"


def test_linking_an_unfinished_blocker_puts_work_on_hold(call, org, make_project):
    pm = org["project_manager"]["token"]
    project = make_project(key="ENG")
    for name in ("Blocker", "Waiting", "Done"):
        call("POST", "/deliverables", {"project_id": project["id"], "name": name,
                                       **({"status": "completed"} if name == "Done" else {})}, pm)
    call("POST", "/deliverables/ENG-1/links", {"type": "blocks", "target": "ENG-2"}, pm)
    assert call("GET", "/deliverables/ENG-2", token=pm)[1]["status"] == "blocked"
    call("POST", "/deliverables/ENG-3/links", {"type": "is_blocked_by", "target": "ENG-1"}, pm)  # finished stays
    assert call("GET", "/deliverables/ENG-3", token=pm)[1]["status"] == "completed"
    call("POST", "/deliverables/ENG-1/links", {"type": "relates_to", "target": "ENG-3"}, pm)  # never blocks


def test_deleting_a_blocker_releases_the_work_it_held_up(call, org, make_project):
    pm = _blocked_pair(call, org, make_project)
    assert call("DELETE", "/deliverables/ENG-1", token=pm)[0] == 204
    assert call("GET", "/deliverables/ENG-2", token=pm)[1]["status"] == "not_started"


def test_cannot_start_work_that_is_still_blocked(call, org, make_project):
    pm = _blocked_pair(call, org, make_project)
    status, body = call("PUT", "/deliverables/ENG-2", {"status": "in_progress"}, pm)
    assert status == 400 and body["error"]["details"]["status"] == "cannot start while blocked by ENG-1"
    assert call("PUT", "/deliverables/ENG-2", {"status": "blocked"}, pm)[0] == 200
    call("PUT", "/deliverables/ENG-1", {"status": "completed"}, pm)
    assert call("PUT", "/deliverables/ENG-2", {"status": "in_progress"}, pm)[0] == 200
