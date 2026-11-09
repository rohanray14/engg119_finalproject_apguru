"""Three-way reconciliation: payment ↔ gateway ↔ bank statement.

For each gateway payment, verifies the settlement chain:
1. Payment amount paid by the customer
2. Gateway fee + GST on fee deducted
3. Net amount should arrive in bank (amount_in_bank_paise)
4. Bank statement should have a matching credit

Reconciliation statuses:
- matched: all three agree within tolerance
- gateway_mismatch: computed gateway deductions don't match recorded
- bank_missing: no bank statement entry found
- bank_mismatch: bank amount differs from expected
- bank_only: bank entry with no matching payment
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass, field
from datetime import date

from ledger.money import gateway_fee_with_gst, fx_convert


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------

@dataclass
class SettlementLine:
    """One payment's settlement breakdown."""
    payment_id: int
    date: str
    method: str
    currency: str
    amount_paid_paise: int
    gateway_fee_paise: int
    gst_on_fee_paise: int
    fx_diff_paise: int
    amount_in_bank_paise: int  # recorded
    expected_bank_paise: int   # computed from fees
    bank_stmt_id: int | None = None
    bank_credit_paise: int = 0
    status: str = "unverified"
    discrepancy_paise: int = 0


@dataclass
class ReconciliationSummary:
    """Aggregate reconciliation results."""
    total_payments: int = 0
    matched: int = 0
    gateway_mismatch: int = 0
    bank_missing: int = 0
    bank_mismatch: int = 0
    bank_only: int = 0
    total_discrepancy_paise: int = 0
    lines: list[SettlementLine] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Core reconciliation
# ---------------------------------------------------------------------------

TOLERANCE_PAISE = 100  # Allow ±₹1 rounding tolerance


def reconcile(conn: sqlite3.Connection) -> ReconciliationSummary:
    """Run three-way reconciliation on all gateway payments."""
    summary = ReconciliationSummary()

    # Get all payments with gateway fees
    payments = conn.execute("""
        SELECT id, date, method, currency, amount_paid_paise,
               gateway_fee_paise, gst_on_fee_paise, fx_diff_paise,
               amount_in_bank_paise, confirmation, source
        FROM payment_in
        WHERE source IN ('gateway', 'bank')
        ORDER BY date, id
    """).fetchall()

    # Get all bank statement credits
    bank_stmts = conn.execute("""
        SELECT id, date, narration, credit_paise, payment_id
        FROM bank_statement
        WHERE credit_paise > 0
        ORDER BY date, id
    """).fetchall()

    # Build bank lookup by amount for matching
    unmatched_bank = list(bank_stmts)

    for pay in payments:
        summary.total_payments += 1

        # Step 1: Verify gateway fee computation
        expected_fee, expected_gst, expected_total = _compute_expected_fees(
            pay["amount_paid_paise"], pay["method"],
        )
        expected_bank = pay["amount_paid_paise"] - expected_total

        # Handle FX: if foreign currency, convert to INR for bank amount
        if pay["currency"] != "INR":
            expected_bank = fx_convert(expected_bank, pay["currency"], "INR")

        line = SettlementLine(
            payment_id=pay["id"],
            date=pay["date"] or "",
            method=pay["method"] or "",
            currency=pay["currency"],
            amount_paid_paise=pay["amount_paid_paise"],
            gateway_fee_paise=pay["gateway_fee_paise"],
            gst_on_fee_paise=pay["gst_on_fee_paise"],
            fx_diff_paise=pay["fx_diff_paise"],
            amount_in_bank_paise=pay["amount_in_bank_paise"] or 0,
            expected_bank_paise=expected_bank,
        )

        # Step 2: Check gateway fee accuracy
        fee_diff = abs(pay["gateway_fee_paise"] - expected_fee)
        gst_diff = abs(pay["gst_on_fee_paise"] - expected_gst)
        if fee_diff > TOLERANCE_PAISE or gst_diff > TOLERANCE_PAISE:
            line.status = "gateway_mismatch"
            line.discrepancy_paise = fee_diff + gst_diff
            summary.gateway_mismatch += 1
            summary.lines.append(line)
            continue

        # Step 3: Find matching bank statement entry
        recorded_bank = pay["amount_in_bank_paise"] or 0
        matched_stmt = _find_bank_match(
            recorded_bank, pay["date"], unmatched_bank,
        )

        if matched_stmt is None:
            line.status = "bank_missing"
            summary.bank_missing += 1
        else:
            line.bank_stmt_id = matched_stmt["id"]
            line.bank_credit_paise = matched_stmt["credit_paise"]
            unmatched_bank = [b for b in unmatched_bank if b["id"] != matched_stmt["id"]]

            bank_diff = abs(recorded_bank - matched_stmt["credit_paise"])
            if bank_diff <= TOLERANCE_PAISE:
                line.status = "matched"
                summary.matched += 1
            else:
                line.status = "bank_mismatch"
                line.discrepancy_paise = bank_diff
                summary.bank_mismatch += 1

        summary.total_discrepancy_paise += line.discrepancy_paise
        summary.lines.append(line)

    # Count unmatched bank entries
    summary.bank_only = len(unmatched_bank)

    return summary


