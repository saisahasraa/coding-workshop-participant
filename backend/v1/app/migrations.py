"""
Versioned schema migrations.

``CREATE TABLE IF NOT EXISTS`` cannot evolve an existing table, so every schema change is an
append-only, numbered entry in ``MIGRATIONS``. Each runs exactly once per database, in order,
recorded in ``schema_migrations``. Never edit an applied migration; add a new one instead.
"""

from __future__ import annotations

import logging

from app import db

logger = logging.getLogger(__name__)

# Arbitrary constant: serializes concurrent cold starts so two containers never migrate at once.
_LOCK_ID = 726354001

MIGRATIONS: list[tuple[int, str, str]] = [
    (
        1,
        "runtime settings",
        """
        CREATE TABLE app_settings (
            key        TEXT PRIMARY KEY,
            value      JSONB NOT NULL,
            updated_by BIGINT,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """,
    ),
    (
        2,
        "organization, projects, deliverables, audit log",
        """
        CREATE TABLE departments (
            id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            name        VARCHAR(100) NOT NULL UNIQUE,
            code        VARCHAR(10)  NOT NULL UNIQUE,
            description TEXT,
            created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        CREATE TABLE users (
            id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            email                 VARCHAR(255) NOT NULL UNIQUE,
            name                  VARCHAR(200) NOT NULL,
            password_hash         TEXT,
            role                  VARCHAR(20) NOT NULL DEFAULT 'team_member'
                                  CHECK (role IN ('admin', 'project_manager', 'team_lead', 'team_member', 'viewer')),
            job_title             VARCHAR(100),
            weekly_capacity_hours NUMERIC(5, 2) NOT NULL DEFAULT 40
                                  CHECK (weekly_capacity_hours BETWEEN 0 AND 168),
            is_active             BOOLEAN NOT NULL DEFAULT true,
            token_version         INTEGER NOT NULL DEFAULT 0,
            last_login_at         TIMESTAMPTZ,
            created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE INDEX idx_users_role ON users (role);

        CREATE TABLE projects (
            id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            code           VARCHAR(20)  NOT NULL UNIQUE,
            name           VARCHAR(200) NOT NULL,
            description    TEXT,
            department_id  BIGINT NOT NULL REFERENCES departments (id),
            manager_id     BIGINT NOT NULL REFERENCES users (id),
            status         VARCHAR(20) NOT NULL DEFAULT 'planning'
                           CHECK (status IN ('planning', 'active', 'on_hold', 'completed', 'cancelled')),
            priority       VARCHAR(20) NOT NULL DEFAULT 'medium'
                           CHECK (priority IN ('low', 'medium', 'high', 'critical')),
            start_date     DATE,
            end_date       DATE,
            planned_budget NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (planned_budget >= 0),
            visibility     VARCHAR(10) NOT NULL DEFAULT 'inherit'
                           CHECK (visibility IN ('inherit', 'everyone', 'members')),
            completed_at   TIMESTAMPTZ,
            created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
            CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
        );
        CREATE INDEX idx_projects_department ON projects (department_id);
        CREATE INDEX idx_projects_manager ON projects (manager_id);
        CREATE INDEX idx_projects_status ON projects (status);

        CREATE TABLE deliverables (
            id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            project_id      BIGINT NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
            name            VARCHAR(200) NOT NULL,
            description     TEXT,
            owner_id        BIGINT REFERENCES users (id),
            status          VARCHAR(20) NOT NULL DEFAULT 'not_started'
                            CHECK (status IN ('not_started', 'in_progress', 'blocked', 'completed')),
            priority        VARCHAR(20) NOT NULL DEFAULT 'medium'
                            CHECK (priority IN ('low', 'medium', 'high', 'critical')),
            due_date        DATE,
            estimated_hours NUMERIC(8, 2) CHECK (estimated_hours >= 0),
            progress_pct    INTEGER NOT NULL DEFAULT 0 CHECK (progress_pct BETWEEN 0 AND 100),
            completed_at    TIMESTAMPTZ,
            created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE INDEX idx_deliverables_project ON deliverables (project_id);
        CREATE INDEX idx_deliverables_owner ON deliverables (owner_id);
        CREATE INDEX idx_deliverables_due ON deliverables (due_date);

        CREATE TABLE audit_log (
            id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            actor_id   BIGINT REFERENCES users (id) ON DELETE SET NULL,
            action     VARCHAR(10) NOT NULL CHECK (action IN ('create', 'update', 'delete')),
            entity     VARCHAR(50) NOT NULL,
            entity_id  TEXT NOT NULL,
            changes    JSONB NOT NULL DEFAULT '{}',
            request_id TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE INDEX idx_audit_entity ON audit_log (entity, entity_id);
        CREATE INDEX idx_audit_created ON audit_log (created_at DESC);

        ALTER TABLE app_settings
            ADD CONSTRAINT fk_app_settings_user FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL;
        """,
    ),
    (
        3,
        "project keys, deliverable numbers, reporters, acceptance criteria, comments, links",
        """
        -- Project codes become short Jira-style keys (ENG, SRE, DEVOPS): 3-6 chars, letter first.
        ALTER TABLE projects RENAME COLUMN code TO key;
        ALTER TABLE projects RENAME CONSTRAINT projects_code_key TO projects_key_key;
        WITH cleaned AS (
            SELECT id, left(regexp_replace(upper(key), '[^A-Z]', '', 'g'), 6) AS k FROM projects
        ), valid AS (
            SELECT id, CASE WHEN k ~ '^[A-Z][A-Z0-9]{2,5}$' THEN k ELSE 'P' || lpad(id::text, 2, '0') END AS k
              FROM cleaned
        ), ranked AS (
            SELECT id, k, row_number() OVER (PARTITION BY k ORDER BY id) AS rn FROM valid
        )
        UPDATE projects p
           SET key = CASE WHEN r.rn = 1 THEN r.k ELSE left(r.k, 6 - length(r.rn::text)) || r.rn END
          FROM ranked r WHERE r.id = p.id;
        ALTER TABLE projects ADD CONSTRAINT projects_key_format CHECK (key ~ '^[A-Z][A-Z0-9]{2,5}$');
        ALTER TABLE projects ADD COLUMN deliverable_seq INTEGER NOT NULL DEFAULT 0;

        -- Deliverables get a per-project number (key = <project key>-<number>), a reporter and criteria.
        ALTER TABLE deliverables
            ADD COLUMN number INTEGER,
            ADD COLUMN reporter_id BIGINT REFERENCES users (id),
            ADD COLUMN acceptance_criteria TEXT;
        UPDATE deliverables d SET number = r.n
          FROM (SELECT id, row_number() OVER (PARTITION BY project_id ORDER BY id) AS n FROM deliverables) r
         WHERE r.id = d.id;
        UPDATE projects p
           SET deliverable_seq = COALESCE((SELECT max(number) FROM deliverables d WHERE d.project_id = p.id), 0);
        UPDATE deliverables d SET reporter_id = p.manager_id FROM projects p WHERE p.id = d.project_id;
        ALTER TABLE deliverables
            ALTER COLUMN number SET NOT NULL,
            ADD CONSTRAINT uq_deliverables_project_number UNIQUE (project_id, number);
        CREATE INDEX idx_deliverables_reporter ON deliverables (reporter_id);

        CREATE TABLE comments (
            id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            deliverable_id BIGINT NOT NULL REFERENCES deliverables (id) ON DELETE CASCADE,
            author_id      BIGINT NOT NULL REFERENCES users (id),
            body           TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 5000),
            created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE INDEX idx_comments_deliverable ON comments (deliverable_id, created_at);

        -- "A blocks B" (B depends on A) or "A relates to B".
        CREATE TABLE deliverable_links (
            id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            source_id  BIGINT NOT NULL REFERENCES deliverables (id) ON DELETE CASCADE,
            target_id  BIGINT NOT NULL REFERENCES deliverables (id) ON DELETE CASCADE,
            type       VARCHAR(20) NOT NULL CHECK (type IN ('blocks', 'relates_to')),
            created_by BIGINT REFERENCES users (id) ON DELETE SET NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            UNIQUE (source_id, target_id, type),
            CHECK (source_id <> target_id)
        );
        CREATE INDEX idx_links_target ON deliverable_links (target_id);
        """,
    ),
]

