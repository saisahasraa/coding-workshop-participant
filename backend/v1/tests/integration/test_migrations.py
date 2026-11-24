"""Migrations apply once, in order, and are idempotent."""

from app import db, migrations


def test_migrate_creates_tables_and_is_idempotent():
    assert migrations.migrate() == migrations.latest_version()
    assert migrations.migrate() == migrations.latest_version()
    rows = db.fetch_all("SELECT version FROM schema_migrations ORDER BY version")
    assert [r["version"] for r in rows] == [m[0] for m in migrations.MIGRATIONS]
    assert db.fetch_one("SELECT to_regclass('public.app_settings') AS t")["t"] == "app_settings"


def test_new_migration_is_applied_after_existing(monkeypatch):
    extra = (migrations.latest_version() + 1, "probe", "CREATE TABLE probe_table (id INT)")
    monkeypatch.setattr(migrations, "MIGRATIONS", [*migrations.MIGRATIONS, extra])
    try:
        assert migrations.migrate() == extra[0]
        assert db.fetch_one("SELECT to_regclass('public.probe_table') AS t")["t"] == "probe_table"
    finally:
        db.execute("DROP TABLE IF EXISTS probe_table")
        db.execute("DELETE FROM schema_migrations WHERE version = %s", (extra[0],))
