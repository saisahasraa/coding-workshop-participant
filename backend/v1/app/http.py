"""
HTTP layer for Lambda Function URL events (payload format 2.0).

``dispatch()`` owns the request lifecycle: parse → route → run the handler in a DB
transaction → map errors to one JSON envelope → write one access-log line.

Error envelope::

    {"error": {"code": "validation_error", "message": "...", "details": {...}, "request_id": "..."}}
"""

from __future__ import annotations

import base64
import json
import logging
import re
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal
from typing import Any

import psycopg
from psycopg import errors as pg_errors

from app import db, log, migrations
from app.config import get_setting

logger = logging.getLogger(__name__)

API_PREFIX = "/api/v1"
MAX_BODY_BYTES = 1_000_000
_BODY_METHODS = frozenset({"POST", "PUT", "PATCH"})


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------

class ApiError(Exception):
    """Raise from anywhere in a handler to return a specific error response."""

    def __init__(self, status: int, code: str, message: str, details: dict | None = None,
                 headers: dict | None = None) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.details = details
        self.headers = headers or {}


class BadRequest(ApiError):
    """400: malformed request."""

    def __init__(self, message: str, details: dict | None = None) -> None:
        super().__init__(400, "bad_request", message, details)


class ValidationFailed(ApiError):
    """400: one or more fields are invalid; ``details`` maps field → message."""

    def __init__(self, details: dict) -> None:
        super().__init__(400, "validation_error", "Request validation failed", details)


class Unauthorized(ApiError):
    """401: missing, invalid or expired credentials."""

    def __init__(self, message: str = "Authentication required", code: str = "unauthorized") -> None:
        super().__init__(401, code, message)


class Forbidden(ApiError):
    """403: authenticated but not allowed."""

    def __init__(self, message: str = "You do not have permission to perform this action") -> None:
        super().__init__(403, "forbidden", message)


class NotFound(ApiError):
    """404: resource or route does not exist."""

    def __init__(self, message: str = "Resource not found") -> None:
        super().__init__(404, "not_found", message)


class Conflict(ApiError):
    """409: duplicate value or resource still in use."""

    def __init__(self, message: str, details: dict | None = None) -> None:
        super().__init__(409, "conflict", message, details)


# ---------------------------------------------------------------------------
# Request / response
# ---------------------------------------------------------------------------

@dataclass
class Request:
    """A parsed API request. ``path`` is relative to the API prefix (e.g. ``/projects/1``)."""

    method: str
    path: str
    query: dict[str, str] = field(default_factory=dict)
    headers: dict[str, str] = field(default_factory=dict)
    body: Any = None
    params: dict[str, str] = field(default_factory=dict)
    request_id: str = ""
    user: Any = None  # set by authentication (Phase 1)


def to_json(value: Any) -> str:
    """Serialize ``value`` to JSON, encoding dates as ISO strings and decimals as numbers."""
    return json.dumps(value, default=_json_default)


def _json_default(value: Any) -> Any:
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    raise TypeError(f"Object of type {type(value).__name__} is not JSON serializable")


def response(status: int, body: Any = None, headers: dict | None = None) -> dict:
    """Build a Lambda Function URL response with a JSON body."""
    result: dict[str, Any] = {"statusCode": status, "headers": {"Content-Type": "application/json", **(headers or {})}}
    if body is not None:
        result["body"] = json.dumps(body, default=_json_default)
    return result


def ok(body: Any) -> dict:
    """200 OK."""
    return response(200, body)


def created(body: Any) -> dict:
    """201 Created."""
    return response(201, body)


def no_content() -> dict:
    """204 No Content."""
    return response(204)


def error_response(status: int, code: str, message: str, details: dict | None = None,
                   request_id: str = "", headers: dict | None = None) -> dict:
    """Build the standard error envelope."""
    payload: dict[str, Any] = {"code": code, "message": message}
    if details:
        payload["details"] = details
    if request_id:
        payload["request_id"] = request_id
    return response(status, {"error": payload}, headers)


# ---------------------------------------------------------------------------
# Routing
# ---------------------------------------------------------------------------

Handler = Callable[[Request], dict]


