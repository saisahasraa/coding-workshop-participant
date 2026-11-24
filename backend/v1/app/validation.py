"""
Declarative field validation.

Each entity declares its writable fields once as ``Field`` objects; the same declarations
drive body validation (create and partial update) and query-string filter parsing.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Any

from app.http import BadRequest, ValidationFailed

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
MAX_ID = 2**63 - 1
KINDS = ("string", "email", "enum", "integer", "decimal", "boolean", "date", "datetime", "ref")


@dataclass(frozen=True)
class Field:  # pylint: disable=too-many-instance-attributes
    """Validation rules for one field."""

    kind: str
    required: bool = False
    nullable: bool = True
    min_len: int | None = None
    max_len: int | None = None
    minimum: Decimal | None = None
    maximum: Decimal | None = None
    exclusive_min: bool = False
    choices: tuple = ()
    ref: str | None = None  # referenced table for kind == "ref" (existence is checked before writes)

    def __post_init__(self) -> None:
        if self.kind not in KINDS:
            raise ValueError(f"unknown field kind {self.kind}")


def parse_id(raw: Any, name: str = "id") -> int:
    """Parse a positive 64-bit integer id from a path segment or body value."""
    if isinstance(raw, bool):
        raise BadRequest(f"{name} must be a positive integer")
    if isinstance(raw, str) and not raw.isdigit():
        raise BadRequest(f"{name} must be a positive integer")
    try:
        value = int(raw)
    except (TypeError, ValueError):
        raise BadRequest(f"{name} must be a positive integer") from None
    if not 1 <= value <= MAX_ID:
        raise BadRequest(f"{name} must be a positive integer")
    return value


def _coerce_text(spec: Field, value: Any) -> str | None:
    if not isinstance(value, str):
        raise ValueError("must be a string")
    value = value.strip()
    if spec.kind == "email":
        value = value.lower()
        if not EMAIL_RE.match(value):
            raise ValueError("must be a valid email address")
    if spec.kind == "enum" and value not in spec.choices:
        raise ValueError(f"must be one of: {', '.join(spec.choices)}")
    if not value:
        if spec.required or not spec.nullable:
            raise ValueError("must not be empty")
        return None
    if spec.min_len is not None and len(value) < spec.min_len:
        raise ValueError(f"must be at least {spec.min_len} characters")
    if spec.max_len is not None and len(value) > spec.max_len:
        raise ValueError(f"must be at most {spec.max_len} characters")
    return value


def _coerce_number(spec: Field, value: Any) -> int | Decimal:
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        raise ValueError("must be a number")
    try:
        number = Decimal(str(value).strip())
    except InvalidOperation:
        raise ValueError("must be a number") from None
    if not number.is_finite():
        raise ValueError("must be a finite number")
    if spec.kind == "integer" and number != number.to_integral_value():
        raise ValueError("must be an integer")
    if spec.minimum is not None:
        if spec.exclusive_min and number <= spec.minimum:
            raise ValueError(f"must be greater than {spec.minimum}")
        if not spec.exclusive_min and number < spec.minimum:
            raise ValueError(f"must be at least {spec.minimum}")
    if spec.maximum is not None and number > spec.maximum:
        raise ValueError(f"must be at most {spec.maximum}")
    return int(number) if spec.kind == "integer" else number


def _coerce_boolean(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str) and value.strip().lower() in ("true", "false"):
        return value.strip().lower() == "true"
    raise ValueError("must be true or false")


def coerce(spec: Field, value: Any) -> Any:
    """Return the cleaned value or raise ``ValueError`` with a client-facing message."""
    if value is None:
        if spec.nullable and not spec.required:
            return None
        raise ValueError("must not be null")
    if spec.kind in ("string", "email", "enum"):
        return _coerce_text(spec, value)
    if spec.kind in ("integer", "decimal"):
        return _coerce_number(spec, value)
    if spec.kind == "boolean":
        return _coerce_boolean(value)
    if spec.kind == "ref":
        if isinstance(value, bool) or not isinstance(value, (int, str)):
            raise ValueError("must be a positive integer id")
        try:
            return parse_id(value)
        except BadRequest:
            raise ValueError("must be a positive integer id") from None
    if not isinstance(value, str):
        raise ValueError("must be a date string (YYYY-MM-DD)" if spec.kind == "date"
                         else "must be an ISO 8601 datetime string")
    try:
        if spec.kind == "date":
            return date.fromisoformat(value)
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise ValueError("must be a date string (YYYY-MM-DD)" if spec.kind == "date"
                         else "must be an ISO 8601 datetime string") from None


def validate_fields(fields: dict[str, Field], body: Any, partial: bool = False) -> dict[str, Any]:
    """Validate a create (``partial=False``) or partial-update payload against ``fields``.

    Returns only declared fields, cleaned. Raises ``ValidationFailed`` with a field → message map.
    """
    if not isinstance(body, dict):
        raise BadRequest("Request body must be a JSON object")
    if partial and not body:
        raise BadRequest("Request body must contain at least one field to update")

    errors = {key: "is not an allowed field" for key in body if key not in fields}
    cleaned: dict[str, Any] = {}
    for name, spec in fields.items():
        if name not in body:
            if spec.required and not partial:
                errors[name] = "is required"
            continue
        try:
            cleaned[name] = coerce(spec, body[name])
        except ValueError as exc:
            errors[name] = str(exc)
    if errors:
        raise ValidationFailed(errors)
    return cleaned
