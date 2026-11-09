"""Tests for reconciliation module."""

from pathlib import Path

import pytest

from ledger.db import get_connection
from ledger.reconciliation import (
    reconcile,
    gateway_settlement_breakdown,
    SettlementLine,
)


@pytest.fixture
def conn():
    """Create an in-memory DB with test data."""
    c = get_connection(":memory:")

    # Insert a gateway payment (payglocal, INR)
    # Amount: 1,00,000 paise = ₹1,000
    # Fee: 2.75% of 100000 = 2750 paise
    # GST on fee: 18% of 2750 = 495 paise
    # Net: 100000 - 2750 - 495 = 96755 paise
    c.execute(
        "INSERT INTO payment_in "
        "(id, source, method, payer_name, date, amount_paid_paise, currency, "
        "gateway_fee_paise, gst_on_fee_paise, fx_diff_paise, tds_paise, "
        "amount_in_bank_paise, confirmation) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (1, "gateway", "payglocal", "Test Payer", "2025-05-01",
         100000, "INR", 2750, 495, 0, 0, 96755, "seen_by_gateway"),
    )

    # Insert matching bank statement entry
    c.execute(
        "INSERT INTO bank_statement (date, narration, credit_paise, debit_paise) "
        "VALUES (?, ?, ?, ?)",
        ("2025-05-02", "FX INWARD/PAYGLOCAL/REF123/TEST/FEE", 96755, 0),
    )

    # Insert a second payment with no bank match
    c.execute(
        "INSERT INTO payment_in "
        "(id, source, method, payer_name, date, amount_paid_paise, currency, "
        "gateway_fee_paise, gst_on_fee_paise, fx_diff_paise, tds_paise, "
        "amount_in_bank_paise, confirmation) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (2, "gateway", "stripe", "Test Payer 2", "2025-06-01",
         200000, "INR", 6000, 1080, 0, 0, 192920, "seen_by_gateway"),
    )

    c.commit()
    return c


def test_reconcile_matched(conn):
    summary = reconcile(conn)
    assert summary.total_payments == 2
    assert summary.matched >= 1
    # Payment 1 should be matched
    matched_lines = [l for l in summary.lines if l.status == "matched"]
    assert len(matched_lines) >= 1
    assert matched_lines[0].payment_id == 1


def test_reconcile_bank_missing(conn):
    summary = reconcile(conn)
    # Payment 2 has no bank match
    missing = [l for l in summary.lines if l.status == "bank_missing"]
    assert len(missing) == 1
    assert missing[0].payment_id == 2


def test_gateway_breakdown(conn):
    breakdown = gateway_settlement_breakdown(conn)
    assert len(breakdown) >= 1
    methods = {b["method"] for b in breakdown}
    assert "payglocal" in methods or "stripe" in methods


def test_idempotent_ingestion(conn):
    """Re-inserting the same bank statement should not create duplicates."""
    count_before = conn.execute("SELECT COUNT(*) FROM bank_statement").fetchone()[0]
    conn.execute(
        "INSERT OR IGNORE INTO bank_statement (date, narration, credit_paise, debit_paise) "
        "VALUES (?, ?, ?, ?)",
        ("2025-05-02", "FX INWARD/PAYGLOCAL/REF123/TEST/FEE", 96755, 0),
    )
    conn.commit()
    count_after = conn.execute("SELECT COUNT(*) FROM bank_statement").fetchone()[0]
    assert count_before == count_after
