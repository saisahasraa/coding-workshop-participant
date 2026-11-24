"""Pure capacity maths (no database)."""

from datetime import date

import pytest

from app.capacity import person_capacity, reserved_hours, working_days_between

MON_FRI = frozenset({1, 2, 3, 4, 5})
D = date.fromisoformat


@pytest.mark.parametrize(("start", "end", "expected"), [
    ("2026-03-02", "2026-03-02", 1),      # a Monday
    ("2026-03-02", "2026-03-06", 5),      # Monday to Friday
    ("2026-03-07", "2026-03-08", 0),      # weekend
    ("2026-03-02", "2026-03-13", 10),     # two weeks
    ("2026-03-04", "2026-03-10", 5),      # Wednesday to next Tuesday (7 days)
    ("2026-03-06", "2026-03-09", 2),      # Friday to Monday
    ("2026-03-02", "2026-03-31", 22),     # a month
    ("2026-03-13", "2026-03-02", 0),      # reversed
])
def test_working_days_between(start, end, expected):
    assert working_days_between(D(start), D(end), MON_FRI) == expected


def test_working_days_between_custom_week():
    assert working_days_between(D("2026-03-02"), D("2026-03-08"), frozenset({1, 2, 3, 4, 5, 6})) == 6
    assert working_days_between(D("2026-03-02"), D("2026-03-08"), frozenset({7})) == 1


WINDOW = (D("2026-03-02"), D("2026-03-13"))  # ten working days
LEAVE_3_DAYS = [(D("2026-03-09"), D("2026-03-11"))]


def test_capacity_with_leave_and_work_by_hand():
    result = person_capacity(40, WINDOW, LEAVE_3_DAYS, 48, MON_FRI, 100)
    assert result["capacity_hours"] == 80.0       # 8 h/day x 10
    assert result["leave_days"] == 3 and result["leave_hours"] == 24.0
    assert result["available_hours"] == 56.0
    assert result["allocated_hours"] == 48.0
    assert result["free_hours"] == 8.0
    assert result["utilization_pct"] == 85.7
    assert result["over_allocated"] is False


def test_more_work_than_availability_is_over_allocated():
    result = person_capacity(40, WINDOW, LEAVE_3_DAYS, 88, MON_FRI, 100)
    assert result["utilization_pct"] == 157.1 and result["free_hours"] == -32.0
    assert result["over_allocated"] is True


def test_leave_alone_can_cause_over_allocation():
    assert person_capacity(40, WINDOW, [], 80, MON_FRI, 100)["over_allocated"] is False   # exactly full
    one_day = [(D("2026-03-02"), D("2026-03-02"))]
    assert person_capacity(40, WINDOW, one_day, 80, MON_FRI, 100)["over_allocated"] is True


def test_threshold_is_configurable_and_strict():
    assert person_capacity(40, WINDOW, [], 72, MON_FRI, 80)["over_allocated"] is True     # 90% > 80%
    assert person_capacity(40, WINDOW, [], 72, MON_FRI, 120)["over_allocated"] is False
    assert person_capacity(40, WINDOW, [], 80, MON_FRI, 100)["over_allocated"] is False   # equal is not over


def test_only_leave_inside_the_window_counts():
    outside = [(D("2026-02-01"), D("2026-02-10")), (D("2026-04-01"), D("2026-04-03"))]
    partial = [(D("2026-03-12"), D("2026-03-20"))]                                       # Thu-Fri in the window
    assert person_capacity(40, WINDOW, outside, 0, MON_FRI, 100)["leave_days"] == 0
    assert person_capacity(40, WINDOW, partial, 0, MON_FRI, 100)["leave_days"] == 2


def test_part_time_capacity_and_custom_working_week():
    result = person_capacity(32, WINDOW, [], 32, MON_FRI, 100)
    assert result["capacity_hours"] == 64.0 and result["utilization_pct"] == 50.0       # 6.4 h/day
    four_day = person_capacity(40, WINDOW, [], 0, frozenset({1, 2, 3, 4}), 100)
    assert four_day["capacity_hours"] == 80.0                                            # 10 h/day x 8 days


def test_no_availability_is_handled():
    leave_all = [(D("2026-03-01"), D("2026-03-31"))]
    idle = person_capacity(40, WINDOW, leave_all, 0, MON_FRI, 100)
    assert idle["available_hours"] == 0 and idle["utilization_pct"] is None and idle["over_allocated"] is False
    busy = person_capacity(40, WINDOW, leave_all, 10, MON_FRI, 100)
    assert busy["utilization_pct"] is None and busy["over_allocated"] is True


# -- reserving a deliverable's hours between today and its deadline ------------------------

TODAY = D("2026-03-02")  # a Monday


def test_hours_are_spread_evenly_over_working_days_until_the_deadline():
    # due Friday of the second week: 10 working days, so 4 h a day
    assert reserved_hours(40, D("2026-03-13"), WINDOW, TODAY, MON_FRI) == 40
    first_week = (D("2026-03-02"), D("2026-03-06"))
    assert reserved_hours(40, D("2026-03-13"), first_week, TODAY, MON_FRI) == 20


def test_work_due_after_the_window_still_takes_part_of_it():
    # due 30 Apr: 44 working days from today, 10 of them inside the window
    assert reserved_hours(88, D("2026-04-30"), WINDOW, TODAY, MON_FRI) == pytest.approx(20.0)


def test_overdue_work_is_reserved_today_only():
    assert reserved_hours(16, D("2026-01-15"), WINDOW, TODAY, MON_FRI) == 16
    later = (D("2026-03-09"), D("2026-03-13"))
    assert reserved_hours(16, D("2026-01-15"), later, TODAY, MON_FRI) == 0


def test_windows_before_today_or_after_the_deadline_get_nothing():
    assert reserved_hours(40, D("2026-03-13"), (D("2026-02-02"), D("2026-02-13")), TODAY, MON_FRI) == 0
    assert reserved_hours(40, D("2026-03-06"), (D("2026-03-09"), D("2026-03-13")), TODAY, MON_FRI) == 0


def test_a_window_starting_later_gets_its_share_of_the_same_spread():
    later = (D("2026-03-09"), D("2026-03-13"))
    assert reserved_hours(20, D("2026-03-13"), later, TODAY, MON_FRI) == 10


def test_nothing_remaining_reserves_nothing():
    assert reserved_hours(0, D("2026-03-13"), WINDOW, TODAY, MON_FRI) == 0


def test_a_deadline_on_a_day_off_lands_on_the_next_working_day():
    saturday = D("2026-03-07")
    next_week = (D("2026-03-09"), D("2026-03-13"))
    assert reserved_hours(8, D("2026-03-08"), next_week, saturday, MON_FRI) == 8
    assert reserved_hours(8, D("2026-03-08"), (D("2026-03-02"), D("2026-03-06")), saturday, MON_FRI) == 0
