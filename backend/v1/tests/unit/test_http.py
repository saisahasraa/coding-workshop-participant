"""Routing, parsing, error envelope and dispatch behaviour (no database)."""

import base64

import pytest

import psycopg
from app import http
from app.http import ApiError, BadRequest, Router, dispatch, normalize_path, parse_body
from psycopg import errors as pg_errors
from tests.conftest import body_of, make_event


@pytest.mark.parametrize(("raw", "expected"), [
    ("/api/v1/projects", "/projects"),
    ("/api/v1/projects/7/", "/projects/7"),
    ("/api/v1", "/"),
    ("/projects", "/projects"),
    ("", "/"),
    (None, "/"),
    ("/api/v10/x", "/api/v10/x"),
])
def test_normalize_path_strips_prefix_only(raw, expected):
    assert normalize_path(raw) == expected


def test_parse_body_json_and_empty():
    assert parse_body({"body": '{"a": 1}'}, "POST") == {"a": 1}
    assert parse_body({"body": ""}, "PUT") == {}
    assert parse_body({"body": '{"a": 1}'}, "GET") is None


def test_parse_body_base64():
    raw = base64.b64encode(b'{"x": true}').decode()
    assert parse_body({"body": raw, "isBase64Encoded": True}, "POST") == {"x": True}


@pytest.mark.parametrize("event", [
    {"body": "{not json"},
    {"body": "!!!", "isBase64Encoded": True},
])
def test_parse_body_rejects_malformed(event):
    with pytest.raises(BadRequest):
        parse_body(event, "POST")


def test_parse_body_rejects_oversized():
    with pytest.raises(ApiError) as exc:
        parse_body({"body": "x" * (http.MAX_BODY_BYTES + 1)}, "POST")
    assert exc.value.status == 413


def test_router_matches_params_and_methods():
    router = Router()
    router.add("GET", "/items/{id}", lambda r: r)
    route, params = router.match("GET", "/items/42")
    assert params == {"id": "42"}
    assert route.transactional is True

    with pytest.raises(ApiError) as not_allowed:
        router.match("DELETE", "/items/42")
    assert not_allowed.value.status == 405
    assert not_allowed.value.headers["Allow"] == "GET"

    with pytest.raises(ApiError) as missing:
        router.match("GET", "/nope")
    assert missing.value.status == 404


def test_dispatch_success_sets_request_id(temp_route):
    temp_route("GET", "/ping", lambda r: http.ok({"pong": r.query.get("q")}), transactional=False)

    class Ctx:
        aws_request_id = "req-123"

    res = dispatch(make_event("GET", "/api/v1/ping", query={"q": "hi"}), Ctx())
    assert res["statusCode"] == 200
    assert body_of(res) == {"pong": "hi"}
    assert res["headers"]["X-Request-Id"] == "req-123"


def test_dispatch_api_error_uses_envelope(temp_route):
    def fail(_r):
        raise http.ValidationFailed({"name": "is required"})

    temp_route("POST", "/things", fail, transactional=False)
    res = dispatch(make_event("POST", "/things", body={}))
    error = body_of(res)["error"]
    assert res["statusCode"] == 400
    assert error["code"] == "validation_error"
    assert error["details"] == {"name": "is required"}
    assert error["request_id"] == res["headers"]["X-Request-Id"]


def test_dispatch_unhandled_error_is_500_without_leaking(temp_route):
    def boom(_r):
        raise RuntimeError("secret internals")

    temp_route("GET", "/boom", boom, transactional=False)
    res = dispatch(make_event("GET", "/boom"))
    assert res["statusCode"] == 500
    assert "secret" not in res["body"]


def test_dispatch_unknown_route_and_bad_json():
    assert dispatch(make_event("GET", "/missing"))["statusCode"] == 404
    assert dispatch(None)["statusCode"] == 404  # empty event → GET /


def test_dispatch_rejects_bad_json(temp_route):
    temp_route("POST", "/echo", lambda r: http.ok(r.body), transactional=False)
    res = dispatch(make_event("POST", "/echo", body="{bad"))
    assert res["statusCode"] == 400
    assert body_of(res)["error"]["code"] == "bad_request"


@pytest.mark.parametrize(("exc", "status", "code"), [
    (pg_errors.UniqueViolation("dup"), 409, "conflict"),
    (pg_errors.ForeignKeyViolation("fk"), 409, "conflict"),
    (pg_errors.CheckViolation("chk"), 400, "bad_request"),
    (pg_errors.NotNullViolation("nn"), 400, "bad_request"),
    (pg_errors.InvalidDatetimeFormat("dt"), 400, "bad_request"),
    (pg_errors.QueryCanceled("slow"), 503, "unavailable"),
    (psycopg.OperationalError("down"), 503, "unavailable"),
    (psycopg.ProgrammingError("bug"), 500, "internal_error"),
])
def test_database_errors_are_mapped(temp_route, exc, status, code):
    def raise_db(_r):
        raise exc

    temp_route("GET", "/db", raise_db, transactional=False)
    res = dispatch(make_event("GET", "/db"))
    assert res["statusCode"] == status
    assert body_of(res)["error"]["code"] == code


def test_response_serializes_dates_and_decimals():
    from datetime import date
    from decimal import Decimal

    res = http.ok({"d": date(2026, 1, 2), "n": Decimal("1.50")})
    assert body_of(res) == {"d": "2026-01-02", "n": 1.5}
    with pytest.raises(TypeError):
        http.ok({"x": object()})


def test_no_content_has_no_body():
    assert "body" not in http.no_content()
    assert http.created({"id": 1})["statusCode"] == 201
