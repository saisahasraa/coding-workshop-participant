"""
Structured JSON logging to stdout (Lambda forwards stdout to CloudWatch).

Every line carries the request context bound with ``bind()`` (request id, method, path,
user id), so a single request can be traced end to end. Sensitive keys are redacted.
"""

from __future__ import annotations

import json
import logging
import sys
from contextvars import ContextVar
from datetime import UTC, datetime
from typing import Any

_context: ContextVar[dict[str, Any] | None] = ContextVar("log_context", default=None)

REDACTED = "***"
SENSITIVE_KEYS = frozenset({
    "password", "current_password", "new_password", "password_hash",
    "token", "access_token", "refresh_token", "authorization", "jwt_secret",
})


def redact(value: Any) -> Any:
    """Return a copy of ``value`` with sensitive dict keys masked (recursively)."""
    if isinstance(value, dict):
        return {
            k: REDACTED if isinstance(k, str) and k.lower() in SENSITIVE_KEYS else redact(v)
            for k, v in value.items()
        }
    if isinstance(value, (list, tuple)):
        return [redact(v) for v in value]
    return value


class JsonFormatter(logging.Formatter):
    """Format records as one JSON object per line."""

    def format(self, record: logging.LogRecord) -> str:
        entry: dict[str, Any] = {
            "ts": datetime.fromtimestamp(record.created, tz=UTC).isoformat(timespec="milliseconds"),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        entry.update(_context.get() or {})
        fields = getattr(record, "fields", None)
        if isinstance(fields, dict):
            entry.update(redact(fields))
        if record.exc_info:
            entry["exc"] = self.formatException(record.exc_info)
        return json.dumps(entry, default=str)


def configure(level: str = "INFO") -> None:
    """Install the JSON handler on the root logger (replacing the Lambda default handler)."""
    root = logging.getLogger()
    for handler in list(root.handlers):
        root.removeHandler(handler)
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    root.addHandler(handler)
    set_level(level)
    # Third-party libraries are noisy at DEBUG; keep them at WARNING.
    logging.getLogger("psycopg").setLevel(logging.WARNING)


def set_level(level: str) -> None:
    """Change the root log level at runtime; unknown names fall back to INFO."""
    resolved = logging.getLevelName(str(level).upper())
    logging.getLogger().setLevel(resolved if isinstance(resolved, int) else logging.INFO)


def bind(**fields: Any) -> None:
    """Add fields to the context included in every log line of the current request."""
    _context.set({**(_context.get() or {}), **{k: v for k, v in fields.items() if v is not None}})


def clear() -> None:
    """Reset the request context (call at the end of every request)."""
    _context.set(None)


def flush() -> None:
    """Flush all root handlers (used during shutdown)."""
    for handler in logging.getLogger().handlers:
        handler.flush()
