"""
``GET /search?q=``: projects, deliverables and people matching some text.

Each kind is a *provider*: a function from (user, text, limit) to rows. Providers reuse the resources' own
search columns and visibility rules, so a result is always something the caller could open. A future
semantic (AI) search is one more provider appended to ``PROVIDERS``.
"""

from __future__ import annotations

from collections.abc import Callable

from app.config import get_setting
from app.crud import search_records
from app.http import ValidationFailed
from app.resources import DELIVERABLES, PROJECTS, USERS

MIN_LENGTH = 2


def _exact_first(rows: list[dict], text: str) -> list[dict]:
    """Rows whose key equals or starts with the text come first (typing ``PAY-2`` finds PAY-2 first)."""
    needle = text.upper()
    return sorted(rows, key=lambda r: (not r["key"].startswith(needle), r["key"] != needle))


def _projects(user: dict, text: str, limit: int) -> list[dict]:
    rows = _exact_first(search_records(PROJECTS, user, text, 200), text)[:limit]
    return [{"id": r["id"], "key": r["key"], "name": r["name"], "status": r["status"], "health": r["health"]}
            for r in rows]


def _deliverables(user: dict, text: str, limit: int) -> list[dict]:
    rows = _exact_first(search_records(DELIVERABLES, user, text, 200), text)[:limit]
    return [{"id": r["id"], "key": r["key"], "name": r["name"], "status": r["status"], "project_key": r["project_key"]}
            for r in rows]


def _people(user: dict, text: str, limit: int) -> list[dict]:
    rows = search_records(USERS, user, text, limit, is_active="true")
    return [{"id": r["id"], "name": r["name"], "role": r["role"], "job_title": r["job_title"],
             "team_name": r["team_name"]} for r in rows]


PROVIDERS: dict[str, Callable[[dict, str, int], list[dict]]] = {
    "projects": _projects, "deliverables": _deliverables, "people": _people,
}


def search(user: dict, query: dict) -> dict:
    """Results grouped by kind, each limited by the ``search.results_per_type`` setting."""
    text = (query.get("q") or "").strip()
    if len(text) < MIN_LENGTH:
        raise ValidationFailed({"q": f"must be at least {MIN_LENGTH} characters"})
    limit = get_setting("search.results_per_type")
    return {"q": text, **{kind: provider(user, text, limit) for kind, provider in PROVIDERS.items()}}
