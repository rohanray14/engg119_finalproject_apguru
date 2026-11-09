"""Load generated CSV data into the SQLite ledger.

Includes cleanup parsers for the messy patterns described in SPEC.md
section 3: date formats, amount+currency text, name normalization,
and duplicate detection.
"""

from __future__ import annotations

import csv
import json
import re
import sqlite3
from datetime import date, datetime
from pathlib import Path
from typing import Optional

from ledger.db import get_connection, log_audit

DATA_DIR = Path(__file__).resolve().parent.parent / "data"

# ---------------------------------------------------------------------------
# Date parsing  (SPEC: dd/mm/yyyy, dd.mm.yyyy, dd.mm.yy, "16 Sept")
# ---------------------------------------------------------------------------

_MONTH_MAP: dict[str, int] = {}
for _i, _names in enumerate([
    ("jan", "january"), ("feb", "february"), ("mar", "march"),
    ("apr", "april"), ("may",), ("jun", "june"),
    ("jul", "july"), ("aug", "august"), ("sep", "sept", "september"),
    ("oct", "october"), ("nov", "november"), ("dec", "december"),
], start=1):
    for _n in _names:
        _MONTH_MAP[_n] = _i

# dd/mm/yyyy or dd.mm.yyyy or dd.mm.yy
_RE_DMY = re.compile(
    r"^(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})$"
)
# "16 Sept" or "3 Jan" style
_RE_DMON = re.compile(
    r"^(\d{1,2})\s+([A-Za-z]+)$"
)


def parse_date(text: str, default_year: int = 2025) -> Optional[date]:
    """Parse a messy date string into a ``date`` or return None.

    Assumes **day/month** order (Indian format) — never mm/dd.
    """
    if not text or not text.strip():
        return None

    text = text.strip()

    # ISO date (from clean data)
    if re.match(r"^\d{4}-\d{2}-\d{2}$", text):
        return date.fromisoformat(text)

    # dd/mm/yyyy  dd.mm.yyyy  dd.mm.yy
    m = _RE_DMY.match(text)
    if m:
        day, month, year = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if year < 100:
            year += 2000
        try:
            return date(year, month, day)
        except ValueError:
            return None

    # "16 Sept" style
    m = _RE_DMON.match(text)
    if m:
        day = int(m.group(1))
        mon_str = m.group(2).lower()
        month = _MONTH_MAP.get(mon_str)
        if month:
            try:
                return date(default_year, month, day)
            except ValueError:
                return None

    return None


# ---------------------------------------------------------------------------
# Amount + currency parsing
# ---------------------------------------------------------------------------

_RE_INDIAN_NUM = re.compile(r"^[\d,]+$")
_RE_AMT_CURRENCY = re.compile(r"^([\d,]+)\s*(INR|USD|AED|GBP|EUR|SGD)$", re.I)
_RE_CURRENCY_AMT = re.compile(r"^(INR|USD|AED|GBP|EUR|SGD)\s*([\d,]+)$", re.I)
_RE_DOLLAR = re.compile(r"^\$([\d,]+)")
_RE_L_GST = re.compile(r"^([\d.]+)\s*L\s*\+?\s*GST$", re.I)
_RE_NUM_GST = re.compile(r"^([\d,]+)\s*\+\s*GST$", re.I)
_RE_TWO_AMOUNTS = re.compile(
    r"^([\d,]+)\s*(INR|USD|AED|GBP|EUR|SGD)\s*\+\s*([\d,]+)\s*\2$", re.I,
)

# Status strings that appear in the amount column
_STATUS_STRINGS = {
    "paid full", "paid hrly", "full paid", "paid", "piad full",
    "paid hlry", "piad", "pending",
}


