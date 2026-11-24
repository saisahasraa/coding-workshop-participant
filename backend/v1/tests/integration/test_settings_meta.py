"""Runtime settings administration and UI metadata."""

from app import db


def test_admin_lists_updates_and_resets_settings(call, org):
    token = org["admin"]["token"]
    status, body = call("GET", "/settings", token=token)
    assert status == 200
    page = next(s for s in body["data"] if s["key"] == "api.default_page_size")
    assert page == {**page, "value": 25, "default": 25, "overridden": False, "group": "api", "kind": "int"}

    status, body = call("PUT", "/settings/api.default_page_size", {"value": 2}, token)
    assert status == 200 and body["value"] == 2 and body["overridden"] and body["updated_by_name"]
    assert len(call("GET", "/users", token=token)[1]["data"]) == 2  # applied without a restart

    assert call("DELETE", "/settings/api.default_page_size", token=token)[0] == 204
    assert call("GET", "/users", token=token)[1]["limit"] == 25
    actions = db.fetch_all("SELECT entity, entity_id, changes FROM audit_log WHERE entity = 'app_settings'")
    assert [a["changes"]["value"]["to"] for a in actions] == [2, 25]


def test_setting_validation(call, org):
    token = org["admin"]["token"]
    assert call("PUT", "/settings/api.default_page_size", {"value": 0}, token)[0] == 400
    assert call("PUT", "/settings/api.default_page_size", {"value": "10"}, token)[0] == 400
    assert call("PUT", "/settings/api.default_page_size", {"value": 5, "extra": 1}, token)[0] == 400
    assert call("PUT", "/settings/nope.key", {"value": 1}, token)[0] == 404
    assert call("DELETE", "/settings/nope.key", token=token)[0] == 404
    assert call("PUT", "/settings/logging.level", {"value": "TRACE"}, token)[0] == 400


def test_settings_are_admin_only(call, org):
    for role in ("project_manager", "team_lead", "team_member", "viewer"):
        assert call("GET", "/settings", token=org[role]["token"])[0] == 403
        assert call("PUT", "/settings/app.name", {"value": "X"}, org[role]["token"])[0] == 403
        assert call("DELETE", "/settings/app.name", token=org[role]["token"])[0] == 403


def test_meta_exposes_enums_and_public_settings(call, org):
    call("PUT", "/settings/app.name", {"value": "ACME PMO"}, org["admin"]["token"])
    status, body = call("GET", "/meta", token=org["viewer"]["token"])
    assert status == 200
    assert body["roles"][0] == "admin"
    assert {"value": "completed", "category": "done"} in body["deliverable_statuses"]
    assert body["settings"]["app.name"] == "ACME PMO"
    assert "db.statement_timeout_ms" not in body["settings"]  # not public
    assert call("GET", "/meta")[0] == 401
