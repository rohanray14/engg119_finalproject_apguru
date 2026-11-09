"""Create or update the database schema.  Run as the database OWNER.

    python -m api.migrate --environment production   # once, before first deploy,
                                                       # and after schema changes
The API itself connects as a restricted role in production and only checks
that this has been done (it refuses to start otherwise).

``--environment production`` also marks the database as production, so the
demo seeder and ``--reset`` refuse to touch it from then on.  The marker can't
be removed with this command.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from ledger import pg  # noqa: E402
from ledger.db import SCHEMA_SQL, get_connection, get_meta, set_meta  # noqa: E402


def migrate(database_url: str, environment: str | None = None) -> list[str]:
    conn = get_connection(database_url)  # creates tables / columns / triggers
    try:
        current = get_meta(conn, "environment")
        if current == "production" and environment and environment != "production":
            raise SystemExit("This database is marked production; it can't be re-marked.")
        if environment:
            set_meta(conn, "environment", environment)
            conn.commit()
        problems = pg.check_production_ready(conn, SCHEMA_SQL) if (
            pg.is_postgres_url(database_url) and (environment or current) == "production") else []
    finally:
        conn.close()
    return problems


def main(argv=None) -> None:
    from ledger.db import DATABASE_URL

    p = argparse.ArgumentParser(description="Create or update the ledger schema (run as owner).")
    p.add_argument("--database-url", default=None)
    p.add_argument("--environment", choices=["production", "staging", "demo"], default=None,
                   help="mark the database; 'production' blocks seeding and --reset")
    args = p.parse_args(argv)
    problems = migrate(args.database_url or DATABASE_URL, args.environment)
    if problems:
        raise SystemExit("Migration ran but the database is not production-ready: " + "; ".join(problems))
    print("Schema is up to date.")


if __name__ == "__main__":
    main()
