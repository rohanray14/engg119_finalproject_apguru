"""Load the fake demo data into a database, once.

The Streamlit prototype deleted and rebuilt its database on every start, so
approvals vanished on each redeploy.  The API never does that: the database
persists, and this command is run explicitly to fill an empty one.

    python -m api.seed                 # fill an empty database with fake data
    python -m api.seed --reset         # wipe and refill (refused in production)

Fake data only (CLAUDE.md rule 6).  Real data will come through an ingestion
step built later, never through this script.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from config import CONFIG  # noqa: E402
from ledger import pg  # noqa: E402
from ledger.db import SCHEMA_SQL, get_connection, log_audit  # noqa: E402
from ledger.load import load_all  # noqa: E402


def run_matching(conn) -> dict:
    """Run the rules matcher and store results. Auto-approve only at or above
    the configured threshold; everything else waits for a person."""
    from agents.matching_rules import match_all

    threshold = CONFIG.matching.auto_match_threshold
    counts = {"auto": 0, "pending_review": 0}
    for pred in match_all(conn):
        if pred.confidence <= 0:
            continue
        if pred.installment_ids:
            allocs = json.dumps(
                [{"installment_id": iid, "allocated_paise": 0} for iid in pred.installment_ids]
            )
            status = "auto" if pred.confidence >= threshold else "pending_review"
        else:
            allocs, status = "[]", "pending_review"
        conn.execute(
            "INSERT INTO match_result (payment_id, allocations, method, confidence, reason, status) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (pred.payment_id, allocs, pred.method, pred.confidence, pred.reason or "", status),
        )
        counts[status] += 1
    conn.commit()
    return counts


def recompute_commissions(conn) -> int:
    """Rebuild commission lines from auto/approved matches (code does the math)."""
    from agents.commissions import compute_commissions

    conn.execute("DELETE FROM commission_line")
    calcs = compute_commissions(conn, commit=False)
    for c in calcs:
        conn.execute(
            "INSERT INTO commission_line "
            "(counselor_id, payment_id, base_paise, rate, commission_paise, "
            "refund_deduction_paise, tds_paise, net_paise) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (c.counselor_id, c.payment_id, c.base_paise, c.rate,
             c.commission_paise, c.refund_deduction_paise, c.tds_paise, c.net_paise),
        )
    return len(calcs)


def seed(database_url: str, reset: bool = False, data_dir: Path | None = None) -> dict:
    data_dir = data_dir or PROJECT_ROOT / "data"
    if reset and pg.is_postgres_url(database_url):
        pg.reset_schema(database_url, SCHEMA_SQL).close()
    elif reset and Path(database_url).exists():
        Path(database_url).unlink()

    conn = get_connection(database_url)
    existing = conn.execute("SELECT COUNT(*) FROM payment_in").fetchone()[0]
    conn.close()
    if existing:
        raise SystemExit(
            f"Database already has {existing} payments; refusing to load demo data on top. "
            "Use --reset to wipe it (never in production)."
        )

    conn = load_all(data_dir=data_dir, db_path=database_url)
    counts = run_matching(conn)
    n_comm = recompute_commissions(conn)
    log_audit(conn, "system:seed", "load_demo_data", "ledger", None,
              json.dumps({**counts, "commission_lines": n_comm}), commit=False)
    conn.commit()
    conn.close()
    return {**counts, "commission_lines": n_comm}


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--reset", action="store_true", help="wipe the database first")
    parser.add_argument("--database-url", default=None)
    args = parser.parse_args(argv)

    from ledger.db import DATABASE_URL

    url = args.database_url or DATABASE_URL
    if args.reset and os.environ.get("ENV") == "production":
        raise SystemExit("--reset is refused when ENV=production.")
    result = seed(url, reset=args.reset)
    print(f"Seeded demo data: {result}")


if __name__ == "__main__":
    main()
