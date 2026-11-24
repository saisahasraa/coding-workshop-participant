"""
Authentication: JWT access/refresh tokens, the current user, and the auth endpoints.

Tokens are stateless and carry the user's ``token_version``. The user row is loaded on every
request, so deactivation, role changes and "log out everywhere" (a version bump) take effect
immediately without a token table.
"""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime, timedelta

import jwt
from psycopg import sql

from app import db, log, migrations
from app.config import ENV, get_setting
from app.http import ApiError, BadRequest, Request, Unauthorized, ValidationFailed, no_content, ok
from app.passwords import hash_password, verify_password
from app.validation import Field, validate_fields

logger = logging.getLogger(__name__)

ACCESS, REFRESH = "access", "refresh"
_ALGORITHM = "HS256"
_ISSUER = "acme-tracker"
# Verified when the email is unknown, so response time does not reveal which emails exist.
_DUMMY_HASH = hash_password(uuid.uuid4().hex)

_LOAD_USER = sql.SQL(
    "SELECT id, email, name, role, job_title, weekly_capacity_hours, is_active, token_version,"
    " last_login_at, (password_hash IS NOT NULL) AS can_login, created_at, updated_at"
    " FROM users WHERE id = %s"
)


# ---------------------------------------------------------------------------
# Tokens
# ---------------------------------------------------------------------------

def _secret() -> str:
    if not ENV.jwt_secret:
        logger.error("JWT_SECRET is not configured")
        raise ApiError(500, "internal_error", "Authentication is not configured")
    return ENV.jwt_secret


def _encode(user: dict, kind: str, lifetime: timedelta) -> str:
    now = datetime.now(UTC)
    claims = {"sub": str(user["id"]), "typ": kind, "ver": user["token_version"],
              "iss": _ISSUER, "iat": now, "exp": now + lifetime}
    return jwt.encode(claims, _secret(), algorithm=_ALGORITHM)


def issue_tokens(user: dict) -> dict:
    """Return a new access/refresh token pair for ``user``."""
    minutes = get_setting("auth.access_token_minutes")
    return {
        "access_token": _encode(user, ACCESS, timedelta(minutes=minutes)),
        "refresh_token": _encode(user, REFRESH, timedelta(days=get_setting("auth.refresh_token_days"))),
        "token_type": "Bearer",
        "expires_in": minutes * 60,
    }


def decode(token: str, kind: str) -> dict:
    """Validate ``token`` and return its claims; raise ``Unauthorized`` otherwise."""
    try:
        claims = jwt.decode(token, _secret(), algorithms=[_ALGORITHM], issuer=_ISSUER,
                            options={"require": ["sub", "typ", "ver", "exp"]})
    except jwt.ExpiredSignatureError:
        raise Unauthorized("Your session has expired; please sign in again", code="token_expired") from None
    except jwt.InvalidTokenError:
        raise Unauthorized("Invalid authentication token", code="invalid_token") from None
    if claims.get("typ") != kind:
        raise Unauthorized("Invalid authentication token", code="invalid_token")
    return claims


# ---------------------------------------------------------------------------
# Current user
# ---------------------------------------------------------------------------

def load_user(user_id: int) -> dict | None:
    """Fetch a user row (without the password hash)."""
    return db.fetch_one(_LOAD_USER, (user_id,))


def _user_from_claims(claims: dict) -> dict:
    try:
        user = load_user(int(claims["sub"]))
    except (TypeError, ValueError):
        user = None
    if user is None or claims["ver"] != user["token_version"]:
        raise Unauthorized("Your session is no longer valid; please sign in again", code="invalid_token")
    if not user["is_active"]:
        raise Unauthorized("Your account is deactivated", code="account_disabled")
    return user


def authenticate(request: Request) -> dict:
    """Resolve the bearer token on ``request`` to an active user."""
    header = request.headers.get("authorization", "")
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise Unauthorized()
    user = _user_from_claims(decode(token.strip(), ACCESS))
    log.bind(user_id=user["id"])
    return user


def public_user(user: dict) -> dict:
    """User fields safe to return to clients."""
    return {k: v for k, v in user.items() if k != "token_version"}


# ---------------------------------------------------------------------------
# Passwords
# ---------------------------------------------------------------------------

def check_password_policy(password: str, field: str = "password") -> None:
    """Raise ``ValidationFailed`` if ``password`` does not meet the configured policy."""
    minimum = get_setting("auth.password_min_length")
    if len(password) < minimum:
        raise ValidationFailed({field: f"must be at least {minimum} characters"})
    if len(password) > 128:
        raise ValidationFailed({field: "must be at most 128 characters"})


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

