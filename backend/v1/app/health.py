"""
Project health: green, amber or red, with the reasons.

One pure function judges a project from a handful of numbers, so the rules are testable as a table and
the same code answers both "what is this project's health?" and "which projects are at risk?". It applies
to active and on-hold projects; other projects have no health. Thresholds are runtime settings.

Each metric contributes at most one reason, at its highest tier:

    overdue work     amber: any deliverable overdue      red: the longest is overdue by more than N days
    blocked work     amber: any deliverable blocked
    schedule         amber/red: share of the schedule elapsed exceeds progress by more than the gap
    budget           amber: share of budget spent exceeds progress by more than the gap
                     red: more than the whole budget spent
    dates            red: past the target end date
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, date, datetime
from typing import Any

from app.config import get_setting

JUDGED_STATUSES = ("active", "on_hold")
LEVELS = ("green", "amber", "red")


@dataclass(frozen=True)
class Rules:
    """Thresholds, normally read from settings."""

    amber_schedule_gap: float = 10
    red_schedule_gap: float = 25
    amber_budget_gap: float = 15
    red_overdue_days: int = 7


def rules_from_settings() -> Rules:
    """The thresholds currently in effect."""
    return Rules(
        amber_schedule_gap=get_setting("health.amber_schedule_gap_pct"),
        red_schedule_gap=get_setting("health.red_schedule_gap_pct"),
        amber_budget_gap=get_setting("health.amber_budget_gap_pct"),
        red_overdue_days=get_setting("health.red_overdue_days"),
    )


def _today() -> date:
    """Today's date in UTC, the same day the database's ``current_date`` reports (a function so tests can pin it)."""
    return datetime.now(UTC).date()


def schedule_elapsed_pct(start: date | None, end: date | None, today: date) -> float | None:
    """Share of the planned schedule that has passed, 0-100; ``None`` without usable dates."""
    if start is None or end is None or end <= start:
        return None
    return max(0.0, min(100.0, (today - start).days / (end - start).days * 100))


def budget_burn_pct(planned: Any, spent: Any) -> float | None:
    """Share of the planned budget spent (may exceed 100); ``None`` when no budget is planned."""
    planned = float(planned or 0)
    return float(spent or 0) / planned * 100 if planned > 0 else None


def _reason(level: str, code: str, message: str) -> dict:
    return {"level": level, "code": code, "message": message}


def _plural(count: int, noun: str) -> str:
    return f"{count} {noun}{'' if count == 1 else 's'}"


def assess(project: dict, today: date, rules: Rules) -> tuple[str | None, list[dict]]:
    """Return ``(level, reasons)`` for a project row; ``level`` is ``None`` for projects not judged."""
    if project["status"] not in JUDGED_STATUSES:
        return None, []
    progress = float(project["progress_pct"] or 0)
    elapsed = schedule_elapsed_pct(project["start_date"], project["end_date"], today)
    burn = budget_burn_pct(project["planned_budget"], project["budget_spent"])
    reasons: list[dict] = []

    if project["end_date"] and today > project["end_date"]:
        reasons.append(_reason("red", "past_end_date",
                               f"Past its target end date by {_plural((today - project['end_date']).days, 'day')}"))

    overdue, longest = project["deliverables_overdue"], project["max_overdue_days"]
    if overdue:
        text = f"{_plural(overdue, 'deliverable')} overdue, the longest by {_plural(longest, 'day')}"
        reasons.append(_reason("red" if longest > rules.red_overdue_days else "amber", "overdue", text))

    if project["deliverables_blocked"]:
        blocked = _plural(project["deliverables_blocked"], "deliverable")
        reasons.append(_reason("amber", "blocked", f"{blocked} blocked"))

    if elapsed is not None and elapsed - progress > rules.amber_schedule_gap:
        level = "red" if elapsed - progress > rules.red_schedule_gap else "amber"
        reasons.append(_reason(level, "schedule", f"{elapsed:.0f}% of the schedule has passed but only "
                                                  f"{progress:.0f}% is complete"))

    if burn is not None and burn > 100:
        reasons.append(_reason("red", "over_budget", f"{burn:.0f}% of the budget is spent"))
    elif burn is not None and burn - progress > rules.amber_budget_gap:
        reasons.append(_reason("amber", "budget", f"{burn:.0f}% of the budget is spent but only "
                                                  f"{progress:.0f}% is complete"))

    level = "red" if any(r["level"] == "red" for r in reasons) else "amber" if reasons else "green"
    return level, reasons


def computed_fields(project: dict) -> dict:
    """Fields derived from a project row, added to its API representation."""
    today = _today()
    level, reasons = assess(project, today, rules_from_settings())
    burn = budget_burn_pct(project["planned_budget"], project["budget_spent"])
    elapsed = schedule_elapsed_pct(project["start_date"], project["end_date"], today)
    return {
        "budget_burn_pct": None if burn is None else round(burn, 1),
        "schedule_elapsed_pct": None if elapsed is None else round(elapsed, 1),
        "health": level,
        "health_reasons": reasons,
    }
