"""Settings registry validation, override caching and environment parsing."""

import pytest

from app import config
from app.config import Setting, SettingsStore


@pytest.mark.parametrize(("setting", "value", "expected"), [
    (Setting("a", "int", 1, "", minimum=1, maximum=10), 5, 5),
    (Setting("a", "bool", True, ""), False, False),
    (Setting("a", "str", "x", ""), "  hi ", "hi"),
    (Setting("a", "choice", "A", "", choices=("A", "B")), "B", "B"),
    (Setting("a", "int_list", [1], "", minimum=1, maximum=7), [5, 1, 5], [1, 5]),
    (Setting("a", "str_list", ["x"], ""), [" a", "b "], ["a", "b"]),
])
def test_setting_validate_accepts(setting, value, expected):
    assert setting.validate(value) == expected


@pytest.mark.parametrize(("setting", "value"), [
    (Setting("a", "int", 1, "", minimum=1, maximum=10), 0),
    (Setting("a", "int", 1, "", minimum=1, maximum=10), 11),
    (Setting("a", "int", 1, ""), True),
    (Setting("a", "int", 1, ""), "3"),
    (Setting("a", "bool", True, ""), "true"),
    (Setting("a", "str", "x", ""), "   "),
    (Setting("a", "choice", "A", "", choices=("A", "B")), "C"),
    (Setting("a", "int_list", [1], "", minimum=1, maximum=7), [8]),
    (Setting("a", "int_list", [1], ""), []),
    (Setting("a", "int_list", [1], ""), ["1"]),
    (Setting("a", "str_list", ["x"], ""), ["a", "a"]),
    (Setting("a", "str_list", ["x"], ""), [""]),
    (Setting("a", "weird", None, ""), 1),
])
def test_setting_validate_rejects(setting, value):
    with pytest.raises(ValueError):
        setting.validate(value)


def test_registry_defaults_are_valid():
    for setting in config.SETTINGS.values():
        assert setting.validate(setting.default) == setting.default


REGISTRY = {"n": Setting("n", "int", 1, "", minimum=0, maximum=100)}


class FakeClock:
    def __init__(self):
        self.now = 0.0

    def __call__(self):
        return self.now


def test_store_override_default_and_ttl():
    calls = []
    data = {"n": 5}

    def loader():
        calls.append(1)
        return dict(data)

    clock = FakeClock()
    store = SettingsStore(REGISTRY, loader, ttl=30, clock=clock)
    assert store.get("n") == 5
    data["n"] = 7
    clock.now = 10
    assert store.get("n") == 5  # still cached
    clock.now = 31
    assert store.get("n") == 7  # refreshed after TTL
    assert len(calls) == 2
    store.invalidate()
    store.get("n")
    assert len(calls) == 3


def test_store_ignores_invalid_and_unknown_overrides():
    store = SettingsStore(REGISTRY, lambda: {"n": 500, "gone": 1}, ttl=30)
    assert store.get("n") == 1
    assert store.overrides() == {}


def test_store_keeps_last_values_when_loader_fails():
    state = {"fail": False}

    def loader():
        if state["fail"]:
            raise RuntimeError("db down")
        return {"n": 9}

    clock = FakeClock()
    store = SettingsStore(REGISTRY, loader, ttl=1, clock=clock)
    assert store.get("n") == 9
    state["fail"] = True
    clock.now = 5
    assert store.get("n") == 9


def test_store_unknown_key_raises():
    with pytest.raises(KeyError):
        SettingsStore(REGISTRY, dict, ttl=1).get("missing")


def test_load_env_parses_values(monkeypatch):
    monkeypatch.setenv("IS_LOCAL", "false")
    monkeypatch.setenv("SETTINGS_CACHE_SECONDS", "notanumber")
    monkeypatch.setenv("LOG_LEVEL", "debug")
    env = config.load_env()
    assert env.is_local is False
    assert env.environment == "aws"
    assert env.settings_cache_seconds == 30
    assert env.log_level == "DEBUG"
