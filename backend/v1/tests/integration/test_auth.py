"""Login, refresh, current user, password change, logout-all and admin bootstrap."""

from dataclasses import replace
from datetime import UTC, datetime, timedelta

import jwt

from app import auth, db
from app.config import ENV


def _login(call, email, password):
    return call("POST", "/auth/login", {"email": email, "password": password})


def test_login_success_returns_tokens_and_user(call, make_user):
    user = make_user("viewer", email="Vera@Acme.example")
    status, body = _login(call, "VERA@acme.example", user["password"])
    assert status == 200
    assert body["token_type"] == "Bearer"
    assert body["expires_in"] == 15 * 60
    assert body["user"]["email"] == "vera@acme.example"
    assert "password_hash" not in body["user"] and "token_version" not in body["user"]
    assert db.fetch_one("SELECT last_login_at FROM users WHERE id = %s", (user["id"],))["last_login_at"]
    assert call("GET", "/auth/me", token=body["access_token"])[0] == 200


def test_login_failures_are_generic(call, make_user):
    user = make_user()
    for email, password in ((user["email"], "wrong-password"), ("nobody@acme.example", "whatever1")):
        status, body = _login(call, email, password)
        assert status == 401
        assert body["error"]["code"] == "invalid_credentials"
    assert _login(call, "x", None)[0] == 400


def test_login_rejects_inactive_and_passwordless_users(call, make_user):
    inactive = make_user(active=False)
    assert _login(call, inactive["email"], inactive["password"])[1]["error"]["code"] == "account_disabled"
    no_login = make_user(password=None)
    assert _login(call, no_login["email"], "anything1")[0] == 401


def test_protected_routes_require_a_valid_token(call, make_user):
    assert call("GET", "/auth/me")[1]["error"]["code"] == "unauthorized"
    assert call("GET", "/auth/me", token="garbage")[1]["error"]["code"] == "invalid_token"
    user = make_user()
    refresh = auth.issue_tokens(user)["refresh_token"]
    assert call("GET", "/auth/me", token=refresh)[1]["error"]["code"] == "invalid_token"  # wrong token type


def test_expired_token_is_reported(call, make_user):
    user = make_user()
    past = datetime.now(UTC) - timedelta(hours=1)
    token = jwt.encode({"sub": str(user["id"]), "typ": "access", "ver": 0, "iss": "acme-tracker",
                        "iat": past, "exp": past + timedelta(minutes=1)}, ENV.jwt_secret, algorithm="HS256")
    status, body = call("GET", "/auth/me", token=token)
    assert status == 401
    assert body["error"]["code"] == "token_expired"


def test_deactivated_user_loses_access_immediately(call, make_user):
    user = make_user()
    db.execute("UPDATE users SET is_active = false WHERE id = %s", (user["id"],))
    assert call("GET", "/auth/me", token=user["token"])[1]["error"]["code"] == "account_disabled"


def test_refresh_rotates_tokens(call, make_user):
    user = make_user()
    tokens = _login(call, user["email"], user["password"])[1]
    status, body = call("POST", "/auth/refresh", {"refresh_token": tokens["refresh_token"]})
    assert status == 200
    assert call("GET", "/auth/me", token=body["access_token"])[0] == 200
    assert call("POST", "/auth/refresh", {"refresh_token": tokens["access_token"]})[0] == 401


def test_logout_all_invalidates_every_session(call, make_user):
    user = make_user()
    first = _login(call, user["email"], user["password"])[1]
    second = _login(call, user["email"], user["password"])[1]
    assert call("POST", "/auth/logout-all", token=first["access_token"])[0] == 204
    assert call("GET", "/auth/me", token=second["access_token"])[0] == 401
    assert call("POST", "/auth/refresh", {"refresh_token": second["refresh_token"]})[0] == 401


def test_me_includes_role_capabilities(call, org):
    viewer = call("GET", "/auth/me", token=org["viewer"]["token"])[1]
    assert viewer["permissions"]["projects"] == ["read"]
    assert "settings" not in viewer["permissions"]
    pm = call("GET", "/auth/me", token=org["project_manager"]["token"])[1]
    assert pm["permissions"]["projects"] == ["create", "delete", "read", "update"]
    admin = call("GET", "/auth/me", token=org["admin"]["token"])[1]
    assert admin["permissions"]["settings"] == ["read", "update"]


def test_update_me_name_and_password(call, make_user):
    user = make_user()
    status, body = call("PUT", "/auth/me", {"name": "  New Name "}, user["token"])
    assert status == 200 and body["user"]["name"] == "New Name" and "tokens" not in body

    status, body = call("PUT", "/auth/me", {"password": "N3wPassword!"}, user["token"])
    assert status == 400 and body["error"]["details"] == {"current_password": "is incorrect"}
    status, body = call("PUT", "/auth/me", {"password": "short", "current_password": user["password"]},
                        user["token"])
    assert status == 400 and "at least 8" in body["error"]["details"]["password"]
    assert call("PUT", "/auth/me", {"current_password": "x"}, user["token"])[0] == 400

    status, body = call("PUT", "/auth/me", {"password": "N3wPassword!", "current_password": user["password"]},
                        user["token"])
    assert status == 200
    assert call("GET", "/auth/me", token=user["token"])[0] == 401  # old session revoked
    assert call("GET", "/auth/me", token=body["tokens"]["access_token"])[0] == 200
    assert _login(call, user["email"], "N3wPassword!")[0] == 200


def test_bootstrap_admin_created_once(monkeypatch):
    monkeypatch.setattr(auth, "ENV", replace(ENV, admin_email="Boss@Acme.example", admin_password="Bootstrap#1"))
    auth.ensure_bootstrap_admin()
    auth.ensure_bootstrap_admin()
    rows = db.fetch_all("SELECT email, role FROM users")
    assert rows == [{"email": "boss@acme.example", "role": "admin"}]


def test_bootstrap_skips_when_email_taken_by_non_admin(monkeypatch, make_user):
    make_user("viewer", email="boss@acme.example")
    monkeypatch.setattr(auth, "ENV", replace(ENV, admin_email="boss@acme.example", admin_password="Bootstrap#1"))
    auth.ensure_bootstrap_admin()
    assert db.fetch_one("SELECT count(*) AS n FROM users WHERE role = 'admin'")["n"] == 0


def test_missing_jwt_secret_is_a_server_error(call, make_user, monkeypatch):
    user = make_user()
    monkeypatch.setattr(auth, "ENV", replace(ENV, jwt_secret=""))
    assert call("GET", "/auth/me", token=user["token"])[0] == 500
