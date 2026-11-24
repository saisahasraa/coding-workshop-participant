"""Integration fixtures: a disposable PostgreSQL database per test session."""

import os
from collections.abc import Iterator

import psycopg
import pytest
from psycopg import sql

from app import db, migrations
from app.config import settings

TEST_DB = os.environ["POSTGRES_NAME"]


def _admin_conninfo() -> str:
    return psycopg.conninfo.make_conninfo(
        host=os.environ["POSTGRES_HOST"], port=os.environ["POSTGRES_PORT"],
        user=os.environ["POSTGRES_USER"], password=os.environ["POSTGRES_PASS"],
        dbname="postgres", connect_timeout="3",
    )


@pytest.fixture(scope="session", autouse=True)
def database() -> Iterator[None]:
    """Recreate the test database once per session; skip all integration tests if unreachable."""
    try:
        admin = psycopg.connect(_admin_conninfo(), autocommit=True)
    except psycopg.OperationalError as exc:
        pytest.skip(f"PostgreSQL not reachable: {exc}")
    with admin:
        admin.execute(sql.SQL("DROP DATABASE IF EXISTS {} WITH (FORCE)").format(sql.Identifier(TEST_DB)))
        admin.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(TEST_DB)))
    yield
    db.close()


@pytest.fixture(autouse=True)
def clean_state() -> Iterator[None]:
    """Start every test migrated, with no setting overrides and a fresh settings cache."""
    db.close()
    migrations._current_version = None  # noqa: SLF001
    migrations.ensure_migrated()
    db.execute("TRUNCATE app_settings, audit_log, deliverables, projects, departments, users RESTART IDENTITY CASCADE")
    settings.invalidate()
    yield
    db.close()


# ---------------------------------------------------------------------------
# API helpers
# ---------------------------------------------------------------------------

@pytest.fixture
def call():
    """Invoke the Lambda handler: ``call(method, path, body=None, token=None, query=None) -> (status, body)``."""
    import function
    from tests.conftest import body_of, make_event

    def _call(method, path, body=None, token=None, query=None):
        headers = {"authorization": f"Bearer {token}"} if token else {}
        res = function.handler(make_event(method, path, body, query, headers))
        return res["statusCode"], body_of(res)

    return _call


_counter = {"n": 0}


@pytest.fixture
def make_user():
    """Create a user directly in the DB and return it with a valid access token under ``token``."""
    from app.auth import issue_tokens, load_user
    from app.passwords import hash_password

    def _make(role="team_member", name=None, email=None, password="Passw0rd!", active=True):
        _counter["n"] += 1
        n = _counter["n"]
        row = db.fetch_one(
            "INSERT INTO users (email, name, role, password_hash, is_active) VALUES (%s, %s, %s, %s, %s) RETURNING id",
            ((email or f"{role}{n}@acme.example").lower(), name or f"{role.title()} {n}", role,
             hash_password(password) if password else None, active),
        )
        user = load_user(row["id"])
        return {**user, "token": issue_tokens(user)["access_token"], "password": password}

    return _make


@pytest.fixture
def org(make_user):
    """A small organization: admin, two PMs, team lead, member, viewer, one department."""
    people = {role: make_user(role) for role in ("admin", "project_manager", "team_lead", "team_member", "viewer")}
    people["pm2"] = make_user("project_manager")
    dept = db.fetch_one("INSERT INTO departments (name, code) VALUES ('Engineering', 'ENG') RETURNING id")
    people["department_id"] = dept["id"]
    return people


@pytest.fixture
def make_project(call, org):
    """Create a project via the API as ``owner`` (defaults to the first PM)."""
    def _make(owner=None, **fields):
        owner = owner or org["project_manager"]
        _counter["n"] += 1
        body = {"key": f"T{_counter['n']:03d}", "name": f"Project {_counter['n']}",
                "department_id": org["department_id"], **fields}
        status, data = call("POST", "/projects", body, owner["token"])
        assert status == 201, data
        return data

    return _make
