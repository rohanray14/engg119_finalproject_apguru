"""Ledger database — schema creation and basic CRUD helpers.

Runs on SQLite (tests, local dev, the Streamlit prototype) or Postgres
(production, e.g. Neon).  The backend is picked by the connection target:
a ``postgres://`` / ``postgresql://`` URL gives Postgres, anything else is a
SQLite file path (or ``:memory:``).

Tables mirror the Pydantic models in schemas.py, with an additional
audit_log table.  All money columns store integer paise.
"""

from __future__ import annotations

import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from ledger import pg

_DEFAULT_SQLITE = str(Path(__file__).resolve().parent.parent / "data" / "ledger.db")
DATABASE_URL = os.environ.get("DATABASE_URL", _DEFAULT_SQLITE)
DB_PATH = DATABASE_URL if pg.is_postgres_url(DATABASE_URL) else Path(DATABASE_URL)

# ---------------------------------------------------------------------------
# Schema DDL
# ---------------------------------------------------------------------------

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS student (
    id              INTEGER PRIMARY KEY,
    name            TEXT NOT NULL,
    aliases         TEXT DEFAULT '[]',       -- JSON list
    city            TEXT,
    country         TEXT,
    counselor_ids   TEXT DEFAULT '[]',       -- JSON list of ints
    payer_aliases   TEXT DEFAULT '[]'        -- JSON list
);

CREATE TABLE IF NOT EXISTS enrollment (
    id              INTEGER PRIMARY KEY,
    student_id      INTEGER NOT NULL REFERENCES student(id),
    program         TEXT NOT NULL,
    fee_model       TEXT NOT NULL CHECK(fee_model IN ('package','hourly')),
    total_fee_paise INTEGER NOT NULL,
    currency        TEXT NOT NULL DEFAULT 'INR',
    gst_applicable  INTEGER NOT NULL DEFAULT 1   -- boolean 0/1
);

CREATE TABLE IF NOT EXISTS installment (
    id              INTEGER PRIMARY KEY,
    enrollment_id   INTEGER NOT NULL REFERENCES enrollment(id),
    due_date        TEXT,                         -- ISO date or NULL
    amount_due_paise INTEGER NOT NULL,
    currency        TEXT NOT NULL DEFAULT 'INR',
    status          TEXT NOT NULL DEFAULT 'open'
                    CHECK(status IN ('open','partial','paid','overdue'))
);

CREATE TABLE IF NOT EXISTS payment_in (
    id                  INTEGER PRIMARY KEY,
    source              TEXT NOT NULL CHECK(source IN ('bank','gateway','cash','screenshot')),
    method              TEXT,
    payer_name          TEXT,
    date                TEXT,                     -- ISO date
    amount_paid_paise   INTEGER NOT NULL,
    currency            TEXT NOT NULL DEFAULT 'INR',
    gateway_fee_paise   INTEGER NOT NULL DEFAULT 0,
    gst_on_fee_paise    INTEGER NOT NULL DEFAULT 0,
    fx_diff_paise       INTEGER NOT NULL DEFAULT 0,
    tds_paise           INTEGER NOT NULL DEFAULT 0,
    amount_in_bank_paise INTEGER,
    confirmation        TEXT NOT NULL DEFAULT 'screenshot_only'
                        CHECK(confirmation IN ('screenshot_only','seen_by_gateway','in_bank'))
);

CREATE TABLE IF NOT EXISTS match_result (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    payment_id      INTEGER NOT NULL REFERENCES payment_in(id),
    allocations     TEXT NOT NULL DEFAULT '[]',   -- JSON list of {installment_id, allocated_paise}
    method          TEXT NOT NULL CHECK(method IN ('rules','ai','human')),
    confidence      REAL NOT NULL DEFAULT 0.0,
    reason          TEXT DEFAULT '',
    status          TEXT NOT NULL DEFAULT 'pending_review'
                    CHECK(status IN ('auto','pending_review','approved','rejected'))
);

CREATE TABLE IF NOT EXISTS counselor (
    id              INTEGER PRIMARY KEY,
    name            TEXT NOT NULL,
    terms_text      TEXT DEFAULT '',
    parsed_rule     TEXT                          -- JSON or NULL
);

CREATE TABLE IF NOT EXISTS commission_line (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    counselor_id            INTEGER NOT NULL REFERENCES counselor(id),
    payment_id              INTEGER NOT NULL REFERENCES payment_in(id),
    base_paise              INTEGER NOT NULL,
    rate                    REAL NOT NULL,
    commission_paise        INTEGER NOT NULL,
    refund_deduction_paise  INTEGER NOT NULL DEFAULT 0,
    tds_paise               INTEGER NOT NULL DEFAULT 0,
    net_paise               INTEGER NOT NULL DEFAULT 0,
    currency                TEXT NOT NULL DEFAULT 'INR'  -- currency of the payment it came from
);

CREATE TABLE IF NOT EXISTS payment_out (
    id              INTEGER PRIMARY KEY,
    date            TEXT,
    payee           TEXT NOT NULL,
    category        TEXT NOT NULL CHECK(category IN (
                        'faculty','commission','refund','rent','ads','tax','software','other')),
    amount_paise    INTEGER NOT NULL,
    currency        TEXT NOT NULL DEFAULT 'INR'
);