_current_version: int | None = None
_ready_hooks: list = []


def on_ready(hook) -> None:
    """Register a callable run once per container right after migrations (e.g. admin bootstrap)."""
    _ready_hooks.append(hook)


def migrate() -> int:
    """Apply pending migrations and return the resulting schema version."""
    conn = db.connection()
    with conn.transaction():
        conn.execute("SELECT pg_advisory_xact_lock(%s)", (_LOCK_ID,))
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version    INTEGER PRIMARY KEY,
                name       TEXT NOT NULL,
                applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
            """
        )
        row = conn.execute("SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations").fetchone()
        version = row["v"]
        for number, name, statement in MIGRATIONS:
            if number <= version:
                continue
            logger.info("Applying migration %s: %s", number, name)
            with conn.transaction():  # savepoint: a failing migration is reported with its number
                conn.execute(statement)
                conn.execute("INSERT INTO schema_migrations (version, name) VALUES (%s, %s)", (number, name))
            version = number
    return version


def ensure_migrated() -> int:
    """Run ``migrate()`` once per container; later calls return the cached version."""
    global _current_version  # pylint: disable=global-statement
    if _current_version is None:
        version = migrate()
        logger.info("Database schema at version %s", version)
        for hook in _ready_hooks:
            hook()
        _current_version = version
    return _current_version


def latest_version() -> int:
    """Highest migration number defined in code."""
    return MIGRATIONS[-1][0] if MIGRATIONS else 0
