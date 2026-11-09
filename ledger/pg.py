"""Postgres backend with a sqlite3-compatible surface.

The agents and loaders were written against ``sqlite3``: ``?`` placeholders,
``INSERT OR REPLACE``, rows that support both ``row[0]`` and ``row["col"]``.
``PgConnection`` wraps a psycopg connection and translates those conventions,
so the same code (and the same unit tests) run on SQLite and Postgres.

Money is integer paise.  Postgres returns ``SUM(bigint)`` as ``Decimal``;
rows convert whole-number Decimals back to ``int`` so money math stays integer.
"""

from __future__ import annotations

import re
from decimal import Decimal
from typing import Any, Iterable, Optional, Sequence

PG_PREFIXES = ("postgres://", "postgresql://")

AUDIT_GUARD_SQL = """
CREATE OR REPLACE FUNCTION audit_log_append_only() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'audit_log is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_log_no_change ON audit_log;
CREATE TRIGGER audit_log_no_change
    BEFORE UPDATE OR DELETE ON audit_log
    FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();
"""

_schema_ready: set[str] = set()


def is_postgres_url(target: str | None) -> bool:
    return bool(target) and str(target).startswith(PG_PREFIXES)


# ---------------------------------------------------------------------------
# Schema translation
# ---------------------------------------------------------------------------

def translate_schema(sqlite_ddl: str) -> str:
    """Turn the SQLite DDL in ledger/db.py into Postgres DDL."""
    ddl = re.sub(r"\bINTEGER\b", "BIGINT", sqlite_ddl)
    ddl = re.sub(r"BIGINT\s+PRIMARY\s+KEY\s+AUTOINCREMENT", "BIGSERIAL PRIMARY KEY", ddl)
    # float4 would turn 0.95 into 0.949999988 and flip threshold checks
    ddl = re.sub(r"\bREAL\b", "DOUBLE PRECISION", ddl)
    return ddl


# ---------------------------------------------------------------------------
# Statement translation
# ---------------------------------------------------------------------------

_INSERT_OR_RE = re.compile(
    r"^\s*INSERT\s+OR\s+(REPLACE|IGNORE)\s+INTO\s+(\w+)\s*\(([^)]*)\)(.*)$",
    re.IGNORECASE | re.DOTALL,
)


def translate_sql(sql: str, has_params: bool) -> str:
    """Translate one SQLite statement to Postgres."""
    m = _INSERT_OR_RE.match(sql)
    if m:
        mode, table, cols, rest = m.groups()
        col_list = [c.strip() for c in cols.split(",")]
        if mode.upper() == "IGNORE":
            sql = f"INSERT INTO {table} ({cols}){rest} ON CONFLICT DO NOTHING"
        else:
            updates = ", ".join(f"{c} = EXCLUDED.{c}" for c in col_list if c != "id")
            sql = f"INSERT INTO {table} ({cols}){rest} ON CONFLICT (id) DO UPDATE SET {updates}"
    # SQLite LIKE is case-insensitive for ASCII; keep that behaviour.
    sql = re.sub(r"\bLIKE\b", "ILIKE", sql)
    if has_params:
        sql = _convert_placeholders(sql)
    return sql


def _convert_placeholders(sql: str) -> str:
    """``?`` -> ``%s`` and literal ``%`` -> ``%%``, skipping quoted strings."""
    out = []
    in_quote = False
    for ch in sql:
        if ch == "'":
            in_quote = not in_quote
            out.append(ch)
        elif ch == "%":
            out.append("%%")
        elif ch == "?" and not in_quote:
            out.append("%s")
        else:
            out.append(ch)
    return "".join(out)


# ---------------------------------------------------------------------------
# Rows and cursors
# ---------------------------------------------------------------------------

def _clean(value: Any) -> Any:
    if isinstance(value, Decimal):
        return int(value) if value == value.to_integral_value() else float(value)
    return value


class Row:
    """Behaves like ``sqlite3.Row``: index or key access, ``dict(row)`` works."""

    __slots__ = ("_keys", "_values", "_index")

    def __init__(self, keys: Sequence[str], values: Sequence[Any]):
        self._keys = tuple(keys)
        self._values = tuple(_clean(v) for v in values)
        self._index = {k: i for i, k in enumerate(self._keys)}

    def keys(self):
        return list(self._keys)

    def __getitem__(self, key):
        if isinstance(key, (int, slice)):
            return self._values[key]
        return self._values[self._index[key]]

    def __iter__(self):
        return iter(self._values)

    def __len__(self):
        return len(self._values)

    def __eq__(self, other):
        if isinstance(other, Row):
            return self._values == other._values
        if isinstance(other, tuple):
            return self._values == other
        return NotImplemented

    def __repr__(self):
        return f"Row({dict(zip(self._keys, self._values))!r})"


class Cursor:
    def __init__(self, cur):
        self._cur = cur
        self._keys = [d.name for d in cur.description] if cur.description else []

    @property
    def rowcount(self) -> int:
        return self._cur.rowcount

    def fetchone(self) -> Optional[Row]:
        r = self._cur.fetchone()
        return Row(self._keys, r) if r is not None else None

    def fetchall(self) -> list[Row]:
        return [Row(self._keys, r) for r in self._cur.fetchall()]

    def __iter__(self):
        for r in self._cur:
            yield Row(self._keys, r)


class PgConnection:
    """sqlite3.Connection look-alike over a psycopg connection."""

    def __init__(self, raw, on_close=None):
        self.raw = raw
        self._on_close = on_close
        self.row_factory = None  # accepted and ignored, for sqlite3 parity

    def execute(self, sql: str, params: Iterable[Any] | None = None) -> Cursor:
        params = tuple(params) if params is not None else ()
        cur = self.raw.cursor()
        cur.execute(translate_sql(sql, bool(params)), params or None)
        return Cursor(cur)

    def executescript(self, script: str) -> None:
        with self.raw.cursor() as cur:
            cur.execute(script)

    def commit(self) -> None:
        self.raw.commit()

    def rollback(self) -> None:
        self.raw.rollback()

    def close(self) -> None:
        if self._on_close:
            self._on_close(self.raw)
        else:
            self.raw.close()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        if exc_type:
            self.rollback()
        else:
            self.commit()


def ensure_schema(conn: PgConnection, sqlite_ddl: str) -> None:
    conn.executescript(translate_schema(sqlite_ddl))
    conn.executescript(AUDIT_GUARD_SQL)
    conn.commit()


def connect(url: str, sqlite_ddl: str) -> PgConnection:
    import psycopg

    conn = PgConnection(psycopg.connect(url))
    if url not in _schema_ready:
        ensure_schema(conn, sqlite_ddl)
        _schema_ready.add(url)
    return conn


def reset_schema(url: str, sqlite_ddl: str) -> PgConnection:
    """Drop every table and recreate the schema. Tests and seeding only."""
    import psycopg

    conn = PgConnection(psycopg.connect(url))
    conn.executescript("DROP SCHEMA public CASCADE; CREATE SCHEMA public;")
    ensure_schema(conn, sqlite_ddl)
    _schema_ready.add(url)
    return conn


def audit_guard_installed(conn: PgConnection) -> bool:
    row = conn.execute(
        "SELECT 1 FROM pg_trigger WHERE tgname = 'audit_log_no_change' AND NOT tgisinternal"
    ).fetchone()
    return row is not None
