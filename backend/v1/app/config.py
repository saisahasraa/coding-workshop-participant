"""
Configuration in three layers (lowest to highest precedence):

1. Code defaults declared once in ``SETTINGS``.
2. Environment variables, for bootstrap values and secrets only (``Env``).
3. Admin overrides stored in the ``app_settings`` table, cached per container for
   ``SETTINGS_CACHE_SECONDS`` so changes apply without a redeploy.
"""

from __future__ import annotations

import logging
import os
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Layer 2: environment (bootstrap + secrets)
# ---------------------------------------------------------------------------

def _env_bool(name: str, default: bool = False) -> bool:
    return os.getenv(name, str(default)).strip().lower() in ("1", "true", "yes")


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except ValueError:
        return default


@dataclass(frozen=True)
class Env:
    """Values fixed at deploy time. Secrets live here and never in the database."""

    is_local: bool
    postgres_host: str
    postgres_port: str
    postgres_name: str
    postgres_user: str
    postgres_pass: str
    jwt_secret: str
    log_level: str
    settings_cache_seconds: int
    admin_email: str
    admin_password: str
    app_version: str

    @property
    def environment(self) -> str:
        """Human-readable environment name."""
        return "local" if self.is_local else "aws"


def load_env() -> Env:
    """Read the environment into an immutable ``Env``."""
    return Env(
        is_local=_env_bool("IS_LOCAL"),
        postgres_host=os.getenv("POSTGRES_HOST", "localhost"),
        postgres_port=os.getenv("POSTGRES_PORT", "5432"),
        postgres_name=os.getenv("POSTGRES_NAME", "postgres"),
        postgres_user=os.getenv("POSTGRES_USER", "postgres"),
        postgres_pass=os.getenv("POSTGRES_PASS", ""),
        jwt_secret=os.getenv("JWT_SECRET", ""),
        log_level=os.getenv("LOG_LEVEL", "INFO").upper(),
        settings_cache_seconds=_env_int("SETTINGS_CACHE_SECONDS", 30),
        admin_email=os.getenv("ADMIN_EMAIL", ""),
        admin_password=os.getenv("ADMIN_PASSWORD", ""),
        app_version=os.getenv("APP_VERSION", "0.1.0"),
    )


ENV = load_env()


# ---------------------------------------------------------------------------
# Layer 1: setting registry (code defaults + validation rules)
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class Setting:
    """A runtime-tunable setting. ``kind`` is one of: int, str, bool, choice, int_list, str_list."""

    key: str
    kind: str
    default: Any
    description: str
    minimum: int | None = None
    maximum: int | None = None
    choices: tuple = ()
    public: bool = False  # exposed to every signed-in user via GET /meta

    def validate(self, value: Any) -> Any:
        """Return the normalized value or raise ``ValueError`` with a client-facing message."""
        if self.kind == "bool":
            if not isinstance(value, bool):
                raise ValueError("must be true or false")
            return value
        if self.kind == "int":
            if isinstance(value, bool) or not isinstance(value, int):
                raise ValueError("must be an integer")
            self._check_range(value)
            return value
        if self.kind in ("str", "choice"):
            if not isinstance(value, str) or not value.strip():
                raise ValueError("must be a non-empty string")
            value = value.strip()
            if self.kind == "choice" and value not in self.choices:
                raise ValueError(f"must be one of: {', '.join(self.choices)}")
            return value
        if self.kind in ("int_list", "str_list"):
            return self._validate_list(value)
        raise ValueError(f"unsupported setting kind {self.kind}")

    def _check_range(self, value: int) -> None:
        if self.minimum is not None and value < self.minimum:
            raise ValueError(f"must be at least {self.minimum}")
        if self.maximum is not None and value > self.maximum:
            raise ValueError(f"must be at most {self.maximum}")

    def _validate_list(self, value: Any) -> list:
        if not isinstance(value, list) or not value:
            raise ValueError("must be a non-empty list")
        if self.kind == "int_list":
            if any(isinstance(v, bool) or not isinstance(v, int) for v in value):
                raise ValueError("must contain only integers")
            for item in value:
                self._check_range(item)
            return sorted(set(value))
        if any(not isinstance(v, str) or not v.strip() for v in value):
            raise ValueError("must contain only non-empty strings")
        cleaned = [v.strip() for v in value]
        if len(set(cleaned)) != len(cleaned):
            raise ValueError("must not contain duplicates")
        return cleaned


LOG_LEVELS = ("DEBUG", "INFO", "WARNING", "ERROR")

SETTINGS: dict[str, Setting] = {
    s.key: s
    for s in (
        Setting("app.name", "str", "ACME Project Tracker", "Application name shown in the UI", public=True),
        Setting("logging.level", "choice", "INFO", "Backend log level (applies within the cache window)",
                choices=LOG_LEVELS),
        Setting("db.statement_timeout_ms", "int", 10000, "Maximum time a single SQL statement may run",
                minimum=1000, maximum=60000),
        Setting("api.default_page_size", "int", 25, "Default number of items per list page",
                minimum=1, maximum=500, public=True),
        Setting("api.max_page_size", "int", 200, "Maximum number of items a client may request per page",
                minimum=1, maximum=1000, public=True),
    )
}


# ---------------------------------------------------------------------------
# Layer 3: runtime overrides, cached per container
# ---------------------------------------------------------------------------

class SettingsStore:
    """Resolves settings as override-or-default, refreshing overrides at most every ``ttl`` seconds."""

    def __init__(
        self,
        registry: dict[str, Setting],
        loader: Callable[[], dict[str, Any]],
        ttl: float,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._registry = registry
        self._loader = loader
        self._ttl = ttl
        self._clock = clock
        self._overrides: dict[str, Any] = {}
        self._loaded_at: float | None = None
        self._lock = threading.Lock()

    def get(self, key: str) -> Any:
        """Return the effective value of ``key`` (raises ``KeyError`` for unknown keys)."""
        setting = self._registry[key]
        return self._current_overrides().get(key, setting.default)

    def overrides(self) -> dict[str, Any]:
        """Return the valid overrides currently in effect."""
        return dict(self._current_overrides())

    def invalidate(self) -> None:
        """Force the next read to reload overrides (used right after an admin change)."""
        with self._lock:
            self._loaded_at = None

    def _current_overrides(self) -> dict[str, Any]:
        with self._lock:
            now = self._clock()
            if self._loaded_at is None or now - self._loaded_at >= self._ttl:
                self._refresh(now)
            return self._overrides

    def _refresh(self, now: float) -> None:
        try:
            raw = self._loader()
        except Exception:  # pylint: disable=broad-except
            # Keep serving the last known values (or defaults); retry on the next window.
            logger.warning("Could not load setting overrides; using cached values", exc_info=True)
            self._loaded_at = now
            return
        valid = {}
        for key, value in raw.items():
            setting = self._registry.get(key)
            if setting is None:
                continue  # setting removed from code; ignore stale row
            try:
                valid[key] = setting.validate(value)
            except ValueError as exc:
                logger.warning("Ignoring invalid override for %s: %s", key, exc)
        self._overrides = valid
        self._loaded_at = now


def _load_overrides_from_db() -> dict[str, Any]:
    from app import db  # pylint: disable=import-outside-toplevel  (avoids an import cycle)

    rows = db.fetch_all("SELECT key, value FROM app_settings")
    return {row["key"]: row["value"] for row in rows}


settings = SettingsStore(SETTINGS, _load_overrides_from_db, ENV.settings_cache_seconds)


def get_setting(key: str) -> Any:
    """Shortcut for ``settings.get(key)``."""
    return settings.get(key)