def parse_amount(text: str) -> Optional[tuple[int, str, bool]]:
    """Parse a messy amount cell into ``(paise, currency, gst_flag)``.

    *gst_flag* is True when the text says "+GST" (meaning the returned paise
    is the **base** amount before GST).

    Returns None for status strings like "Paid Full".
    """
    if not text or not text.strip():
        return None

    raw = text.strip()

    # Skip status strings
    if raw.lower() in _STATUS_STRINGS:
        return None

    # "1500 AED + 1500 AED" → sum
    m = _RE_TWO_AMOUNTS.match(raw)
    if m:
        a = _strip_commas(m.group(1))
        b = _strip_commas(m.group(3))
        currency = m.group(2).upper()
        total = a + b
        return total * 100, currency, False  # convert to paise/cents

    # "2L+GST" or "2.5L+GST"
    m = _RE_L_GST.match(raw)
    if m:
        lakhs = float(m.group(1))
        rupees = int(lakhs * 100000)
        return rupees * 100, "INR", True  # base paise, needs GST added

    # "90,000+GST"
    m = _RE_NUM_GST.match(raw)
    if m:
        rupees = _strip_commas(m.group(1))
        return rupees * 100, "INR", True

    # "$400" or "$400/ 10 hours"
    m = _RE_DOLLAR.match(raw)
    if m:
        dollars = _strip_commas(m.group(1))
        return dollars * 100, "USD", False  # cents

    # "4100 AED" or "400 USD"
    m = _RE_AMT_CURRENCY.match(raw)
    if m:
        amount = _strip_commas(m.group(1))
        currency = m.group(2).upper()
        return amount * 100, currency, False

    # "AED 4100"
    m = _RE_CURRENCY_AMT.match(raw)
    if m:
        currency = m.group(1).upper()
        amount = _strip_commas(m.group(2))
        return amount * 100, currency, False

    # Plain Indian number "1,77,000"
    cleaned = raw.replace(",", "")
    if cleaned.isdigit():
        return int(cleaned) * 100, "INR", False

    return None


def _strip_commas(s: str) -> int:
    return int(s.replace(",", ""))


# ---------------------------------------------------------------------------
# Name normalization
# ---------------------------------------------------------------------------

_RE_NAME_TAG = re.compile(r"\s*\(.*?\)\s*")


def normalize_name(name: str) -> str:
    """Strip tags like '(old)', '(Sat Math)' and extra whitespace.

    Returns title-cased name with single spaces.
    """
    if not name:
        return ""
    cleaned = _RE_NAME_TAG.sub(" ", name)
    cleaned = " ".join(cleaned.split())
    return cleaned.strip().title()


# ---------------------------------------------------------------------------
# Duplicate detection
# ---------------------------------------------------------------------------

def find_duplicate_rows(
    rows: list[dict],
    key_cols: list[str],
) -> list[tuple[int, int]]:
    """Return pairs of (row_index_a, row_index_b) that are duplicates
    based on the given key columns."""
    seen: dict[tuple, int] = {}
    dupes: list[tuple[int, int]] = []
    for idx, row in enumerate(rows):
        key = tuple(row.get(c, "") for c in key_cols)
        if key in seen:
            dupes.append((seen[key], idx))
        else:
            seen[key] = idx
    return dupes


# ---------------------------------------------------------------------------
# Loader
# ---------------------------------------------------------------------------

def load_all(data_dir: Path | None = None, db_path: Path | str | None = None) -> sqlite3.Connection:
    """Load all generated CSVs into a fresh SQLite database.

    Returns the open connection.
    """
    ddir = data_dir or DATA_DIR
    conn = get_connection(db_path)

    _load_students(conn, ddir / "students.csv")
    _load_enrollments(conn, ddir / "enrollments.csv")
    _load_installments(conn, ddir / "installments.csv")
    _load_counselors(conn, ddir / "counselors.csv")
    _load_payments_in(conn, ddir / "payments_in.csv")
    _load_payments_out(conn, ddir / "payments_out.csv")

    # Bank statement (optional — may not exist in test splits)
    bs_path = ddir / "bank_statement.csv"
    if bs_path.exists():
        _load_bank_statement(conn, bs_path)

    log_audit(conn, "loader", "load_all", "database", new_value=str(ddir))
    return conn


def _read_csv(path: Path) -> list[dict]:
    with open(path, newline="") as f:
        return list(csv.DictReader(f))