@dataclass(frozen=True)
class Route:
    """A registered route.

    ``transactional`` routes run inside one DB transaction; ``public`` routes skip authentication.
    """

    method: str
    pattern: re.Pattern
    handler: Handler
    transactional: bool = True
    public: bool = False


class Router:
    """Matches ``(method, path)`` against patterns such as ``/projects/{id}``."""

    def __init__(self) -> None:
        self.routes: list[Route] = []

    def add(self, method: str, path: str, handler: Handler, transactional: bool = True,
            public: bool = False) -> None:
        """Register ``handler``; ``{name}`` path segments become ``request.params[name]``."""
        if not transactional and not public:
            raise ValueError("authenticated routes must be transactional (the user is loaded from the DB)")
        regex = re.sub(r"\{(\w+)\}", r"(?P<\1>[^/]+)", path)
        self.routes.append(Route(method.upper(), re.compile(f"^{regex}$"), handler, transactional, public))

    def route(self, method: str, path: str, transactional: bool = True,
              public: bool = False) -> Callable[[Handler], Handler]:
        """Decorator form of ``add``."""
        def decorator(handler: Handler) -> Handler:
            self.add(method, path, handler, transactional, public)
            return handler
        return decorator

    def get(self, path: str, **kwargs: Any) -> Callable[[Handler], Handler]:
        """Register a GET route."""
        return self.route("GET", path, **kwargs)

    def post(self, path: str, **kwargs: Any) -> Callable[[Handler], Handler]:
        """Register a POST route."""
        return self.route("POST", path, **kwargs)

    def put(self, path: str, **kwargs: Any) -> Callable[[Handler], Handler]:
        """Register a PUT route."""
        return self.route("PUT", path, **kwargs)

    def delete(self, path: str, **kwargs: Any) -> Callable[[Handler], Handler]:
        """Register a DELETE route."""
        return self.route("DELETE", path, **kwargs)

    def match(self, method: str, path: str) -> tuple[Route, dict[str, str]]:
        """Return the matching route and its path params, or raise 404 / 405."""
        allowed = []
        for route in self.routes:
            found = route.pattern.match(path)
            if not found:
                continue
            if route.method == method:
                return route, found.groupdict()
            allowed.append(route.method)
        if allowed:
            raise ApiError(405, "method_not_allowed", f"Method {method} is not allowed for {path}",
                           headers={"Allow": ", ".join(sorted(set(allowed)))})
        raise NotFound(f"Route {method} {path} not found")


router = Router()

# Set by the auth module: returns the current user or raises Unauthorized.
Authenticator = Callable[[Request], Any]
_authenticator: Authenticator | None = None


def set_authenticator(authenticator: Authenticator) -> None:
    """Install the function that resolves ``request.user`` for non-public routes."""
    global _authenticator  # pylint: disable=global-statement
    _authenticator = authenticator


# ---------------------------------------------------------------------------
# Event parsing
# ---------------------------------------------------------------------------

def normalize_path(raw_path: str | None) -> str:
    """Strip the ``/api/v1`` prefix (sent by CloudFront, not by the local proxy) and trailing slashes."""
    path = "/" + (raw_path or "").strip("/")
    if path == API_PREFIX or path.startswith(API_PREFIX + "/"):
        path = path[len(API_PREFIX):] or "/"
    return path


def parse_body(event: dict, method: str) -> Any:
    """Decode the JSON body for POST/PUT/PATCH; other methods have no body."""
    if method not in _BODY_METHODS:
        return None
    raw = event.get("body")
    if raw in (None, ""):
        return {}
    if event.get("isBase64Encoded"):
        try:
            raw = base64.b64decode(raw).decode("utf-8")
        except (ValueError, UnicodeDecodeError):
            raise BadRequest("Request body is not valid base64-encoded UTF-8") from None
    if len(raw.encode("utf-8")) > MAX_BODY_BYTES:
        raise ApiError(413, "payload_too_large", f"Request body exceeds {MAX_BODY_BYTES} bytes")
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        raise BadRequest(f"Request body is not valid JSON: {exc.msg}") from None