def gateway_settlement_breakdown(conn: sqlite3.Connection) -> list[dict]:
    """Compute per-gateway settlement summary."""
    rows = conn.execute("""
        SELECT method,
               COUNT(*) as count,
               SUM(amount_paid_paise) as total_paid,
               SUM(gateway_fee_paise) as total_fees,
               SUM(gst_on_fee_paise) as total_gst_on_fees,
               SUM(amount_in_bank_paise) as total_in_bank
        FROM payment_in
        WHERE source IN ('gateway', 'bank')
        AND method IS NOT NULL
        GROUP BY method
        ORDER BY total_paid DESC
    """).fetchall()

    result = []
    for r in rows:
        total_deductions = (r["total_fees"] or 0) + (r["total_gst_on_fees"] or 0)
        expected_net = (r["total_paid"] or 0) - total_deductions
        actual_net = r["total_in_bank"] or 0
        result.append({
            "method": r["method"],
            "count": r["count"],
            "total_paid_paise": r["total_paid"] or 0,
            "total_fees_paise": r["total_fees"] or 0,
            "total_gst_on_fees_paise": r["total_gst_on_fees"] or 0,
            "total_deductions_paise": total_deductions,
            "expected_net_paise": expected_net,
            "actual_net_paise": actual_net,
            "discrepancy_paise": actual_net - expected_net,
        })
    return result


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# Method → gateway key mapping
_METHOD_TO_GW = {
    "payglocal": "payglocal_international",
    "stripe": "stripe",
    "razorpay": "razorpay",
    "neft": "bank_transfer",
    "upi": "bank_transfer",
    "imps": "bank_transfer",
}


def _compute_expected_fees(
    amount_paise: int, method: str | None,
) -> tuple[int, int, int]:
    """Compute expected (fee, gst_on_fee, total_deduction) for a payment method."""
    if not method:
        return (0, 0, 0)

    gw_key = _METHOD_TO_GW.get(method.lower())
    if gw_key is None:
        return (0, 0, 0)

    try:
        return gateway_fee_with_gst(amount_paise, gw_key)
    except KeyError:
        return (0, 0, 0)


def _find_bank_match(
    expected_paise: int,
    payment_date: str | None,
    bank_entries: list,
    tolerance: int = TOLERANCE_PAISE,
    date_window: int = 7,
) -> dict | None:
    """Find the best matching bank statement entry for an expected amount.

    Matches by amount (within tolerance) and date (within date_window days).
    Returns the best match or None.
    """
    if expected_paise <= 0:
        return None

    best = None
    best_date_diff = 999

    for entry in bank_entries:
        if abs(entry["credit_paise"] - expected_paise) > tolerance:
            continue

        # Date proximity
        if payment_date and entry["date"]:
            try:
                pay_d = date.fromisoformat(payment_date)
                bank_d = date.fromisoformat(entry["date"])
                diff = abs((bank_d - pay_d).days)
                if diff > date_window:
                    continue
                if diff < best_date_diff:
                    best = entry
                    best_date_diff = diff
            except (ValueError, TypeError):
                if best is None:
                    best = entry
        elif best is None:
            best = entry

    return dict(best) if best else None
