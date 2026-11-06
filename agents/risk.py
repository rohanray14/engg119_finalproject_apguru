"""Risk agent — flags suspicious patterns in the ledger.

Input: full ledger data
Output: list of RiskFlag objects with severity and explanation

Planted problems to detect:
- Unconfirmed large payments (screenshot_only above threshold)
- Duplicate payments (same amount + payer + date)
- Payments with suspicious payer text ("new account", "refund", etc.)
- Long-overdue installments
- Mismatched currency payments
- Payments much larger than any installment
- Unmatched payments older than N days
"""

from __future__ import annotations

import json
import sqlite3
from collections import Counter
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Optional


@dataclass
class RiskFlag:
    severity: str        # "high", "medium", "low"
    category: str        # e.g. "duplicate_payment", "unconfirmed_large", etc.
    entity: str          # e.g. "payment:123" or "installment:456"
    explanation: str
    amount_paise: int = 0
    currency: str = "INR"


# Thresholds
LARGE_PAYMENT_PAISE = 500_000_00  # ₹5,00,000
OVERDUE_DAYS = 30
UNMATCHED_DAYS = 14
SUSPICIOUS_KEYWORDS = ["new account", "refund", "reversal", "chargeback",
                       "cancel", "dispute", "urgent"]


def scan_risks(conn: sqlite3.Connection, as_of: date | None = None) -> list[RiskFlag]:
    """Scan the entire ledger for risk flags."""
    if as_of is None:
        as_of = date.today()

    flags: list[RiskFlag] = []
    flags.extend(_check_unconfirmed_large(conn))
    flags.extend(_check_duplicate_payments(conn))
    flags.extend(_check_suspicious_payers(conn))
    flags.extend(_check_overdue_installments(conn, as_of))
    flags.extend(_check_unmatched_old(conn, as_of))
    flags.extend(_check_oversized_payments(conn))

    # Sort by severity
    severity_order = {"high": 0, "medium": 1, "low": 2}
    flags.sort(key=lambda f: severity_order.get(f.severity, 3))

    return flags


def _check_unconfirmed_large(conn: sqlite3.Connection) -> list[RiskFlag]:
    """Flag large payments that are only screenshot-confirmed."""
    rows = conn.execute(
        "SELECT id, amount_paid_paise, currency, payer_name, date "
        "FROM payment_in "
        "WHERE confirmation = 'screenshot_only' AND amount_paid_paise >= ?",
        (LARGE_PAYMENT_PAISE,),
    ).fetchall()
    flags = []
    for r in rows:
        flags.append(RiskFlag(
            severity="high",
            category="unconfirmed_large",
            entity=f"payment:{r['id']}",
            explanation=(
                f"Large payment of {r['amount_paid_paise']/100:,.0f} {r['currency']} "
                f"from {r['payer_name'] or '(blank)'} on {r['date'] or 'unknown'} "
                f"is only screenshot-confirmed."
            ),
            amount_paise=r["amount_paid_paise"],
            currency=r["currency"],
        ))
    return flags


def _check_duplicate_payments(conn: sqlite3.Connection) -> list[RiskFlag]:
    """Flag payments that look like duplicates (same amount + payer + date)."""
    rows = conn.execute(
        "SELECT id, amount_paid_paise, currency, payer_name, date "
        "FROM payment_in "
        "WHERE payer_name IS NOT NULL AND payer_name != '' "
        "ORDER BY payer_name, date, amount_paid_paise"
    ).fetchall()

    seen: dict[tuple, list[int]] = {}
    for r in rows:
        key = (r["amount_paid_paise"], r["currency"],
               (r["payer_name"] or "").lower(), r["date"])
        seen.setdefault(key, []).append(r["id"])

    flags = []
    for key, ids in seen.items():
        if len(ids) > 1:
            amount, currency, payer, pay_date = key
            flags.append(RiskFlag(
                severity="high",
                category="duplicate_payment",
                entity=f"payments:{','.join(str(i) for i in ids)}",
                explanation=(
                    f"Possible duplicate: {len(ids)} payments of "
                    f"{amount/100:,.0f} {currency} from '{payer}' on {pay_date}."
                ),
                amount_paise=amount,
                currency=currency,
            ))
    return flags


