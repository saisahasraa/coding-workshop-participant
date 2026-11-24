"""Access switches, notifications, @mentions and attachments."""

import pytest

from app import db, notify, storage
from app.config import ENV, settings


def _item(call, org, project, token=None, **fields):
    status, body = call("POST", "/deliverables", {"project_id": project["id"], "name": "Work", **fields},
                        token or org["project_manager"]["token"])
    assert status == 201, body
    return body


def _inbox(call, user, **query):
    status, body = call("GET", "/notifications", query=query, token=user["token"])
    assert status == 200
    return body


def _messages(call, user):
    return [n["message"] for n in _inbox(call, user)["data"]]


# --- who may add, edit and comment ------------------------------------------------------------------------------

def test_by_default_anyone_but_viewers_can_add_and_edit_deliverables(call, org, make_project):
    project = make_project(key="OPEN")
    lead, member = org["team_lead"], org["team_member"]
    status, item = call("POST", "/deliverables", {"project_id": project["id"], "name": "From a lead"}, lead["token"])
    assert status == 201 and item["reporter_id"] == lead["id"]
    assert call("PUT", f"/deliverables/{item['key']}", {"priority": "high"}, member["token"])[0] == 200
    assert call("POST", "/deliverables", {"project_id": project["id"], "name": "x"}, org["viewer"]["token"])[0] == 403
    seen = call("GET", f"/deliverables/{item['key']}", token=org["viewer"]["token"])[1]
    assert seen["permissions"] == {"update": False, "delete": False, "editable_fields": []}
    assert call("DELETE", f"/deliverables/{item['key']}", token=lead["token"])[0] == 403   # reporters cannot delete


def test_a_manager_restricts_a_project_to_its_members(call, org, make_project):
    project = make_project(key="SHUT")
    pm, lead, member = org["project_manager"], org["team_lead"], org["team_member"]
    item = _item(call, org, project, owner_id=member["id"])
    other = _item(call, org, project)
    assert call("PUT", f"/projects/{project['id']}", {"edit_access": "members", "comment_access": "members"},
                pm["token"])[0] == 200

    assert call("POST", "/deliverables", {"project_id": project["id"], "name": "x"}, lead["token"])[0] == 403
    assert call("PUT", f"/deliverables/{other['key']}", {"priority": "low"}, lead["token"])[0] == 403
    assert call("POST", f"/deliverables/{item['key']}/comments", {"body": "hi"}, lead["token"])[0] == 403
    # The assignee is a member: they add, edit any deliverable of the project, and comment.
    assert call("POST", "/deliverables", {"project_id": project["id"], "name": "mine"}, member["token"])[0] == 201
    assert call("PUT", f"/deliverables/{other['key']}", {"priority": "low"}, member["token"])[0] == 200
    assert call("POST", f"/deliverables/{item['key']}/comments", {"body": "hi"}, member["token"])[0] == 201
    comments = call("GET", f"/deliverables/{item['key']}/comments", token=lead["token"])[1]
    assert comments["can_comment"] is False
    assert call("GET", f"/deliverables/{item['key']}/comments", token=member["token"])[1]["can_comment"] is True
    assert call("PUT", f"/projects/{project['id']}", {"edit_access": "nobody"}, pm["token"])[0] == 400


def test_projects_say_whether_the_caller_may_add_deliverables(call, org, make_project):
    project = make_project(key="FLG")
    flag = lambda who: call("GET", "/projects/FLG", token=org[who]["token"])[1]["permissions"]["add_deliverables"]  # noqa: E731
    assert (flag("project_manager"), flag("team_lead"), flag("viewer")) == (True, True, False)
    call("PUT", f"/projects/{project['id']}", {"edit_access": "members"}, org["project_manager"]["token"])
    assert (flag("project_manager"), flag("team_lead"), flag("admin")) == (True, False, True)
    call("PUT", f"/projects/{project['id']}", {"status": "cancelled"}, org["project_manager"]["token"])
    assert flag("project_manager") is False                                    # finished projects take no new work


