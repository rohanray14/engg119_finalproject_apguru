"""Tests for the risk agent."""

import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

import json
from datetime import date
from ledger.db import get_connection
from agents.risk import scan_risks, RiskFlag, SUSPICIOUS_KEYWORDS


def _make_test_db():
    """Create a minimal test database with planted problems."""
    conn = get_connection(":memory:")

    # Students
    conn.execute(
        "INSERT INTO student (id, name, city, country) VALUES (1, 'Test Student', 'Mumbai', 'India')"
    )
    conn.execute(
        "INSERT INTO student (id, name, city, country) VALUES (2, 'Other Student', 'Delhi', 'India')"
    )

    # Enrollments
    conn.execute(
        "INSERT INTO enrollment (id, student_id, program, fee_model, total_fee_paise, currency) "
        "VALUES (1, 1, 'SAT', 'package', 17700000, 'INR')"
    )

    # Installments — one overdue
    conn.execute(
        "INSERT INTO installment (id, enrollment_id, due_date, amount_due_paise, currency, status) "
        "VALUES (1, 1, '2025-01-15', 8850000, 'INR', 'overdue')"
    )

    # Payments
    # Normal payment
    conn.execute(
        "INSERT INTO payment_in (id, source, payer_name, date, amount_paid_paise, currency, confirmation) "
        "VALUES (1, 'bank', 'Parent Name', '2025-06-01', 8850000, 'INR', 'in_bank')"
    )
    # Large unconfirmed
    conn.execute(
        "INSERT INTO payment_in (id, source, payer_name, date, amount_paid_paise, currency, confirmation) "
        "VALUES (2, 'screenshot', 'Big Payer', '2025-06-01', 90000000, 'INR', 'screenshot_only')"
    )
    # Duplicate payments
    conn.execute(
        "INSERT INTO payment_in (id, source, payer_name, date, amount_paid_paise, currency, confirmation) "
        "VALUES (3, 'bank', 'Dupe Payer', '2025-06-10', 5000000, 'INR', 'in_bank')"
    )
    conn.execute(
        "INSERT INTO payment_in (id, source, payer_name, date, amount_paid_paise, currency, confirmation) "
        "VALUES (4, 'bank', 'Dupe Payer', '2025-06-10', 5000000, 'INR', 'in_bank')"
    )
    # Suspicious payer
    conn.execute(
        "INSERT INTO payment_in (id, source, payer_name, date, amount_paid_paise, currency, confirmation) "
        "VALUES (5, 'bank', 'Please pay to new account', '2025-06-01', 1000000, 'INR', 'screenshot_only')"
    )

    conn.commit()
    return conn


class TestRiskScan:
    def test_detects_unconfirmed_large(self):
        conn = _make_test_db()
        flags = scan_risks(conn, as_of=date(2025, 7, 1))
        cats = [f.category for f in flags]
        assert "unconfirmed_large" in cats
        conn.close()

    def test_detects_duplicates(self):
        conn = _make_test_db()
        flags = scan_risks(conn, as_of=date(2025, 7, 1))
        cats = [f.category for f in flags]
        assert "duplicate_payment" in cats
        conn.close()

    def test_detects_suspicious_payer(self):
        conn = _make_test_db()
        flags = scan_risks(conn, as_of=date(2025, 7, 1))
        cats = [f.category for f in flags]
        assert "suspicious_payer" in cats
        conn.close()

    def test_detects_overdue(self):
        conn = _make_test_db()
        flags = scan_risks(conn, as_of=date(2025, 7, 1))
        cats = [f.category for f in flags]
        assert "overdue_installment" in cats
        conn.close()

    def test_detects_unmatched_old(self):
        conn = _make_test_db()
        flags = scan_risks(conn, as_of=date(2025, 7, 1))
        cats = [f.category for f in flags]
        assert "unmatched_old" in cats
        conn.close()

    def test_severity_ordering(self):
        conn = _make_test_db()
        flags = scan_risks(conn, as_of=date(2025, 7, 1))
        severities = [f.severity for f in flags]
        # High should come before medium, medium before low
        seen_medium = False
        seen_low = False
        for s in severities:
            if s == "medium":
                seen_medium = True
            if s == "low":
                seen_low = True
            if s == "high" and (seen_medium or seen_low):
                assert False, "High severity after medium/low"
        conn.close()

    def test_flag_has_required_fields(self):
        conn = _make_test_db()
        flags = scan_risks(conn, as_of=date(2025, 7, 1))
        for f in flags:
            assert f.severity in ("high", "medium", "low")
            assert f.category
            assert f.entity
            assert f.explanation
        conn.close()

    def test_empty_db_no_flags(self):
        conn = get_connection(":memory:")
        flags = scan_risks(conn, as_of=date(2025, 7, 1))
        assert flags == []
        conn.close()


class TestSuspiciousKeywords:
    def test_keywords_defined(self):
        assert "new account" in SUSPICIOUS_KEYWORDS
        assert "refund" in SUSPICIOUS_KEYWORDS
        assert "chargeback" in SUSPICIOUS_KEYWORDS