def parse_event(event: dict, request_id: str) -> Request:
    """Turn a Function URL event into a ``Request``."""
    http = (event.get("requestContext") or {}).get("http") or {}
    method = (http.get("method") or "GET").upper()
    return Request(
        method=method,
        path=normalize_path(event.get("rawPath") or http.get("path")),
        query=dict(event.get("queryStringParameters") or {}),
        headers={k.lower(): v for k, v in (event.get("headers") or {}).items()},
        body=parse_body(event, method),
        request_id=request_id,
    )


# ---------------------------------------------------------------------------
# Database error mapping
# ---------------------------------------------------------------------------

def _database_error(exc: psycopg.Error) -> ApiError:
    """Translate database exceptions into client-facing API errors."""
    diag = getattr(exc, "diag", None)
    constraint = getattr(diag, "constraint_name", None)
    details = {"constraint": constraint} if constraint else None
    if isinstance(exc, pg_errors.UniqueViolation):
        return Conflict("A record with these values already exists", details)
    if isinstance(exc, pg_errors.ForeignKeyViolation):
        return Conflict("The record is referenced by, or references, another record", details)
    if isinstance(exc, pg_errors.CheckViolation):
        return BadRequest("One or more values are out of the allowed range", details)
    if isinstance(exc, pg_errors.NotNullViolation):
        return BadRequest(f"{getattr(diag, 'column_name', None) or 'A field'} is required")
    if isinstance(exc, psycopg.DataError):
        return BadRequest("One or more values are invalid")
    if isinstance(exc, pg_errors.QueryCanceled):
        return ApiError(503, "unavailable", "The request took too long; please try again")
    if isinstance(exc, psycopg.OperationalError):
        db.close()  # force a reconnect on the next request
        return ApiError(503, "unavailable", "Database is unavailable")
    return ApiError(500, "internal_error", "Internal server error")


# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------

def _apply_runtime_log_level() -> None:
    try:
        log.set_level(get_setting("logging.level"))
    except Exception:  # pylint: disable=broad-except
        logger.debug("Could not apply runtime log level", exc_info=True)


def _run(request: Request) -> dict:
    route, params = router.match(request.method, request.path)
    request.params = params
    if not route.transactional:
        return route.handler(request)
    migrations.ensure_migrated()
    _apply_runtime_log_level()
    with db.transaction(get_setting("db.statement_timeout_ms")):
        if not route.public:
            if _authenticator is None:
                raise ApiError(500, "internal_error", "Authentication is not configured")
            request.user = _authenticator(request)
        return route.handler(request)


def dispatch(event: dict | None, context: Any = None) -> dict:
    """Handle one Lambda invocation and always return a well-formed HTTP response."""
    started = time.perf_counter()
    request_id = getattr(context, "aws_request_id", None) or str(uuid.uuid4())
    event = event or {}
    http = (event.get("requestContext") or {}).get("http") or {}
    method = (http.get("method") or "GET").upper()
    path = normalize_path(event.get("rawPath") or http.get("path"))
    log.bind(request_id=request_id, method=method, path=path)

    try:
        request = parse_event(event, request_id)
        result = _run(request)
    except ApiError as exc:
        result = error_response(exc.status, exc.code, exc.message, exc.details, request_id, exc.headers)
    except psycopg.Error as exc:
        mapped = _database_error(exc)
        level = logging.ERROR if mapped.status >= 500 else logging.WARNING
        logger.log(level, "Database error: %s", exc.__class__.__name__, exc_info=mapped.status >= 500)
        result = error_response(mapped.status, mapped.code, mapped.message, mapped.details, request_id)
    except Exception:  # pylint: disable=broad-except
        logger.exception("Unhandled error")
        result = error_response(500, "internal_error", "Internal server error", request_id=request_id)

    result.setdefault("headers", {})["X-Request-Id"] = request_id
    status = result["statusCode"]
    logger.log(
        logging.ERROR if status >= 500 else logging.INFO,
        "%s %s -> %s", method, path, status,
        extra={"fields": {"status": status, "duration_ms": round((time.perf_counter() - started) * 1000, 1)}},
    )
    log.clear()
    return result