def test_the_organisation_default_is_a_setting(call, org, make_project):
    project = make_project(key="DEF")
    admin, lead = org["admin"], org["team_lead"]
    assert call("PUT", "/settings/projects.default_edit_access", {"value": "members"}, admin["token"])[0] == 200
    assert call("PUT", "/settings/projects.default_comment_access", {"value": "members"}, admin["token"])[0] == 200
    item = _item(call, org, project)
    assert call("POST", "/deliverables", {"project_id": project["id"], "name": "x"}, lead["token"])[0] == 403
    assert call("POST", f"/deliverables/{item['key']}/comments", {"body": "hi"}, lead["token"])[0] == 403
    assert call("PUT", f"/projects/{project['id']}", {"edit_access": "everyone"}, admin["token"])[0] == 200
    assert call("POST", "/deliverables", {"project_id": project["id"], "name": "x"}, lead["token"])[0] == 201
    assert call("POST", f"/deliverables/{item['key']}/comments", {"body": "x"}, org["viewer"]["token"])[0] == 403
    settings.invalidate()


def test_reporters_see_hidden_projects_they_report_in(call, org, make_project):
    secret = make_project(key="SEC", visibility="members")
    lead = org["team_lead"]
    assert call("GET", "/projects/SEC", token=lead["token"])[0] == 404
    _item(call, org, secret, reporter_id=lead["id"])
    assert call("GET", "/projects/SEC", token=lead["token"])[0] == 200


# --- notifications ----------------------------------------------------------------------------------------------

def test_people_involved_are_told_about_changes_but_not_their_own(call, org, make_project):
    project = make_project(key="NTF")
    pm, member, lead = org["project_manager"], org["team_member"], org["team_lead"]
    item = _item(call, org, project, owner_id=member["id"])
    assert _messages(call, member) == [f"{pm['name']} assigned you NTF-1 “Work”"]
    assert _messages(call, pm) == []                                        # nobody hears about their own action

    call("PUT", f"/deliverables/{item['key']}", {"status": "in_progress"}, member["token"])
    assert _messages(call, pm)[0] == f"{member['name']} moved NTF-1 “Work” to in progress"
    call("PUT", f"/deliverables/{item['key']}", {"due_date": "2099-01-01", "priority": "high"}, pm["token"])
    assert _messages(call, member)[0] == f"{pm['name']} changed the due date, priority of NTF-1 “Work”"
    call("PUT", f"/deliverables/{item['key']}", {"progress_pct": 40}, member["token"])
    assert len(_messages(call, pm)) == 1                                    # progress alone is not announced

    call("PUT", f"/deliverables/{item['key']}", {"owner_id": lead["id"]}, pm["token"])
    assert _messages(call, lead) == [f"{pm['name']} assigned you NTF-1 “Work”"]
    assert _messages(call, member)[0] == f"{pm['name']} reassigned NTF-1 “Work” to someone else"

    call("DELETE", f"/deliverables/{item['key']}", token=pm["token"])
    assert _messages(call, lead)[0] == f"{pm['name']} deleted NTF-1 “Work”"


def test_blocking_and_releasing_tell_the_person_doing_the_work(call, org, make_project):
    project = make_project(key="BLK")
    pm, member = org["project_manager"], org["team_member"]
    first, second = _item(call, org, project), _item(call, org, project, owner_id=member["id"])
    call("POST", f"/deliverables/{first['key']}/links", {"type": "blocks", "target": second["key"]}, pm["token"])
    assert "is now blocked: something it depends on is not finished" in _messages(call, member)[0]
    call("PUT", f"/deliverables/{first['key']}", {"status": "completed"}, pm["token"])
    assert "is now not started: what blocked it is done" in _messages(call, member)[0]


def test_project_and_leave_changes_reach_the_right_people(call, org, make_project, team):
    admin, pm, pm2, member, lead = (org[k] for k in ("admin", "project_manager", "pm2", "team_member", "team_lead"))
    project = make_project(key="PRJ")
    _item(call, org, project, owner_id=member["id"])
    call("PUT", f"/projects/{project['id']}", {"status": "on_hold"}, pm["token"])
    assert _messages(call, member)[0] == f"{pm['name']} moved project PRJ “{project['name']}” to on hold"
    call("PUT", f"/projects/{project['id']}", {"manager_id": pm2["id"]}, admin["token"])
    assert _messages(call, pm2)[0].startswith(f"{admin['name']} made you the manager of project PRJ")

    body = {"user_id": member["id"], "type": "vacation", "start_date": "2099-03-02", "end_date": "2099-03-03"}
    assert call("POST", "/leaves", body, lead["token"])[0] == 201
    assert _messages(call, member)[0] == f"{lead['name']} recorded leave for you: 2099-03-02 to 2099-03-03"
    mine = {"type": "sick", "start_date": "2099-04-01", "end_date": "2099-04-01"}
    assert call("POST", "/leaves", mine, member["token"])[0] == 201
    assert len(_messages(call, member)) == 3                                 # their own leave adds nothing


