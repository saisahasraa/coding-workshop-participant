"""
Roles and the policy contract every resource implements.

Authorization happens in two steps, so a caller never learns more than they may:

1. ``actions(user)``: coarse, role-level ("can this role ever create projects?"). Checked before
   the body is validated, and also published to the UI via ``GET /auth/me``.
2. Record-level checks: ``check_create`` (with the validated values), ``editable_fields`` and
   ``can_delete`` (with the stored record). ``scope`` restricts which rows are visible at all;
   invisible rows behave as 404.
"""

from __future__ import annotations

from typing import Any

from psycopg import sql

from app.http import Forbidden

ADMIN = "admin"
PROJECT_MANAGER = "project_manager"
TEAM_LEAD = "team_lead"
TEAM_MEMBER = "team_member"
VIEWER = "viewer"
ROLES = (ADMIN, PROJECT_MANAGER, TEAM_LEAD, TEAM_MEMBER, VIEWER)

READ, CREATE, UPDATE, DELETE = "read", "create", "update", "delete"
ALL_ACTIONS = frozenset({READ, CREATE, UPDATE, DELETE})

User = dict[str, Any]
Scope = tuple[sql.Composable, list] | None


def is_admin(user: User) -> bool:
    """True for administrators."""
    return user["role"] == ADMIN


def has_role(user: User, *roles: str) -> bool:
    """True when the user has one of ``roles``."""
    return user["role"] in roles


class Policy:
    """Default policy: everyone reads; only admins write. Subclasses override what differs."""

    def actions(self, user: User) -> frozenset[str]:
        """Role-level actions this user may attempt on the resource."""
        return ALL_ACTIONS if is_admin(user) else frozenset({READ})

    def scope(self, user: User) -> Scope:  # noqa: ARG002
        """Extra WHERE condition limiting visible rows (``None`` = all rows)."""
        return None

    def check_create(self, user: User, values: dict) -> None:
        """Raise ``Forbidden`` if this specific create is not allowed."""

    def editable_fields(self, user: User, record: dict) -> frozenset[str] | None:
        """Fields the user may change on ``record``: ``None`` = all, empty set = none."""
        return None if UPDATE in self.actions(user) else frozenset()

    def can_delete(self, user: User, record: dict) -> bool:  # noqa: ARG002
        """Whether the user may delete ``record``."""
        return DELETE in self.actions(user)

    # -- helpers used by the CRUD engine ------------------------------------------------

    def require(self, user: User, action: str) -> None:
        """Raise ``Forbidden`` unless the role-level ``action`` is allowed."""
        if action not in self.actions(user):
            raise Forbidden()

    def check_update(self, user: User, record: dict, changes: dict) -> None:
        """Raise ``Forbidden`` if ``changes`` touch fields the user may not edit."""
        allowed = self.editable_fields(user, record)
        if allowed is None:
            return
        if not allowed:
            raise Forbidden()
        blocked = sorted(set(changes) - allowed)
        if blocked:
            raise Forbidden(f"You may only change: {', '.join(sorted(allowed))}")

    def record_permissions(self, user: User, record: dict) -> dict:
        """Per-record flags returned to the UI so it can hide actions the user cannot take."""
        fields = self.editable_fields(user, record)
        return {
            "update": fields is None or bool(fields),
            "delete": self.can_delete(user, record),
            "editable_fields": None if fields is None else sorted(fields),
        }
