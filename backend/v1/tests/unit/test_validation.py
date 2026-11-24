"""Field coercion and payload validation."""

from datetime import date, datetime
from decimal import Decimal

import pytest

from app.http import BadRequest, ValidationFailed
from app.validation import Field, coerce, parse_id, validate_fields


@pytest.mark.parametrize("raw", ["1", 1, "9223372036854775807"])
def test_parse_id_valid(raw):
    assert parse_id(raw) == int(raw)


@pytest.mark.parametrize("raw", ["0", 0, -1, "abc", "1.5", True, None, "9223372036854775808", " 1"])
def test_parse_id_invalid(raw):
    with pytest.raises(BadRequest):
        parse_id(raw)


@pytest.mark.parametrize(("spec", "value", "expected"), [
    (Field("string", max_len=5), "  ab ", "ab"),
    (Field("string"), "", None),
    (Field("email"), " A@B.co ", "a@b.co"),
    (Field("enum", choices=("x", "y")), "y", "y"),
    (Field("integer", minimum=Decimal(0)), "3", 3),
    (Field("decimal", minimum=Decimal(0), exclusive_min=True, maximum=Decimal(100)), 12.5, Decimal("12.5")),
    (Field("boolean"), "true", True),
    (Field("boolean"), False, False),
    (Field("ref"), "4", 4),
    (Field("date"), "2026-02-03", date(2026, 2, 3)),
    (Field("datetime"), "2026-02-03T04:05:06Z", datetime.fromisoformat("2026-02-03T04:05:06+00:00")),
    (Field("string"), None, None),
])
def test_coerce_accepts(spec, value, expected):
    assert coerce(spec, value) == expected


@pytest.mark.parametrize(("spec", "value"), [
    (Field("string"), 5),
    (Field("string", required=True), "  "),
    (Field("string", min_len=3), "ab"),
    (Field("string", max_len=2), "abc"),
    (Field("email"), "nope"),
    (Field("enum", choices=("x",)), "z"),
    (Field("integer"), "1.5"),
    (Field("integer"), True),
    (Field("decimal"), "NaN"),
    (Field("decimal"), "abc"),
    (Field("decimal"), [1]),
    (Field("decimal", minimum=Decimal(0)), -1),
    (Field("decimal", minimum=Decimal(0), exclusive_min=True), 0),
    (Field("decimal", maximum=Decimal(10)), 11),
    (Field("boolean"), "yes"),
    (Field("ref"), 1.5),
    (Field("ref"), "0"),
    (Field("date"), "2026-13-01"),
    (Field("date"), 20260101),
    (Field("datetime"), "yesterday"),
    (Field("string", nullable=False), None),
])
def test_coerce_rejects(spec, value):
    with pytest.raises(ValueError):
        coerce(spec, value)


def test_unknown_kind_rejected():
    with pytest.raises(ValueError):
        Field("money")


FIELDS = {"name": Field("string", required=True, nullable=False, max_len=10), "age": Field("integer")}


def test_validate_fields_create_and_partial():
    assert validate_fields(FIELDS, {"name": "Ann", "age": 3}) == {"name": "Ann", "age": 3}
    assert validate_fields(FIELDS, {"age": 4}, partial=True) == {"age": 4}


def test_validate_fields_collects_all_errors():
    with pytest.raises(ValidationFailed) as exc:
        validate_fields(FIELDS, {"age": "x", "extra": 1})
    assert exc.value.details == {"name": "is required", "age": "must be a number", "extra": "is not an allowed field"}


@pytest.mark.parametrize(("body", "partial"), [([], False), ({}, True)])
def test_validate_fields_rejects_bad_shapes(body, partial):
    with pytest.raises(BadRequest):
        validate_fields(FIELDS, body, partial=partial)
