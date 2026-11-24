"""Project health rules, as a table."""

from datetime import date

import pytest

from app import health
from app.health import Rules, assess

TODAY = date(2026, 6, 1)
RULES = Rules(amber_schedule_gap=10, red_schedule_gap=25, amber_budget_gap=15, red_overdue_days=7)


def project(**changes):
    """A healthy project half way through its schedule and budget."""
    base = {
        "status": "active", "start_date": date(2026, 5, 1), "end_date": date(2026, 7, 1), "planned_budget": 1000,
        "budget_spent": 500, "progress_pct": 50, "deliverables_overdue": 0, "max_overdue_days": 0,
        "deliverables_blocked": 0,
    }
    return {**base, **changes}


def codes(item):
    return [(r["level"], r["code"]) for r in assess(item, TODAY, RULES)[1]]


@pytest.mark.parametrize(("changes", "level", "expected"), [
    ({}, "green", []),
    ({"deliverables_overdue": 2, "max_overdue_days": 3}, "amber", [("amber", "overdue")]),
    ({"deliverables_overdue": 2, "max_overdue_days": 7}, "amber", [("amber", "overdue")]),   # not *more* than 7
    ({"deliverables_overdue": 1, "max_overdue_days": 8}, "red", [("red", "overdue")]),
    ({"deliverables_blocked": 1}, "amber", [("amber", "blocked")]),
    ({"progress_pct": 38}, "amber", [("amber", "schedule")]),                                # 50 elapsed - 38 = 12
    ({"progress_pct": 20, "budget_spent": 200}, "red", [("red", "schedule")]),               # 50 - 20 = 30
    ({"progress_pct": 50, "end_date": date(2026, 5, 20)}, "red", [("red", "past_end_date"), ("red", "schedule")]),
    ({"budget_spent": 700}, "amber", [("amber", "budget")]),                                 # 70 - 50 = 20
    ({"budget_spent": 650}, "green", []),                                                    # gap of exactly 15
    ({"budget_spent": 1200, "progress_pct": 90}, "red", [("red", "over_budget")]),
    ({"planned_budget": 0, "budget_spent": 900}, "green", []),                               # no budget to burn
    ({"start_date": None}, "green", []),                                                     # no schedule to judge
    ({"progress_pct": 0, "deliverables_blocked": 2, "deliverables_overdue": 1, "max_overdue_days": 2},
     "red", [("red", "schedule"), ("amber", "overdue"), ("amber", "blocked"), ("amber", "budget")]),
], ids=lambda v: "" if not isinstance(v, (dict, list)) else None)
def test_rules(changes, level, expected):
    result, reasons = assess(project(**changes), TODAY, RULES)
    assert result == level
    assert sorted(codes(project(**changes))) == sorted(expected) and len(reasons) == len(expected)


@pytest.mark.parametrize("status", ["planning", "completed", "cancelled"])
def test_only_running_projects_are_judged(status):
    assert assess(project(status=status, deliverables_overdue=3, max_overdue_days=30), TODAY, RULES) == (None, [])
    assert assess(project(status="on_hold"), TODAY, RULES)[0] == "green"


def test_reasons_read_clearly():
    _, reasons = assess(project(deliverables_overdue=1, max_overdue_days=1, deliverables_blocked=3, progress_pct=38,
                                end_date=date(2026, 5, 31)), TODAY, RULES)
    assert [r["message"] for r in reasons] == [
        "Past its target end date by 1 day",
        "1 deliverable overdue, the longest by 1 day",
        "3 deliverables blocked",
        "100% of the schedule has passed but only 38% is complete",
    ]


def test_helpers_handle_edges():
    assert health.schedule_elapsed_pct(date(2026, 1, 1), date(2026, 1, 11), date(2025, 12, 1)) == 0
    assert health.schedule_elapsed_pct(date(2026, 1, 1), date(2026, 1, 11), date(2027, 1, 1)) == 100
    assert health.schedule_elapsed_pct(date(2026, 1, 1), date(2026, 1, 1), date(2026, 1, 1)) is None
    assert health.schedule_elapsed_pct(None, date(2026, 1, 1), date(2026, 1, 1)) is None
    assert health.budget_burn_pct(0, 10) is None
    assert health.budget_burn_pct(200, 50) == 25.0
    assert health.budget_burn_pct(None, None) is None


def test_rules_follow_settings(monkeypatch):
    values = {"health.amber_schedule_gap_pct": 1, "health.red_schedule_gap_pct": 2, "health.amber_budget_gap_pct": 3,
              "health.red_overdue_days": 4}
    monkeypatch.setattr(health, "get_setting", values.__getitem__)
    assert health.rules_from_settings() == Rules(1, 2, 3, 4)
