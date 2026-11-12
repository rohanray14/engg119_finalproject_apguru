"""Add random transactions for each day between the last data date and today.

Run after seeding the base data. Adds a realistic trickle of daily activity:
- 1-4 incoming payments
- 0-2 outgoing payments
- 0-1 new overdue installments marked

Usage:
    python data/add_daily.py          # adds to data/ledger.db
    python data/add_daily.py --db path/to/ledger.db
"""

from __future__ import annotations

import argparse
import json
import random
import sqlite3
from datetime import date, timedelta
from pathlib import Path

METHODS = ["bank_transfer", "razorpay", "payglocal", "stripe", "cash", "screenshot"]
CONFIRMATIONS = ["in_bank", "seen_by_gateway", "screenshot_only"]
EXPENSE_CATEGORIES = ["faculty", "rent", "ads", "software", "tax", "other"]


def get_last_data_date(conn: sqlite3.Connection) -> date:
    """Find the most recent payment date in the DB."""
    row = conn.execute(
        "SELECT MAX(date) FROM payment_in WHERE date IS NOT NULL"
    ).fetchone()
    if row and row[0]:
        return date.fromisoformat(row[0])
    return date.today() - timedelta(days=1)


def get_students(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute("SELECT id, name FROM student").fetchall()
    return [dict(r) for r in rows]


def get_next_id(conn: sqlite3.Connection, table: str) -> int:
    row = conn.execute(f"SELECT COALESCE(MAX(id), 0) + 1 FROM {table}").fetchone()
    return row[0]


def add_day(conn: sqlite3.Connection, day: date, rng: random.Random):
    """Add random activity for a single day."""
    students = get_students(conn)
    if not students:
        return

    iso = day.isoformat()

    # --- Incoming payments ---
    n_payments = rng.randint(1, 4)
    for _ in range(n_payments):
        pid = get_next_id(conn, "payment_in")
        student = rng.choice(students)
        method = rng.choice(METHODS)
        amount_paise = rng.choice([17700_00, 23600_00, 35400_00, 11800_00, 5900_00, 29500_00, 41300_00])
        # Add some randomness to amount
        amount_paise = int(amount_paise * rng.uniform(0.8, 1.2))
        confirmation = rng.choice(CONFIRMATIONS)

        gateway_fee = int(amount_paise * 0.02) if method in ("razorpay", "stripe", "payglocal") else 0
        gst_on_fee = int(gateway_fee * 0.18) if gateway_fee else 0
        in_bank = amount_paise - gateway_fee - gst_on_fee

        conn.execute(
            """INSERT INTO payment_in
               (id, source, method, payer_name, date, amount_paid_paise, currency,
                gateway_fee_paise, gst_on_fee_paise, fx_diff_paise, tds_paise,
                amount_in_bank_paise, confirmation)
               VALUES (?, ?, ?, ?, ?, ?, 'INR', ?, ?, 0, 0, ?, ?)""",
            (pid, "bank" if method == "bank_transfer" else "gateway",
             method, student["name"], iso, amount_paise,
             gateway_fee, gst_on_fee, in_bank, confirmation),
        )

    # --- Outgoing payments ---
    n_out = rng.randint(0, 2)
    for _ in range(n_out):
        poid = get_next_id(conn, "payment_out")
        category = rng.choice(EXPENSE_CATEGORIES)
        payees = {
            "faculty": ["Tutor Payment", "Faculty Salary", "Guest Lecturer"],
            "rent": ["Office Rent", "Co-working Space"],
            "ads": ["Google Ads", "Meta Ads", "LinkedIn Ads"],
            "software": ["AWS", "Notion", "Slack", "Zoom"],
            "tax": ["GST Payment", "TDS Deposit"],
            "other": ["Office Supplies", "Travel", "Courier"],
        }
        payee = rng.choice(payees[category])
        amount = rng.randint(5000_00, 50000_00)

        conn.execute(
            """INSERT INTO payment_out (id, date, payee, category, amount_paise, currency)
               VALUES (?, ?, ?, ?, ?, 'INR')""",
            (poid, iso, payee, category, amount),
        )

    # --- Bank statement entries for today's payments ---
    payments_today = conn.execute(
        "SELECT id, payer_name, amount_in_bank_paise FROM payment_in WHERE date = ?", (iso,)
    ).fetchall()
    for pay in payments_today:
        bsid = get_next_id(conn, "bank_statement")
        conn.execute(
            """INSERT INTO bank_statement (id, date, narration, credit_paise, debit_paise, payment_id)
               VALUES (?, ?, ?, ?, 0, ?)""",
            (bsid, iso, f"NEFT/{pay['payer_name']}", pay["amount_in_bank_paise"], pay["id"]),
        )

    conn.commit()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default="data/ledger.db")
    args = parser.parse_args()

    conn = sqlite3.connect(args.db)
    conn.row_factory = sqlite3.Row

    last_date = get_last_data_date(conn)
    today = date.today()

    if last_date >= today:
        print(f"Data already covers {last_date}, nothing to add.")
        conn.close()
        return

    # Use today's date as seed so same day = same data, but different days = different data
    days_to_add = []
    d = last_date + timedelta(days=1)
    while d <= today:
        days_to_add.append(d)
        d += timedelta(days=1)

    print(f"Adding data for {len(days_to_add)} day(s): {days_to_add[0]} to {days_to_add[-1]}")

    for day in days_to_add:
        # Seed per day so it's deterministic for the same day
        rng = random.Random(day.toordinal())
        add_day(conn, day, rng)
        print(f"  {day}: done")

    conn.close()
    print("Daily data added.")


if __name__ == "__main__":
    main()
