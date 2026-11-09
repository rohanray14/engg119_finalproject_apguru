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
from ledger.db import SCHEMA_SQL, decision_lock, get_connection, get_meta, log_audit, set_meta  # noqa: E402
from ledger.load import load_all  # noqa: E402


def run_matching(conn) -> dict:
    """Run the rules matcher and store results. Auto-approve only at or above
    the configured threshold; everything else waits for a person.

    Auto matches are allocated with the same deterministic code as manual
    approvals, so installment statuses reflect what was actually received.
    """
    from agents.matching_rules import match_all
    from api.allocation import AllocationError, apply_status_changes, plan_allocation

    threshold = CONFIG.matching.auto_match_threshold
    counts = {"auto": 0, "pending_review": 0}
    for pred in match_all(conn):
        if pred.confidence <= 0:
            continue
        status = "pending_review"
        allocs = json.dumps(
            [{"installment_id": iid, "allocated_paise": 0} for iid in pred.installment_ids]
        ) if pred.installment_ids else "[]"
        plan = None
        if pred.installment_ids and pred.confidence >= threshold:
            pay = conn.execute("SELECT amount_paid_paise, currency FROM payment_in WHERE id = ?",
                               (pred.payment_id,)).fetchone()
            try:
                plan = plan_allocation(conn, pay["amount_paid_paise"], pay["currency"],
                                       list(pred.installment_ids))
                allocs, status = json.dumps(plan.allocations), "auto"
            except AllocationError:
                plan = None  # can't apply cleanly: a person decides
        conn.execute(
            "INSERT INTO match_result (payment_id, allocations, method, confidence, reason, status) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (pred.payment_id, allocs, pred.method, pred.confidence, pred.reason or "", status),
        )
        if plan is not None:
            apply_status_changes(conn, plan, "agent:matching_rules", "auto_match")
        counts[status] += 1
    conn.commit()
    return counts


def _commission_snapshot(conn) -> dict:
    by = {}
    for r in conn.execute(
        "SELECT counselor_id, currency, SUM(net_paise) AS net, COUNT(*) AS n "
        "FROM commission_line GROUP BY counselor_id, currency"
    ).fetchall():
        by[f"{r['counselor_id']}:{r['currency']}"] = {"net_paise": r["net"], "lines": r["n"]}
    return by


def recompute_commissions(conn, actor: str = "system") -> int:
    """Rebuild commission lines from auto/approved matches (code does the math).

    Takes the decision lock first, so overlapping requests can't both rebuild
    and leave two sets of lines.  Logs the before/after totals per counselor
    and currency, and any counselor rule the parser wrote back.
    """
    from agents.commissions import compute_commissions

    decision_lock(conn)
    before = _commission_snapshot(conn)
    rules_before = {r["id"]: r["parsed_rule"] for r in conn.execute("SELECT id, parsed_rule FROM counselor").fetchall()}

    conn.execute("DELETE FROM commission_line")
    calcs = compute_commissions(conn, commit=False)
    for c in calcs:
        conn.execute(
            "INSERT INTO commission_line "
            "(counselor_id, payment_id, base_paise, rate, commission_paise, "
            "refund_deduction_paise, tds_paise, net_paise, currency) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (c.counselor_id, c.payment_id, c.base_paise, c.rate,
             c.commission_paise, c.refund_deduction_paise, c.tds_paise, c.net_paise, c.currency),
        )

    after = _commission_snapshot(conn)
    if after != before:
        log_audit(conn, actor, "rebuild_commissions", "commission_line",
                  json.dumps(before, sort_keys=True), json.dumps(after, sort_keys=True), commit=False)
    for r in conn.execute("SELECT id, parsed_rule FROM counselor").fetchall():
        if r["parsed_rule"] != rules_before.get(r["id"]):
            log_audit(conn, "agent:commissions", "parse_commission_terms", f"counselor:{r['id']}",
                      rules_before.get(r["id"]), r["parsed_rule"], commit=False)
    return len(calcs)


def _refuse_if_production(database_url: str) -> None:
    """The database itself says whether it is production; the operator's shell
    doesn't get a say.  The API stamps the marker when it starts with
    ENV=production."""
    try:
        conn = get_connection(database_url)
    except Exception:
        return  # nothing there yet
    try:
        env = get_meta(conn, "environment")
    finally:
        conn.close()
    if env == "production":
        raise SystemExit("This database is marked as PRODUCTION. Seeding and --reset are refused.")


def seed(database_url: str, reset: bool = False, data_dir: Path | None = None) -> dict:
    data_dir = data_dir or PROJECT_ROOT / "data"
    _refuse_if_production(database_url)
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
    set_meta(conn, "environment", "demo")
    counts = run_matching(conn)
    n_comm = recompute_commissions(conn, actor="system:seed")
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
    if args.reset and pg.is_postgres_url(url):
        target = url.split("@")[-1].split("?")[0]
        typed = input(f"This will DELETE everything in {target}. Type the database host/name to confirm: ")
        if typed.strip() != target:
            raise SystemExit("Not confirmed; nothing changed.")
    result = seed(url, reset=args.reset)
    print(f"Seeded demo data: {result}")


if __name__ == "__main__":
    main()