def _load_students(conn: sqlite3.Connection, path: Path):
    for row in _read_csv(path):
        conn.execute(
            "INSERT OR REPLACE INTO student (id, name, aliases, city, country, counselor_ids, payer_aliases) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                int(row["id"]),
                normalize_name(row["name"]),
                row.get("aliases", "[]"),
                row.get("city", ""),
                row.get("country", ""),
                row.get("counselor_ids", "[]"),
                row.get("payer_aliases", "[]"),
            ),
        )
    conn.commit()


def _load_enrollments(conn: sqlite3.Connection, path: Path):
    for row in _read_csv(path):
        conn.execute(
            "INSERT OR REPLACE INTO enrollment "
            "(id, student_id, program, fee_model, total_fee_paise, currency, gst_applicable) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                int(row["id"]),
                int(row["student_id"]),
                row["program"],
                row["fee_model"],
                int(row["total_fee_paise"]),
                row["currency"],
                int(row["gst_applicable"] in ("1", "True", "true")),
            ),
        )
    conn.commit()


def _load_installments(conn: sqlite3.Connection, path: Path):
    for row in _read_csv(path):
        due = parse_date(row.get("due_date", ""))
        conn.execute(
            "INSERT OR REPLACE INTO installment "
            "(id, enrollment_id, due_date, amount_due_paise, currency, status) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (
                int(row["id"]),
                int(row["enrollment_id"]),
                due.isoformat() if due else None,
                int(row["amount_due_paise"]),
                row["currency"],
                row.get("status", "open"),
            ),
        )
    conn.commit()


def _load_counselors(conn: sqlite3.Connection, path: Path):
    for row in _read_csv(path):
        conn.execute(
            "INSERT OR REPLACE INTO counselor (id, name, terms_text, parsed_rule) "
            "VALUES (?, ?, ?, ?)",
            (
                int(row["id"]),
                normalize_name(row["name"]),
                row.get("terms_text", ""),
                None,
            ),
        )
    conn.commit()


def _load_payments_in(conn: sqlite3.Connection, path: Path):
    for row in _read_csv(path):
        pay_date = parse_date(row.get("date", ""))
        conn.execute(
            "INSERT OR REPLACE INTO payment_in "
            "(id, source, method, payer_name, date, amount_paid_paise, currency, "
            " gateway_fee_paise, gst_on_fee_paise, fx_diff_paise, tds_paise, "
            " amount_in_bank_paise, confirmation) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                int(row["id"]),
                row["source"],
                row.get("method") or None,
                row.get("payer_name") or None,
                pay_date.isoformat() if pay_date else None,
                int(row["amount_paid_paise"]),
                row["currency"],
                int(row.get("gateway_fee_paise", 0)),
                int(row.get("gst_on_fee_paise", 0)),
                int(row.get("fx_diff_paise", 0)),
                int(row.get("tds_paise", 0)),
                int(row.get("amount_in_bank_paise", 0)) if row.get("amount_in_bank_paise") else None,
                row.get("confirmation", "screenshot_only"),
            ),
        )
    conn.commit()


def _load_bank_statement(conn: sqlite3.Connection, path: Path):
    """Load bank statement CSV. Uses INSERT OR IGNORE for idempotent ingestion."""
    for row in _read_csv(path):
        stmt_date = parse_date(row.get("date", ""))
        conn.execute(
            "INSERT OR IGNORE INTO bank_statement "
            "(date, narration, credit_paise, debit_paise) "
            "VALUES (?, ?, ?, ?)",
            (
                stmt_date.isoformat() if stmt_date else "",
                row.get("narration", ""),
                int(row.get("credit_paise", 0)),
                int(row.get("debit_paise", 0)),
            ),
        )
    conn.commit()


def _load_payments_out(conn: sqlite3.Connection, path: Path):
    for row in _read_csv(path):
        pay_date = parse_date(row.get("date", ""))
        conn.execute(
            "INSERT OR REPLACE INTO payment_out "
            "(id, date, payee, category, amount_paise, currency) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (
                int(row["id"]),
                pay_date.isoformat() if pay_date else None,
                row["payee"],
                row["category"],
                int(row["amount_paise"]),
                row.get("currency", "INR"),
            ),
        )
    conn.commit()
