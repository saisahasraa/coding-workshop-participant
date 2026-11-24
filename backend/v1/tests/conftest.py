"""Shared test setup. Environment is fixed *before* any ``app`` module is imported."""

import json
import os
from collections.abc import Callable, Iterator

import pytest

os.environ.setdefault("IS_LOCAL", "true")
os.environ.setdefault("POSTGRES_HOST", os.getenv("TEST_POSTGRES_HOST", "localhost"))
os.environ.setdefault("POSTGRES_PORT", os.getenv("TEST_POSTGRES_PORT", "5432"))
os.environ.setdefault("POSTGRES_USER", os.getenv("TEST_POSTGRES_USER", "postgres"))
os.environ.setdefault("POSTGRES_PASS", os.getenv("TEST_POSTGRES_PASS", "postgres123"))
os.environ["POSTGRES_NAME"] = os.getenv("TEST_POSTGRES_NAME", "acme_test")
os.environ["SETTINGS_CACHE_SECONDS"] = "0"
os.environ.setdefault("JWT_SECRET", "test-secret-not-for-production")

from app import http  # noqa: E402


def make_event(method: str = "GET", path: str = "/health", body: object = None,
               query: dict | None = None, headers: dict | None = None) -> dict:
    """Build a Lambda Function URL (v2.0) event."""
    event: dict = {
        "rawPath": path,
        "requestContext": {"http": {"method": method, "path": path}},
        "headers": headers or {},
        "queryStringParameters": query,
    }
    if body is not None:
        event["body"] = body if isinstance(body, str) else json.dumps(body)
    return event


def body_of(response: dict) -> object:
    """Decode a handler response body."""
    return json.loads(response["body"]) if response.get("body") else None


@pytest.fixture
def temp_route() -> Iterator[Callable]:
    """Register routes for one test only."""
    before = list(http.router.routes)

    def add(method: str, path: str, handler: Callable, transactional: bool = True) -> None:
        http.router.add(method, path, handler, transactional)

    yield add
    http.router.routes[:] = before