def test_reading_notifications(call, org, make_project):
    project = make_project(key="RDX")
    member = org["team_member"]
    for _ in range(3):
        _item(call, org, project, owner_id=member["id"])
    inbox = _inbox(call, member)
    assert inbox["unread"] == 3 and inbox["data"][0]["actor_name"] == org["project_manager"]["name"]
    assert inbox["data"][0]["link"] == "/deliverables/RDX-3"
    first = inbox["data"][0]["id"]
    assert call("POST", "/notifications/read", {"ids": [first]}, member["token"])[0] == 204
    assert _inbox(call, member)["unread"] == 2 and len(_inbox(call, member, unread="true")["data"]) == 2
    assert call("POST", "/notifications/read", {"ids": [first]}, org["viewer"]["token"])[0] == 204   # not theirs: no-op
    assert call("POST", "/notifications/read", None, member["token"])[0] == 204
    assert _inbox(call, member)["unread"] == 0 and len(_inbox(call, member)["data"]) == 3
    assert call("POST", "/notifications/read", {"ids": "all"}, member["token"])[0] == 204
    assert call("GET", "/notifications")[0] == 401


def test_email_channel_is_best_effort(call, org, make_project, monkeypatch):
    sent = []

    class FakeSes:
        def send_email(self, **kwargs):
            sent.append(kwargs)

    fake = type("Boto", (), {"client": staticmethod(lambda *a, **k: FakeSes())})
    monkeypatch.setitem(__import__("sys").modules, "boto3", fake)
    monkeypatch.setitem(__import__("sys").modules, "botocore", type("B", (), {}))
    monkeypatch.setitem(__import__("sys").modules, "botocore.config", type("C", (), {"Config": lambda **k: None}))
    monkeypatch.setattr(notify, "ENV", type("E", (), {"notify_from_email": "tracker@acme.example"}))
    call("PUT", "/settings/notifications.email_enabled", {"value": True}, org["admin"]["token"])

    project = make_project(key="EML")
    member = org["team_member"]
    _item(call, org, project, owner_id=member["id"])
    assert sent[0]["Destination"] == {"ToAddresses": [member["email"]]} and sent[0]["Source"] == "tracker@acme.example"
    assert "/deliverables/EML-1" in sent[0]["Message"]["Body"]["Text"]["Data"]
    assert db.fetch_one("SELECT emailed_at FROM notifications WHERE user_id = %s", (member["id"],))["emailed_at"]

    FakeSes.send_email = lambda self, **k: (_ for _ in ()).throw(RuntimeError("no route to SES"))
    assert call("POST", "/deliverables", {"project_id": project["id"], "name": "Two", "owner_id": member["id"]},
                org["project_manager"]["token"])[0] == 201                   # the change still succeeds
    assert len(_messages(call, member)) == 2
    settings.invalidate()


def test_admin_can_test_email_delivery_and_see_why_it_fails(call, org, monkeypatch):
    admin = org["admin"]
    assert call("POST", "/notifications/test-email", None, org["project_manager"]["token"])[0] == 403
    status, body = call("POST", "/notifications/test-email", None, admin["token"])
    assert status == 200 and body["sent"] is False and "No sender address" in body["error"]

    monkeypatch.setattr(notify, "ENV", type("E", (), {"notify_from_email": "tracker@acme.example"}))
    sent = []
    monkeypatch.setattr(notify, "_send", lambda to, subject, text: sent.append((to, subject)))
    body = call("POST", "/notifications/test-email", None, admin["token"])[1]
    assert body == {"to": admin["email"], "from": "tracker@acme.example", "enabled": False, "sent": True, "error": None}
    assert sent == [(admin["email"], "ACME Project Tracker test email")]

    def refuse(*_args):
        raise PermissionError("AccessDenied: not authorized to perform ses:SendEmail")

    monkeypatch.setattr(notify, "_send", refuse)
    body = call("POST", "/notifications/test-email", None, admin["token"])[1]
    assert body["sent"] is False and body["error"].startswith("PermissionError: AccessDenied")


