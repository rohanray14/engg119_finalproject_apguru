"""Tests for ledger/load.py parsers — covering every messy example from SPEC.md."""

import sqlite3
from datetime import date
from pathlib import Path

import pytest

from ledger.load import (
    parse_date,
    parse_amount,
    normalize_name,
    find_duplicate_rows,
    load_all,
)
from ledger.db import get_connection
from ledger.money import add_gst


# ── Date parsing (SPEC: dd/mm/yyyy, dd.mm.yyyy, dd.mm.yy, "16 Sept") ────

class TestParseDate:
    def test_dd_slash_mm_slash_yyyy(self):
        assert parse_date("15/03/2025") == date(2025, 3, 15)

    def test_dd_dot_mm_dot_yyyy(self):
        assert parse_date("15.03.2025") == date(2025, 3, 15)

    def test_dd_dot_mm_dot_yy(self):
        assert parse_date("15.03.25") == date(2025, 3, 15)

    def test_d_month_name(self):
        assert parse_date("16 Sept") == date(2025, 9, 16)

    def test_d_month_name_jan(self):
        assert parse_date("3 Jan") == date(2025, 1, 3)

    def test_iso_date(self):
        assert parse_date("2025-06-01") == date(2025, 6, 1)

    def test_empty_string(self):
        assert parse_date("") is None

    def test_none_input(self):
        assert parse_date(None) is None

    def test_status_string_returns_none(self):
        # Due-date column often holds statuses
        assert parse_date("paid full") is None
        assert parse_date("Paid Hrly") is None

    def test_day_month_order_not_mm_dd(self):
        # "05/03/2025" must be 5 March, NOT 3 May (Indian dd/mm)
        result = parse_date("05/03/2025")
        assert result == date(2025, 3, 5)
        assert result.month == 3  # March, not May

    def test_single_digit_day(self):
        assert parse_date("5/1/2026") == date(2026, 1, 5)

    def test_default_year_for_month_name(self):
        assert parse_date("28 Feb", default_year=2026) == date(2026, 2, 28)

    def test_invalid_date_returns_none(self):
        assert parse_date("31/02/2025") is None  # Feb 31 doesn't exist


# ── Amount parsing (SPEC messy examples) ─────────────────────────────────

class TestParseAmount:
    def test_indian_comma_format(self):
        # "1,77,000" → 17700000 paise, INR
        result = parse_amount("1,77,000")
        assert result == (17700000, "INR", False)

    def test_amount_with_currency_suffix(self):
        # "4100 AED"
        result = parse_amount("4100 AED")
        assert result == (410000, "AED", False)

    def test_usd_suffix(self):
        # "400 USD"
        result = parse_amount("400 USD")
        assert result == (40000, "USD", False)

    def test_lakhs_plus_gst(self):
        # "2L+GST" → ₹2,00,000 base = 20000000 paise, needs GST
        result = parse_amount("2L+GST")
        assert result == (20000000, "INR", True)

    def test_number_plus_gst(self):
        # "90,000+GST" → ₹90,000 base = 9000000 paise
        result = parse_amount("90,000+GST")
        assert result == (9000000, "INR", True)

    def test_dollar_sign(self):
        # "$400/ 10 hours"
        result = parse_amount("$400/ 10 hours")
        assert result == (40000, "USD", False)

    def test_dollar_sign_plain(self):
        result = parse_amount("$400")
        assert result == (40000, "USD", False)

    def test_status_paid_full(self):
        # "Paid Full" in amount column → None
        assert parse_amount("Paid Full") is None

    def test_status_paid_hrly(self):
        assert parse_amount("paid hrly") is None

    def test_two_payments_in_one_cell(self):
        # "1500 AED + 1500 AED" → sum = 3000 AED = 300000 fils
        result = parse_amount("1500 AED + 1500 AED")
        assert result == (300000, "AED", False)

    def test_empty(self):
        assert parse_amount("") is None

    def test_none(self):
        assert parse_amount(None) is None

    def test_plain_number(self):
        result = parse_amount("41300")
        assert result == (4130000, "INR", False)

    def test_currency_prefix(self):
        # "AED 1500"
        result = parse_amount("AED 1500")
        assert result == (150000, "AED", False)

    def test_gst_flag_usage(self):
        # If gst_flag is True, the caller should add_gst to get inclusive
        paise, currency, gst_flag = parse_amount("2L+GST")
        assert gst_flag is True
        inclusive = add_gst(paise)
        assert inclusive == 23600000  # ₹2,36,000


