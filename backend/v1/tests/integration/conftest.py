"""Integration fixtures: a disposable PostgreSQL database per test session."""

import os
from collections.abc import Iterator

import pytest

import psycopg
from app import db, migrations
from app.config import settings
from psycopg import sql

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
    db.execute("TRUNCATE app_settings")
    settings.invalidate()
    yield
    db.close()
