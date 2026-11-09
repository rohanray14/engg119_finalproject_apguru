"""Commissions agent — parse counselor terms and compute payouts.

Input: counselor terms_text (free text) → structured rule
       matched payments → commission calculations

The AI part: parsing free-text terms into structured rules.
Code part: all money math (rate application, TDS, refund deductions).
"""

from __future__ import annotations

import json
import re
import sqlite3
from dataclasses import dataclass
from typing import Optional


@dataclass
class ParsedRule:
    rate: float              # e.g. 0.10 for 10%
    scope: str               # "own_referrals" | "city" | "all"
    city: Optional[str] = None
    split: Optional[float] = None  # e.g. 0.5 for 50/50 split
    notes: str = ""


@dataclass
class CommissionCalc:
    counselor_id: int
    counselor_name: str
    payment_id: int
    student_id: int
    base_paise: int          # base amount before commission
    rate: float
    commission_paise: int
    refund_deduction_paise: int
    tds_paise: int           # 2% TDS
    net_paise: int


TDS_RATE = 0.02  # 2% TDS on commissions


def parse_terms(terms_text: str) -> ParsedRule:
    """Parse free-text counselor terms into a structured rule.

    This is the rules-based parser. Handles common patterns like:
    - "10% commission on all referrals"
    - "20% on Mumbai students"
    - "15% split 50/50 with X"
    - "10% commission"
    """
    text = terms_text.lower().strip()
    if not text:
        return ParsedRule(rate=0.0, scope="own_referrals", notes="no terms provided")

    # Extract rate
    rate_match = re.search(r"(\d+(?:\.\d+)?)\s*%", text)
    rate = float(rate_match.group(1)) / 100 if rate_match else 0.0

    # Detect scope
    scope = "own_referrals"
    city = None

    city_patterns = [
        (r"(?:on|for)\s+(\w+)\s+students", "city"),
        (r"(\w+)\s+(?:city|region|area)", "city"),
    ]
    skip_words = {"all", "my", "own", "the", "new", "each", "every"}
    for pattern, _ in city_patterns:
        m = re.search(pattern, text)
        if m and m.group(1).lower() not in skip_words:
            scope = "city"
            city = m.group(1).title()
            break

    if "all referrals" in text or "all students" in text:
        scope = "own_referrals"
    if "city" in text and city:
        scope = "city"

    # Detect split
    split = None
    split_match = re.search(r"split\s+(\d+)/(\d+)", text)
    if split_match:
        a, b = int(split_match.group(1)), int(split_match.group(2))
        split = a / (a + b)
    elif "split" in text:
        split = 0.5  # default 50/50

    return ParsedRule(
        rate=rate,
        scope=scope,
        city=city,
        split=split,
        notes=terms_text,
    )


def compute_commissions(
    conn: sqlite3.Connection,
    commit: bool = True,
) -> list[CommissionCalc]:
    """Compute commissions for all counselors based on matched payments.

    Only processes payments that have been matched (auto or approved).
    A rule the finance lead set by hand (``parsed_rule`` with
    ``"set_by": "human"``) takes precedence over the rule parsed from the
    terms text.  Pass ``commit=False`` to run inside the caller's transaction.
    """
    counselors = _get_counselors(conn)
    matched_payments = _get_matched_payments(conn)
    student_counselor_map = _get_student_counselors(conn)

    results: list[CommissionCalc] = []

    for c in counselors:
        rule = human_rule(c.get("parsed_rule"))
        if rule is None:
            rule = parse_terms(c["terms_text"])
            if rule.rate <= 0:
                continue
            # Store parsed rule back
            conn.execute(
                "UPDATE counselor SET parsed_rule = ? WHERE id = ?",
                (json.dumps({"rate": rule.rate, "scope": rule.scope,
                             "city": rule.city, "split": rule.split}), c["id"]),
            )
        if rule.rate <= 0:
            continue

        for mp in matched_payments:
            student_id = mp["student_id"]

            # Check if this counselor is linked to this student
            counselor_ids = student_counselor_map.get(student_id, [])
            if c["id"] not in counselor_ids:
                continue

            base_paise = mp["amount_paid_paise"]
            commission_paise = int(base_paise * rule.rate)

            if rule.split:
                commission_paise = int(commission_paise * rule.split)

            tds_paise = int(commission_paise * TDS_RATE)
            net_paise = commission_paise - tds_paise

            results.append(CommissionCalc(
                counselor_id=c["id"],
                counselor_name=c["name"],
                payment_id=mp["payment_id"],
                student_id=student_id,
                base_paise=base_paise,
                rate=rule.rate,
                commission_paise=commission_paise,
                refund_deduction_paise=0,
                tds_paise=tds_paise,
                net_paise=net_paise,
            ))

    if commit:
        conn.commit()
    return results


def human_rule(parsed_rule_json: Optional[str]) -> Optional[ParsedRule]:
    """Return the finance lead's hand-set rule, if one is stored."""
    if not parsed_rule_json:
        return None
    try:
        data = json.loads(parsed_rule_json)
    except (TypeError, ValueError):
        return None
    if not isinstance(data, dict) or data.get("set_by") != "human":
        return None
    return ParsedRule(
        rate=float(data.get("rate") or 0.0),
        scope=data.get("scope") or "own_referrals",
        city=data.get("city"),
        split=data.get("split"),
        notes="set by finance lead",
    )


def _get_counselors(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute("SELECT * FROM counselor").fetchall()
    return [dict(r) for r in rows]


def _get_matched_payments(conn: sqlite3.Connection) -> list[dict]:
    """Get payments that have been matched to installments.

    One row per (matched payment, student it was allocated to).  The JSON
    allocations are unpacked in Python rather than with SQLite's json_each,
    so this runs on SQLite and Postgres alike.
    """
    matches = conn.execute(
        "SELECT mr.id, mr.payment_id, mr.allocations, p.amount_paid_paise, p.currency "
        "FROM match_result mr "
        "JOIN payment_in p ON mr.payment_id = p.id "
        "WHERE mr.status IN ('auto', 'approved') "
        "ORDER BY mr.id"
    ).fetchall()
    inst_to_student = {
        r["id"]: r["student_id"]
        for r in conn.execute(
            "SELECT i.id, e.student_id FROM installment i "
            "JOIN enrollment e ON i.enrollment_id = e.id"
        ).fetchall()
    }

    # Distinct students per payment, across all its auto/approved matches
    students_by_payment: dict[int, list[int]] = {}
    for m in matches:
        seen = students_by_payment.setdefault(m["payment_id"], [])
        for alloc in json.loads(m["allocations"] or "[]"):
            sid = inst_to_student.get(int(alloc["installment_id"]))
            if sid is not None and sid not in seen:
                seen.append(sid)

    rows = []
    for m in matches:
        for sid in students_by_payment.get(m["payment_id"], []):
            rows.append({
                "payment_id": m["payment_id"],
                "allocations": m["allocations"],
                "amount_paid_paise": m["amount_paid_paise"],
                "currency": m["currency"],
                "student_id": sid,
            })
    return rows


def _get_student_counselors(conn: sqlite3.Connection) -> dict[int, list[int]]:
    """Build {student_id: [counselor_ids]} from student table."""
    rows = conn.execute("SELECT id, counselor_ids FROM student").fetchall()
    result = {}
    for r in rows:
        try:
            ids = json.loads(r["counselor_ids"]) if r["counselor_ids"] else []
            if isinstance(ids, list):
                result[r["id"]] = [int(x) for x in ids]
        except (json.JSONDecodeError, TypeError):
            pass
    return result
