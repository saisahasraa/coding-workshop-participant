"""JSON log format, request context and redaction."""

import json
import logging

from app import log


def _record(msg="hello", **fields):
    record = logging.LogRecord("t", logging.INFO, __file__, 1, msg, None, None)
    if fields:
        record.fields = fields
    return record


def test_json_formatter_includes_context_and_fields():
    log.bind(request_id="r1", user_id=None)
    try:
        line = json.loads(log.JsonFormatter().format(_record(status=200, password="pw")))
    finally:
        log.clear()
    assert line["msg"] == "hello"
    assert line["level"] == "INFO"
    assert line["request_id"] == "r1"
    assert "user_id" not in line
    assert line["status"] == 200
    assert line["password"] == log.REDACTED


def test_json_formatter_includes_exception():
    try:
        raise ValueError("bad")
    except ValueError:
        import sys

        record = logging.LogRecord("t", logging.ERROR, __file__, 1, "oops", None, sys.exc_info())
    assert "ValueError: bad" in json.loads(log.JsonFormatter().format(record))["exc"]


def test_redact_nested():
    data = {"user": {"Password": "x", "name": "a"}, "items": [{"refresh_token": "t"}], "n": 1}
    assert log.redact(data) == {"user": {"Password": "***", "name": "a"}, "items": [{"refresh_token": "***"}], "n": 1}


def test_set_level_and_configure():
    root = logging.getLogger()
    previous_handlers, previous_level = list(root.handlers), root.level
    try:
        log.configure("WARNING")
        assert root.level == logging.WARNING
        assert isinstance(root.handlers[0].formatter, log.JsonFormatter)
        log.set_level("nonsense")
        assert root.level == logging.INFO
        log.flush()
    finally:
        root.handlers[:] = previous_handlers
        root.setLevel(previous_level)
