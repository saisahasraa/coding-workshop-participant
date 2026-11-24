"""Audit trail: one row per create/update/delete, written in the same transaction as the change."""

from __future__ import annotations

from typing import Any

from app import db
from app.http import Request, to_json
from app.log import redact


def record(request: Request, action: str, entity: str, entity_id: Any, changes: dict) -> None:
    """Append an audit entry for ``entity``/``entity_id`` made by the request's user."""
    actor = request.user["id"] if request.user else None
    db.execute(
        "INSERT INTO audit_log (actor_id, action, entity, entity_id, changes, request_id) "
        "VALUES (%s, %s, %s, %s, %s::jsonb, %s)",
        (actor, action, entity, str(entity_id), to_json(redact(changes)), request.request_id or None),
    )


def diff(before: dict, after: dict) -> dict:
    """``{field: {"from": old, "to": new}}`` for fields whose value changed."""
    return {k: {"from": before.get(k), "to": v} for k, v in after.items() if before.get(k) != v}