def test_whoever_can_edit_a_deliverable_can_link_it(call, org, make_project):
    project = make_project(key="LNK", edit_access="members")
    pm, pm2, lead = org["project_manager"], org["pm2"], org["team_lead"]
    mine = _item(call, org, project, owner_id=pm2["id"])            # pm2 is the assignee, not the project's manager
    other = _item(call, org, project)
    status, link = call("POST", f"/deliverables/{mine['key']}/links", {"type": "is_blocked_by", "target": other["key"]},
                        pm2["token"])
    assert status == 201
    assert call("DELETE", f"/deliverables/{mine['key']}/links/{link['id']}", token=pm2["token"])[0] == 204
    status, body = call("POST", f"/deliverables/{other['key']}/links", {"type": "blocks", "target": mine["key"]},
                        lead["token"])
    assert status == 403 and "can edit this deliverable" in body["error"]["message"]     # not a member here
    assert call("POST", f"/deliverables/{other['key']}/links", {"type": "blocks", "target": mine["key"]},
                org["viewer"]["token"])[0] == 403
    assert call("POST", f"/deliverables/{other['key']}/links", {"type": "blocks", "target": mine["key"]},
                pm["token"])[0] == 201


# --- mentions ---------------------------------------------------------------------------------------------------

def test_mentions_are_stored_shown_and_notified(call, org, make_project, make_user):
    project = make_project(key="MEN")
    pm, member, lead = org["project_manager"], org["team_member"], org["team_lead"]
    gone = make_user("team_member", active=False)
    item = _item(call, org, project, owner_id=member["id"])
    status, comment = call("POST", f"/deliverables/{item['key']}/comments",
                           {"body": f"@{lead['name']} please look", "mentions": [lead["id"], gone["id"], 99999]},
                           pm["token"])
    assert status == 201 and comment["mentions"] == [{"id": lead["id"], "name": lead["name"]}]
    assert _messages(call, lead) == [f"{pm['name']} mentioned you on MEN-1 “Work”"]
    assert _messages(call, member)[0] == f"{pm['name']} commented on MEN-1 “Work”"

    # Editing to mention someone new tells only the newly mentioned person.
    both = {"body": "both of you", "mentions": [lead["id"], member["id"]]}
    call("PUT", f"/comments/{comment['id']}", both, pm["token"])
    assert len(_messages(call, lead)) == 1
    assert _messages(call, member)[0] == f"{pm['name']} mentioned you on MEN-1 “Work”"
    listed = call("GET", f"/deliverables/{item['key']}/comments", token=pm["token"])[1]["data"][0]
    assert [m["id"] for m in listed["mentions"]] == sorted([lead["id"], member["id"]], key=lambda i: {
        lead["id"]: lead["name"], member["id"]: member["name"]}[i])

    # Earlier commenters hear about later comments.
    call("POST", f"/deliverables/{item['key']}/comments", {"body": "on it"}, lead["token"])
    assert _messages(call, pm)[0] == f"{lead['name']} commented on MEN-1 “Work”"


@pytest.mark.parametrize("mentions", ["me", [True], ["1"], list(range(1, 30))])
def test_mentions_are_validated(call, org, make_project, mentions):
    item = _item(call, org, make_project(key="VAL"))
    status, body = call("POST", f"/deliverables/{item['key']}/comments", {"body": "x", "mentions": mentions},
                        org["project_manager"]["token"])
    assert status == 400 and "mentions" in body["error"]["details"]


# --- attachments ------------------------------------------------------------------------------------------------

@pytest.fixture
def fake_storage(monkeypatch):
    """Signed links without S3: the test only needs to see what would be signed."""
    monkeypatch.setattr(storage, "is_configured", lambda: True)
    monkeypatch.setattr(storage, "upload_link", lambda key, ctype: {
        "url": f"https://s3.test/{key}", "method": "PUT", "headers": {"Content-Type": ctype}, "expires_in": 300})
    monkeypatch.setattr(storage, "download_link",
                        lambda key, name, ctype, inline: f"https://s3.test/{key}?inline={int(inline)}")


def _upload(call, user, key, **fields):
    body = {"filename": "Design v2.png", "content_type": "image/PNG", "size_bytes": 2048, **fields}
    return call("POST", f"/deliverables/{key}/attachments", body, user["token"])