def _check_suspicious_payers(conn: sqlite3.Connection) -> list[RiskFlag]:
    """Flag payments with suspicious keywords in payer name."""
    rows = conn.execute(
        "SELECT id, amount_paid_paise, currency, payer_name "
        "FROM payment_in WHERE payer_name IS NOT NULL"
    ).fetchall()
    flags = []
    for r in rows:
        payer = (r["payer_name"] or "").lower()
        for kw in SUSPICIOUS_KEYWORDS:
            if kw in payer:
                flags.append(RiskFlag(
                    severity="high",
                    category="suspicious_payer",
                    entity=f"payment:{r['id']}",
                    explanation=(
                        f"Suspicious payer text '{r['payer_name']}' "
                        f"contains keyword '{kw}'."
                    ),
                    amount_paise=r["amount_paid_paise"],
                    currency=r["currency"],
                ))
                break
    return flags


def _check_overdue_installments(
    conn: sqlite3.Connection, as_of: date,
) -> list[RiskFlag]:
    """Flag installments that are significantly overdue."""
    rows = conn.execute(
        "SELECT i.id, i.due_date, i.amount_due_paise, i.currency, "
        "s.name as student_name "
        "FROM installment i "
        "JOIN enrollment e ON i.enrollment_id = e.id "
        "JOIN student s ON e.student_id = s.id "
        "WHERE i.status IN ('open', 'overdue') AND i.due_date IS NOT NULL"
    ).fetchall()

    flags = []
    for r in rows:
        try:
            due = date.fromisoformat(r["due_date"])
        except (ValueError, TypeError):
            continue
        days_overdue = (as_of - due).days
        if days_overdue > OVERDUE_DAYS:
            severity = "high" if days_overdue > 90 else "medium"
            flags.append(RiskFlag(
                severity=severity,
                category="overdue_installment",
                entity=f"installment:{r['id']}",
                explanation=(
                    f"{r['student_name']}'s installment of "
                    f"{r['amount_due_paise']/100:,.0f} {r['currency']} "
                    f"is {days_overdue} days overdue (due {r['due_date']})."
                ),
                amount_paise=r["amount_due_paise"],
                currency=r["currency"],
            ))
    return flags


def _check_unmatched_old(conn: sqlite3.Connection, as_of: date) -> list[RiskFlag]:
    """Flag old payments that haven't been matched."""
    matched_ids = set()
    rows = conn.execute(
        "SELECT payment_id FROM match_result WHERE status IN ('auto','approved')"
    ).fetchall()
    for r in rows:
        matched_ids.add(r["payment_id"])

    payments = conn.execute(
        "SELECT id, date, amount_paid_paise, currency, payer_name "
        "FROM payment_in WHERE date IS NOT NULL"
    ).fetchall()

    flags = []
    for p in payments:
        if p["id"] in matched_ids:
            continue
        try:
            pay_date = date.fromisoformat(p["date"])
        except (ValueError, TypeError):
            continue
        days_old = (as_of - pay_date).days
        if days_old > UNMATCHED_DAYS:
            flags.append(RiskFlag(
                severity="medium",
                category="unmatched_old",
                entity=f"payment:{p['id']}",
                explanation=(
                    f"Payment of {p['amount_paid_paise']/100:,.0f} {p['currency']} "
                    f"from {p['payer_name'] or '(blank)'} on {p['date']} "
                    f"({days_old} days ago) is still unmatched."
                ),
                amount_paise=p["amount_paid_paise"],
                currency=p["currency"],
            ))
    return flags


def _check_oversized_payments(conn: sqlite3.Connection) -> list[RiskFlag]:
    """Flag payments much larger than any installment amount."""
    max_inst = conn.execute(
        "SELECT MAX(amount_due_paise) FROM installment"
    ).fetchone()[0] or 0

    if max_inst == 0:
        return []

    threshold = max_inst * 3  # 3x the largest installment

    rows = conn.execute(
        "SELECT id, amount_paid_paise, currency, payer_name "
        "FROM payment_in WHERE amount_paid_paise > ?",
        (threshold,),
    ).fetchall()

    flags = []
    for r in rows:
        flags.append(RiskFlag(
            severity="medium",
            category="oversized_payment",
            entity=f"payment:{r['id']}",
            explanation=(
                f"Payment of {r['amount_paid_paise']/100:,.0f} {r['currency']} "
                f"from {r['payer_name'] or '(blank)'} is {r['amount_paid_paise']/max_inst:.1f}x "
                f"the largest installment."
            ),
            amount_paise=r["amount_paid_paise"],
            currency=r["currency"],
        ))
    return flags
