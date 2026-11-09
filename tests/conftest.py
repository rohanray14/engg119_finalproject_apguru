"""Shared test setup.

Set ``TEST_POSTGRES_URL`` to run the whole suite against Postgres instead of
SQLite.  Every ``get_connection(":memory:")`` then gets a freshly reset
Postgres schema, which mirrors the isolation of an in-memory SQLite database.

    TEST_POSTGRES_URL=postgresql://postgres@localhost:5432/test pytest
"""

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

PG_URL = os.environ.get("TEST_POSTGRES_URL")

if PG_URL:
    import ledger.db as _db
    from ledger import pg as _pg

    _original = _db.get_connection

    def _get_connection(db_path=None):
        if db_path is None or str(db_path) == ":memory:":
            return _pg.reset_schema(PG_URL, _db.SCHEMA_SQL)
        return _original(db_path)

    # Patch before ledger.load / agents import it by name.
    _db.get_connection = _get_connection