def test_attach_reference_list_download_and_delete(call, org, make_project, fake_storage):
    project = make_project(key="ATT")
    pm, member, viewer = org["project_manager"], org["team_member"], org["viewer"]
    item = _item(call, org, project, owner_id=member["id"])
    status, file = _upload(call, member, item["key"])
    assert status == 201 and file["filename"] == "Design v2.png" and file["is_image"] is True
    assert file["content_type"] == "image/png" and file["comment_id"] is None
    assert file["upload"]["method"] == "PUT" and f"deliverables/{item['id']}/" in file["upload"]["url"]
    assert file["upload"]["headers"] == {"Content-Type": "image/png"} and "storage_key" not in file

    text = f"see [Design v2.png](attachment:{file['id']}) and (attachment:99999)"
    comment = call("POST", f"/deliverables/{item['key']}/comments", {"body": text}, member["token"])[1]
    listed = call("GET", f"/deliverables/{item['key']}/attachments", token=viewer["token"])[1]
    assert listed["total"] == 1 and listed["enabled"] is True and listed["max_size_mb"] == 10
    assert listed["data"][0]["comment_id"] == comment["id"] and listed["data"][0]["uploader_name"] == member["name"]
    assert listed["data"][0]["permissions"] == {"delete": False}

    status, link = call("GET", f"/attachments/{file['id']}/download", token=viewer["token"])
    assert status == 200 and link["url"].endswith("?inline=1") and link["filename"] == "Design v2.png"
    doc = _upload(call, pm, item["key"], filename="plan.docx", content_type="application/msword")[1]
    assert doc["is_image"] is False
    assert call("GET", f"/attachments/{doc['id']}/download", token=pm["token"])[1]["url"].endswith("?inline=0")

    assert call("DELETE", f"/attachments/{file['id']}", token=viewer["token"])[0] == 403
    assert call("DELETE", f"/attachments/{doc['id']}", token=member["token"])[0] == 403        # someone else's file
    assert call("DELETE", f"/attachments/{file['id']}", token=member["token"])[0] == 204       # the uploader
    assert call("DELETE", f"/attachments/{doc['id']}", token=org["admin"]["token"])[0] == 204
    assert call("GET", f"/attachments/{doc['id']}/download", token=pm["token"])[0] == 404


def test_attachment_rules(call, org, make_project, fake_storage):
    project = make_project(key="RUL", comment_access="members")
    secret = make_project(key="SEC", visibility="members")
    pm, lead, viewer = org["project_manager"], org["team_lead"], org["viewer"]
    item, hidden = _item(call, org, project), _item(call, org, secret)
    assert _upload(call, viewer, item["key"])[0] == 403
    assert _upload(call, lead, item["key"])[0] == 403                          # not a member of this project
    status, body = _upload(call, pm, item["key"], size_bytes=11 * 1024 * 1024)
    assert status == 400 and body["error"]["details"]["size_bytes"] == "files can be at most 10 MB"
    assert _upload(call, pm, item["key"], size_bytes=0)[0] == 400
    assert _upload(call, pm, item["key"], filename="")[0] == 400
    tricky = _upload(call, pm, item["key"], filename="..\\\\..\\\\evil<script>.html", content_type="text/html")[1]
    assert tricky["filename"] == "evil_script_.html" and tricky["is_image"] is False
    assert call("GET", f"/attachments/{tricky['id']}/download", token=pm["token"])[1]["url"].endswith("?inline=0")

    file = _upload(call, pm, hidden["key"])[1]
    assert call("GET", f"/attachments/{file['id']}/download", token=viewer["token"])[0] == 404  # hidden project
    assert call("GET", f"/deliverables/{hidden['key']}/attachments", token=viewer["token"])[0] == 404
    assert call("GET", "/attachments/999999/download", token=pm["token"])[0] == 404
    # A file cannot be claimed by a comment on another deliverable.
    call("POST", f"/deliverables/{item['key']}/comments", {"body": f"(attachment:{file['id']})"}, pm["token"])
    files = call("GET", f"/deliverables/{hidden['key']}/attachments", token=pm["token"])[1]["data"]
    assert files[0]["comment_id"] is None


def test_without_a_bucket_uploads_say_so(call, org, make_project):
    item = _item(call, org, make_project(key="NOB"))
    assert not ENV.attachments_bucket
    status, body = _upload(call, org["project_manager"], item["key"])
    assert status == 503 and body["error"]["code"] == "storage_unavailable"
    assert call("GET", f"/deliverables/{item['key']}/attachments", token=org["viewer"]["token"])[1]["enabled"] is False