CREATE TABLE IF NOT EXISTS bank_statement (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    date            TEXT NOT NULL,                -- ISO date
    narration       TEXT NOT NULL,
    credit_paise    INTEGER NOT NULL DEFAULT 0,
    debit_paise     INTEGER NOT NULL DEFAULT 0,
    payment_id      INTEGER REFERENCES payment_in(id),  -- linked payment (NULL = unmatched)
    UNIQUE(date, narration, credit_paise, debit_paise)   -- idempotent ingestion
);

CREATE TABLE IF NOT EXISTS app_meta (
    key             TEXT PRIMARY KEY,             -- e.g. 'environment'
    value           TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS payout_approval (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    approved_at         TEXT NOT NULL,
    actor               TEXT NOT NULL,
    currency            TEXT NOT NULL,
    total_net_paise     INTEGER NOT NULL,
    lines_fingerprint   TEXT NOT NULL              -- hash of the exact lines approved
);

CREATE TABLE IF NOT EXISTS payout_approval_line (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    payout_id       INTEGER NOT NULL REFERENCES payout_approval(id),
    counselor_id    INTEGER NOT NULL,
    payment_id      INTEGER NOT NULL,
    currency        TEXT NOT NULL,
    net_paise       INTEGER NOT NULL              -- amount approved for this line in this payout
);

CREATE TABLE IF NOT EXISTS audit_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp       TEXT NOT NULL,                -- ISO datetime
    actor           TEXT NOT NULL,                -- user or agent name
    action          TEXT NOT NULL,
    entity          TEXT NOT NULL,                -- e.g. 'match:42'
    old_value       TEXT,
    new_value       TEXT
);
"""


# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------

def get_connection(db_path: Path | str | None = None):
    """Return a connection to the ledger database, creating tables if needed.

    Returns a ``sqlite3.Connection`` for SQLite targets and a
    ``ledger.pg.PgConnection`` (same calling conventions) for Postgres URLs.
    """
    path = str(db_path or DB_PATH)
    if pg.is_postgres_url(path):
        return pg.connect(path, SCHEMA_SQL)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.executescript(SCHEMA_SQL)
    migrate_sqlite(conn)
    return conn


def migrate_sqlite(conn) -> None:
    """Add columns introduced after a SQLite file was created."""
    cols = {r[1] for r in conn.execute("PRAGMA table_info(commission_line)").fetchall()}
    if "currency" not in cols:
        conn.execute("ALTER TABLE commission_line ADD COLUMN currency TEXT NOT NULL DEFAULT 'INR'")
        conn.commit()


def decision_lock(conn) -> None:
    """Serialize decisions that rewrite shared ledger state (approvals,
    commission rebuilds, payouts) for the rest of this transaction.

    Postgres: a transaction-scoped advisory lock, released on commit/rollback.
    SQLite: ``BEGIN IMMEDIATE`` takes the single writer lock up front.
    Without this, two overlapping approvals could each rebuild the commission
    lines and leave both sets in place, doubling the payout total.
    """
    if isinstance(conn, pg.PgConnection):
        conn.execute("SELECT pg_advisory_xact_lock(?)", (pg.DECISION_LOCK_KEY,)).fetchone()
    elif not conn.in_transaction:
        conn.execute("BEGIN IMMEDIATE")


def get_meta(conn, key: str) -> Optional[str]:
    row = conn.execute("SELECT value FROM app_meta WHERE key = ?", (key,)).fetchone()
    return row[0] if row else None


def set_meta(conn, key: str, value: str) -> None:
    # Upsert syntax shared by SQLite (3.24+) and Postgres
    conn.execute(
        "INSERT INTO app_meta (key, value) VALUES (?, ?) "
        "ON CONFLICT (key) DO UPDATE SET value = excluded.value",
        (key, value),
    )


def table_exists(conn, name: str) -> bool:
    """True if a table called ``name`` exists (works on SQLite and Postgres)."""
    if isinstance(conn, pg.PgConnection):
        row = conn.execute(
            "SELECT 1 FROM information_schema.tables "
            "WHERE table_schema = current_schema() AND table_name = ?",
            (name,),
        ).fetchone()
    else:
        row = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)
        ).fetchone()
    return row is not None


def log_audit(
    conn,
    actor: str,
    action: str,
    entity: str,
    old_value: Optional[str] = None,
    new_value: Optional[str] = None,
    commit: bool = True,
) -> None:
    """Insert a row into the audit_log table.

    The audit log is append-only: rows are never updated or deleted.
    Pass ``commit=False`` to write the audit row inside the caller's
    transaction, so the change and its audit entry succeed or fail together.
    """
    conn.execute(
        "INSERT INTO audit_log (timestamp, actor, action, entity, old_value, new_value) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (datetime.now(timezone.utc).isoformat(), actor, action, entity, old_value, new_value),
    )
    if commit:
        conn.commit()


def verify_audit_integrity(conn) -> bool:
    """Verify the audit log has not been tampered with.

    SQLite: checks that IDs are sequential with no gaps (append-only invariant).
    Postgres: sequences legitimately skip IDs after a rolled-back transaction,
    so instead the database itself enforces append-only with a trigger that
    rejects UPDATE and DELETE; this checks that trigger is installed.
    Returns True if integrity holds.
    """
    if isinstance(conn, pg.PgConnection):
        return pg.audit_guard_installed(conn)
    rows = conn.execute(
        "SELECT id FROM audit_log ORDER BY id"
    ).fetchall()
    if not rows:
        return True
    ids = [r["id"] for r in rows]
    return ids == list(range(ids[0], ids[0] + len(ids)))
