"""Runtime settings administration (admin only) and public metadata for the UI."""

from __future__ import annotations

from app import audit, db
from app.config import SETTINGS, get_setting, settings
from app.http import Forbidden, NotFound, Request, ValidationFailed, no_content, ok, to_json
from app.rbac import ROLES, is_admin
from app.resources import (
    DELIVERABLE_STATUS_CATEGORY,
    DELIVERABLE_STATUSES,
    PRIORITIES,
    PROJECT_STATUSES,
    VISIBILITIES,
)


def _require_admin(request: Request) -> None:
    if not is_admin(request.user):
        raise Forbidden()


def _setting_or_404(key: str):
    setting = SETTINGS.get(key)
    if setting is None:
        raise NotFound(f"Setting {key} not found")
    return setting


def _describe(rows: dict[str, dict]) -> list[dict]:
    result = []
    for key, setting in SETTINGS.items():
        row = rows.get(key)
        result.append({
            "key": key,
            "group": key.split(".", 1)[0],
            "kind": setting.kind,
            "description": setting.description,
            "default": setting.default,
            "value": get_setting(key),
            "overridden": row is not None,
            "minimum": setting.minimum,
            "maximum": setting.maximum,
            "choices": list(setting.choices) or None,
            "public": setting.public,
            "updated_at": row["updated_at"] if row else None,
            "updated_by_name": row["updated_by_name"] if row else None,
        })
    return result


def _override_rows() -> dict[str, dict]:
    rows = db.fetch_all(
        "SELECT s.key, s.value, s.updated_at, u.name AS updated_by_name "
        "FROM app_settings s LEFT JOIN users u ON u.id = s.updated_by"
    )
    return {r["key"]: r for r in rows}


def list_settings(request: Request) -> dict:
    """GET /settings: every setting with its default, effective value and last change."""
    _require_admin(request)
    settings.invalidate()  # admins always see the latest values
    return ok({"data": _describe(_override_rows())})


def update_setting(request: Request) -> dict:
    """PUT /settings/{key} with ``{"value": ...}``: validated against the registry."""
    _require_admin(request)
    key = request.params["key"]
    setting = _setting_or_404(key)
    body = request.body
    if not isinstance(body, dict) or set(body) != {"value"}:
        raise ValidationFailed({"value": "is required (and the only allowed field)"})
    try:
        value = setting.validate(body["value"])
    except ValueError as exc:
        raise ValidationFailed({"value": str(exc)}) from None
    previous = get_setting(key)
    db.execute(
        "INSERT INTO app_settings (key, value, updated_by, updated_at) VALUES (%s, %s::jsonb, %s, now()) "
        "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, "
        "updated_at = now()",
        (key, to_json(value), request.user["id"]),
    )
    audit.record(request, "update", "app_settings", key, {"value": {"from": previous, "to": value}})
    settings.invalidate()
    return ok(next(s for s in _describe(_override_rows()) if s["key"] == key))


def reset_setting(request: Request) -> dict:
    """DELETE /settings/{key}: revert to the code default."""
    _require_admin(request)
    key = request.params["key"]
    setting = _setting_or_404(key)
    previous = get_setting(key)
    if db.execute("DELETE FROM app_settings WHERE key = %s", (key,)):
        audit.record(request, "update", "app_settings", key, {"value": {"from": previous, "to": setting.default}})
    settings.invalidate()
    return no_content()


def meta(_request: Request) -> dict:
    """GET /meta: enumerations and public settings the UI needs (no redeploy to change them)."""
    return ok({
        "roles": list(ROLES),
        "project_statuses": list(PROJECT_STATUSES),
        "deliverable_statuses": [{"value": s, "category": DELIVERABLE_STATUS_CATEGORY[s]}
                                 for s in DELIVERABLE_STATUSES],
        "priorities": list(PRIORITIES),
        "visibilities": list(VISIBILITIES),
        "settings": {key: get_setting(key) for key, s in SETTINGS.items() if s.public},
    })
