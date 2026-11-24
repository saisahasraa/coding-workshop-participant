"""End-to-end through the Lambda handler against a real PostgreSQL."""

import json
import time

import pytest

from app import db, http
from app.config import ENV, get_setting, settings
from tests.conftest import body_of, make_event


@pytest.fixture(scope="module")
def handler():
    import function

    return function.handler


def test_health_ok_with_and_without_prefix(handler):
    for path in ("/health", "/api/v1/health"):
        res = handler(make_event("GET", path))
        body = body_of(res)
        assert res["statusCode"] == 200
        assert body["status"] == "ok"
        assert body["database"] == "ok"
        assert body["schema_version"] == body["schema_latest"]
        assert body["environment"] == "local"


def test_health_reports_database_down(handler, monkeypatch):
    db.close()
    monkeypatch.setattr(db, "conninfo", lambda: "host=127.0.0.1 port=1 dbname=x connect_timeout=1")
    monkeypatch.setattr("app.migrations._current_version", None)
    res = handler(make_event("GET", "/health"))
    assert res["statusCode"] == 503
    assert body_of(res)["database"] == "unavailable"


def test_transactional_route_rolls_back_on_error(temp_route):
    def write_then_fail(_r):
        db.execute("INSERT INTO app_settings (key, value) VALUES ('probe', '1')")
        raise http.BadRequest("nope")

    temp_route("POST", "/probe", write_then_fail)
    res = http.dispatch(make_event("POST", "/probe", body={}))
    assert res["statusCode"] == 400
    assert db.fetch_one("SELECT count(*) AS n FROM app_settings WHERE key = 'probe'")["n"] == 0


def test_transactional_route_commits_on_success(temp_route):
    def write(_r):
        db.execute("INSERT INTO app_settings (key, value) VALUES ('probe', '1')")
        return http.created({"ok": True})

    temp_route("POST", "/probe", write)
    assert http.dispatch(make_event("POST", "/probe", body={}))["statusCode"] == 201
    assert db.fetch_one("SELECT count(*) AS n FROM app_settings WHERE key = 'probe'")["n"] == 1


def test_db_override_changes_setting_without_restart():
    assert get_setting("api.default_page_size") == 25
    db.execute("INSERT INTO app_settings (key, value) VALUES ('api.default_page_size', %s)", (json.dumps(50),))
    settings.invalidate()
    assert get_setting("api.default_page_size") == 50


def test_statement_timeout_returns_503(temp_route):
    db.execute("INSERT INTO app_settings (key, value) VALUES ('db.statement_timeout_ms', '1000')")
    settings.invalidate()
    temp_route("GET", "/slow", lambda _r: http.ok(db.fetch_one("SELECT pg_sleep(1.5) AS s")))
    started = time.monotonic()
    res = http.dispatch(make_event("GET", "/slow"))
    assert res["statusCode"] == 503
    assert time.monotonic() - started < 1.4


def test_unique_violation_returns_409(temp_route):
    def dup(_r):
        db.execute("INSERT INTO app_settings (key, value) VALUES ('k', '1')")
        db.execute("INSERT INTO app_settings (key, value) VALUES ('k', '2')")
        return http.ok({})

    temp_route("POST", "/dup", dup)
    res = http.dispatch(make_event("POST", "/dup", body={}))
    assert res["statusCode"] == 409
    assert db.fetch_one("SELECT count(*) AS n FROM app_settings")["n"] == 0


def test_runtime_log_level_override_applies(temp_route):
    import logging

    db.execute("INSERT INTO app_settings (key, value) VALUES ('logging.level', '\"WARNING\"')")
    settings.invalidate()
    temp_route("GET", "/lvl", lambda _r: http.ok({"level": logging.getLogger().level}))
    try:
        assert body_of(http.dispatch(make_event("GET", "/lvl")))["level"] == logging.WARNING
    finally:
        logging.getLogger().setLevel(ENV.log_level)
