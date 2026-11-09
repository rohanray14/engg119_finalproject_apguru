"""SQLite ledger database — schema creation and basic CRUD helpers.

Tables mirror the Pydantic models in schemas.py, with an additional
audit_log table.  All money columns store integer paise.
"""

from __future__ import annotations

import os
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

DB_PATH = Path(os.environ.get("DATABASE_URL", str(
    Path(__file__).resolve().parent.parent / "data" / "ledger.db"
)))

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
    net_paise               INTEGER NOT NULL DEFAULT 0
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

def get_connection(db_path: Path | str | None = None) -> sqlite3.Connection:
    """Return a connection to the ledger database, creating tables if needed."""
    path = str(db_path or DB_PATH)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.executescript(SCHEMA_SQL)
    return conn


def log_audit(
    conn: sqlite3.Connection,
    actor: str,
    action: str,
    entity: str,
    old_value: Optional[str] = None,
    new_value: Optional[str] = None,
) -> None:
    """Insert a row into the audit_log table.

    The audit log is append-only: rows are never updated or deleted.
    """
    conn.execute(
        "INSERT INTO audit_log (timestamp, actor, action, entity, old_value, new_value) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (datetime.now(timezone.utc).isoformat(), actor, action, entity, old_value, new_value),
    )
    conn.commit()


def verify_audit_integrity(conn: sqlite3.Connection) -> bool:
    """Verify the audit log has not been tampered with.

    Checks that IDs are sequential with no gaps (append-only invariant).
    Returns True if integrity holds.
    """
    rows = conn.execute(
        "SELECT id FROM audit_log ORDER BY id"
    ).fetchall()
    if not rows:
        return True
    ids = [r["id"] for r in rows]
    return ids == list(range(ids[0], ids[0] + len(ids)))
