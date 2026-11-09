"""Per-request database connections.

Postgres connections come from a small pool (Neon closes idle connections and
Cloud Run scales to zero, so the pool starts empty and checks connections
before handing them out).  SQLite opens a fresh connection per request.

Each request runs in one transaction: committed by the route on success,
rolled back automatically if anything raises.
"""

from __future__ import annotations

import threading
from typing import Iterator

from api.settings import get_settings
from ledger import pg
from ledger.db import SCHEMA_SQL, set_meta

_pool = None
_pool_lock = threading.Lock()


def _get_pool():
    global _pool
    if _pool is not None:
        return _pool
    with _pool_lock:  # concurrent first requests must not each build a pool
        if _pool is not None:
            return _pool
        from psycopg_pool import ConnectionPool

        url = get_settings().database_url
        # Create tables / audit trigger once per process.
        boot = pg.connect(url, SCHEMA_SQL)
        if get_settings().is_production:
            # Stamp the database so seed/--reset refuse to touch it.
            set_meta(boot, "environment", "production")
            boot.commit()
        boot.close()
        _pool = ConnectionPool(
            url,
            min_size=0,
            max_size=10,
            timeout=10,
            check=ConnectionPool.check_connection,
            open=True,
        )
    return _pool


def close_pool() -> None:
    global _pool
    if _pool is not None:
        _pool.close()
        _pool = None


def _sqlite_connect(path: str):
    """SQLite for local dev/tests. FastAPI may open and use the connection on
    different worker threads, hence check_same_thread=False (one request at a
    time uses each connection)."""
    import sqlite3

    conn = sqlite3.connect(path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    conn.executescript(SCHEMA_SQL)
    return conn


def get_conn() -> Iterator:
    """FastAPI dependency yielding a sqlite3-style connection."""
    url = get_settings().database_url
    if pg.is_postgres_url(url):
        pool = _get_pool()
        raw = pool.getconn()
        conn = pg.PgConnection(raw, on_close=pool.putconn)
    else:
        conn = _sqlite_connect(url)
    try:
        yield conn
    except Exception:
        conn.rollback()
        raise
    finally:
        try:
            conn.rollback()  # discard anything the route didn't commit
        finally:
            conn.close()
