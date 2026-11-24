"""Users (admin-managed accounts) and departments."""

from app import db


def test_admin_creates_user_with_hashed_password(call, org):
    status, body = call("POST", "/users", {"email": "New@Acme.example", "name": "New Person", "role": "team_lead",
                                           "password": "Welcome#123"}, org["admin"]["token"])
    assert status == 201
    assert body["email"] == "new@acme.example"
    assert body["can_login"] is True
    assert body["weekly_capacity_hours"] == 40
    assert "password_hash" not in body and "token_version" not in body and "password" not in body
    stored = db.fetch_one("SELECT password_hash FROM users WHERE id = %s", (body["id"],))["password_hash"]
    assert stored.startswith("scrypt$")
    assert call("POST", "/auth/login", {"email": "new@acme.example", "password": "Welcome#123"})[0] == 200


def test_user_validation_and_duplicates(call, org):
    token = org["admin"]["token"]
    status, body = call("POST", "/users", {"email": "bad", "name": "", "role": "boss"}, token)
    assert status == 400
    assert set(body["error"]["details"]) == {"email", "name", "role"}
    assert call("POST", "/users", {"email": "x@acme.example", "name": "X", "password": "short"}, token)[0] == 400
    assert call("POST", "/users", {"email": org["viewer"]["email"], "name": "Dup"}, token)[0] == 409


def test_non_admins_cannot_manage_users(call, org):
    for role in ("project_manager", "team_lead", "team_member", "viewer"):
        token = org[role]["token"]
        assert call("POST", "/users", {}, token)[0] == 403  # forbidden before validation
        assert call("PUT", f"/users/{org['viewer']['id']}", {"name": "x"}, token)[0] == 403
        assert call("DELETE", f"/users/{org['viewer']['id']}", token=token)[0] == 403
        assert call("GET", "/users", token=token)[0] == 200


def test_user_list_search_filter_sort_and_paging(call, org):
    token = org["viewer"]["token"]
    status, body = call("GET", "/users", token=token, query={"role": "project_manager,admin", "sort": "-name"})
    assert status == 200
    assert body["total"] == 3
    assert [u["name"] for u in body["data"]] == sorted((u["name"] for u in body["data"]), reverse=True)
    body = call("GET", "/users", token=token, query={"q": "viewer"})[1]
    assert [u["id"] for u in body["data"]] == [org["viewer"]["id"]]
    body = call("GET", "/users", token=token, query={"limit": "2", "offset": "1"})[1]
    assert body["total"] == 6 and len(body["data"]) == 2 and body["offset"] == 1
    for bad in ({"sort": "password_hash"}, {"limit": "0"}, {"offset": "-1"}, {"nope": "1"}, {"role": "boss"}):
        assert call("GET", "/users", token=token, query=bad)[0] == 400


def test_role_change_signs_user_out(call, org):
    target = org["team_member"]
    status, body = call("PUT", f"/users/{target['id']}", {"role": "viewer"}, org["admin"]["token"])
    assert status == 200 and body["role"] == "viewer"
    assert call("GET", "/auth/me", token=target["token"])[0] == 401


def test_admin_cannot_demote_deactivate_or_delete_self(call, org, make_user):
    admin = org["admin"]
    path = f"/users/{admin['id']}"
    assert call("PUT", path, {"role": "viewer"}, admin["token"])[1]["error"]["details"]["role"]
    assert call("PUT", path, {"is_active": False}, admin["token"])[0] == 400
    assert call("DELETE", path, token=admin["token"])[0] == 400
    assert call("PUT", path, {"name": "Still Admin", "role": "admin"}, admin["token"])[0] == 200

    # Another admin can, which is safe: the acting admin remains.
    other = make_user("admin")
    assert call("PUT", path, {"is_active": False}, other["token"])[0] == 200
    assert call("GET", "/auth/me", token=admin["token"])[0] == 401
    assert call("DELETE", path, token=other["token"])[0] == 204


def test_deleting_referenced_user_conflicts(call, org, make_project):
    make_project()
    status, body = call("DELETE", f"/users/{org['project_manager']['id']}", token=org["admin"]["token"])
    assert status == 409
    assert body["error"]["code"] == "conflict"


def test_get_unknown_and_bad_ids(call, org):
    token = org["admin"]["token"]
    assert call("GET", "/users/999999", token=token)[0] == 404
    assert call("GET", "/users/abc", token=token)[0] == 400
    assert call("PATCH", "/users/1", {}, token)[0] == 405


def test_departments_crud(call, org):
    admin, pm = org["admin"]["token"], org["project_manager"]["token"]
    status, dept = call("POST", "/departments", {"name": "Finance", "code": "fin"}, admin)
    assert status == 201 and dept["code"] == "FIN" and dept["project_count"] == 0
    assert call("POST", "/departments", {"name": "Finance 2", "code": "FIN"}, admin)[0] == 409
    assert call("POST", "/departments", {"name": "Ops", "code": "OPS"}, pm)[0] == 403
    assert call("PUT", f"/departments/{dept['id']}", {"description": "Money"}, admin)[1]["description"] == "Money"
    assert call("GET", "/departments", token=pm, query={"q": "fin"})[1]["total"] == 1
    assert call("DELETE", f"/departments/{dept['id']}", token=admin)[0] == 204
    assert call("DELETE", f"/departments/{org['department_id']}", token=admin)[0] == 204


def test_department_in_use_cannot_be_deleted(call, org, make_project):
    make_project()
    assert call("DELETE", f"/departments/{org['department_id']}", token=org["admin"]["token"])[0] == 409