# ── Name normalization ───────────────────────────────────────────────────

class TestNormalizeName:
    def test_strip_old_tag(self):
        assert normalize_name("Priya Patel (old)") == "Priya Patel"

    def test_strip_sat_math_tag(self):
        assert normalize_name("Aarav Sharma (Sat Math)") == "Aarav Sharma"

    def test_strip_sibling_tag(self):
        assert normalize_name("Neel Gupta (sibling)") == "Neel Gupta"

    def test_extra_whitespace(self):
        assert normalize_name("  Meera   Kapoor  ") == "Meera Kapoor"

    def test_title_case(self):
        assert normalize_name("rahul SHARMA") == "Rahul Sharma"

    def test_empty(self):
        assert normalize_name("") == ""

    def test_first_name_only(self):
        assert normalize_name("Priya") == "Priya"

    def test_multiple_tags(self):
        assert normalize_name("Riya (IB) (old)") == "Riya"


# ── Duplicate detection ──────────────────────────────────────────────────

class TestFindDuplicateRows:
    def test_no_duplicates(self):
        rows = [{"a": 1, "b": 2}, {"a": 3, "b": 4}]
        assert find_duplicate_rows(rows, ["a", "b"]) == []

    def test_exact_duplicate(self):
        rows = [{"a": 1, "b": 2}, {"a": 1, "b": 2}, {"a": 3, "b": 4}]
        dupes = find_duplicate_rows(rows, ["a", "b"])
        assert dupes == [(0, 1)]

    def test_partial_key_match(self):
        rows = [{"a": 1, "b": 2}, {"a": 1, "b": 3}]
        # Only key on "a"
        dupes = find_duplicate_rows(rows, ["a"])
        assert dupes == [(0, 1)]

    def test_multiple_duplicates(self):
        rows = [{"a": 1}, {"a": 2}, {"a": 1}, {"a": 2}]
        dupes = find_duplicate_rows(rows, ["a"])
        assert (0, 2) in dupes
        assert (1, 3) in dupes


# ── Integration: load into SQLite ────────────────────────────────────────

class TestLoadAll:
    def test_load_generated_data(self):
        """Load all generated CSVs into an in-memory database."""
        data_dir = Path(__file__).resolve().parent.parent / "data"
        conn = load_all(data_dir=data_dir, db_path=":memory:")

        # Verify row counts
        students = conn.execute("SELECT COUNT(*) FROM student").fetchone()[0]
        assert students == 200

        enrollments = conn.execute("SELECT COUNT(*) FROM enrollment").fetchone()[0]
        assert enrollments > 200  # at least one per student

        installments = conn.execute("SELECT COUNT(*) FROM installment").fetchone()[0]
        assert installments > 200

        payments_in = conn.execute("SELECT COUNT(*) FROM payment_in").fetchone()[0]
        assert payments_in == 400

        payments_out = conn.execute("SELECT COUNT(*) FROM payment_out").fetchone()[0]
        assert payments_out == 60

        counselors = conn.execute("SELECT COUNT(*) FROM counselor").fetchone()[0]
        assert counselors == 20

        # Verify audit log was written
        audit = conn.execute("SELECT COUNT(*) FROM audit_log").fetchone()[0]
        assert audit >= 1

        conn.close()

    def test_dates_parsed_correctly(self):
        """Spot-check that ISO dates survived the round trip."""
        data_dir = Path(__file__).resolve().parent.parent / "data"
        conn = load_all(data_dir=data_dir, db_path=":memory:")

        # All installment due_dates should be valid ISO dates or NULL
        rows = conn.execute(
            "SELECT due_date FROM installment WHERE due_date IS NOT NULL"
        ).fetchall()
        for row in rows:
            d = date.fromisoformat(row[0])
            assert d.year >= 2025

        conn.close()

    def test_money_stored_as_int(self):
        """All amount columns should be integer paise."""
        data_dir = Path(__file__).resolve().parent.parent / "data"
        conn = load_all(data_dir=data_dir, db_path=":memory:")

        row = conn.execute(
            "SELECT amount_paid_paise FROM payment_in LIMIT 1"
        ).fetchone()
        assert isinstance(row[0], int)

        conn.close()