LOGIN_FIELDS = {
    "email": Field("string", required=True, nullable=False, max_len=255),
    "password": Field("string", required=True, nullable=False, max_len=128),
}
REFRESH_FIELDS = {"refresh_token": Field("string", required=True, nullable=False, max_len=4096)}
ME_FIELDS = {
    "name": Field("string", nullable=False, max_len=200),
    "password": Field("string", nullable=False, max_len=128),
    "current_password": Field("string", nullable=False, max_len=128),
}


def login(request: Request) -> dict:
    """POST /auth/login: exchange email + password for tokens."""
    values = validate_fields(LOGIN_FIELDS, request.body)
    row = db.fetch_one("SELECT id, password_hash, is_active FROM users WHERE email = %s",
                       (values["email"].lower(),))
    password_ok = verify_password(values["password"], row["password_hash"] if row else _DUMMY_HASH)
    if row is None or not password_ok:
        logger.info("Login failed", extra={"fields": {"reason": "invalid_credentials"}})
        raise Unauthorized("Invalid email or password", code="invalid_credentials")
    if not row["is_active"]:
        raise Unauthorized("Your account is deactivated", code="account_disabled")
    db.execute("UPDATE users SET last_login_at = now() WHERE id = %s", (row["id"],))
    user = load_user(row["id"])
    log.bind(user_id=user["id"])
    logger.info("Login succeeded")
    return ok({**issue_tokens(user), "user": public_user(user)})


def refresh(request: Request) -> dict:
    """POST /auth/refresh: exchange a refresh token for a new token pair."""
    values = validate_fields(REFRESH_FIELDS, request.body)
    user = _user_from_claims(decode(values["refresh_token"], REFRESH))
    return ok({**issue_tokens(user), "user": public_user(user)})


def me(request: Request) -> dict:
    """GET /auth/me: the current user and the actions their role allows per resource."""
    from app.resources import capabilities  # pylint: disable=import-outside-toplevel (avoids import cycle)

    return ok({"user": public_user(request.user), "permissions": capabilities(request.user)})


def update_me(request: Request) -> dict:
    """PUT /auth/me: change own name and/or password (password needs ``current_password``)."""
    values = validate_fields(ME_FIELDS, request.body, partial=True)
    user = request.user
    assignments: list[sql.Composable] = []
    params: list = []
    if "name" in values:
        assignments.append(sql.SQL("name = %s"))
        params.append(values["name"])
    tokens = None
    if "password" in values:
        current = db.fetch_one("SELECT password_hash FROM users WHERE id = %s", (user["id"],))
        if not verify_password(values.get("current_password") or "", current["password_hash"]):
            raise ValidationFailed({"current_password": "is incorrect"})
        check_password_policy(values["password"])
        assignments += [sql.SQL("password_hash = %s"), sql.SQL("token_version = token_version + 1")]
        params.append(hash_password(values["password"]))
    elif "current_password" in values:
        raise BadRequest("current_password is only used together with password")
    assignments.append(sql.SQL("updated_at = now()"))
    db.execute(sql.SQL("UPDATE users SET {} WHERE id = %s").format(sql.SQL(", ").join(assignments)),
               (*params, user["id"]))
    updated = load_user(user["id"])
    if "password" in values:
        tokens = issue_tokens(updated)  # other sessions are now invalid; keep this one signed in
    return ok({"user": public_user(updated), **({"tokens": tokens} if tokens else {})})


def logout_all(request: Request) -> dict:
    """POST /auth/logout-all: invalidate every session of the current user."""
    db.execute("UPDATE users SET token_version = token_version + 1 WHERE id = %s", (request.user["id"],))
    logger.info("All sessions revoked")
    return no_content()


# ---------------------------------------------------------------------------
# Bootstrap
# ---------------------------------------------------------------------------

def ensure_bootstrap_admin() -> None:
    """Create the first admin from ``ADMIN_EMAIL``/``ADMIN_PASSWORD`` when no active admin exists."""
    if not (ENV.admin_email and ENV.admin_password):
        return
    if db.fetch_one("SELECT 1 AS ok FROM users WHERE role = 'admin' AND is_active"):
        return
    email = ENV.admin_email.strip().lower()
    if db.fetch_one("SELECT 1 AS ok FROM users WHERE email = %s", (email,)):
        logger.warning("No active admin, and bootstrap email %s already belongs to a non-admin user", email)
        return
    db.execute(
        "INSERT INTO users (email, name, password_hash, role) VALUES (%s, %s, %s, 'admin')",
        (email, "Administrator", hash_password(ENV.admin_password)),
    )
    logger.info("Bootstrap admin created", extra={"fields": {"email": email}})


def register() -> None:
    """Install authentication and the admin bootstrap hook."""
    from app import http  # pylint: disable=import-outside-toplevel

    http.set_authenticator(authenticate)
    migrations.on_ready(ensure_bootstrap_admin)
