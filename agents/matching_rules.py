"""Rules-based payment matcher (baseline).

Matching pipeline:
1. Exact amount match (same paise + currency)
2. Fuzzy name match (payer_name vs student name / payer aliases)
3. Date window (payment date within ±30 days of installment due date)

If exactly one candidate survives all filters → high confidence match.
If multiple candidates but one has a strong name match → medium confidence.
Otherwise → unsure.
"""

from __future__ import annotations

import json
import sqlite3
from datetime import date, timedelta
from typing import Optional

from ledger.db import get_connection
from ledger.load import normalize_name

# Optional: rapidfuzz for fuzzy name matching
try:
    from rapidfuzz import fuzz
    HAS_RAPIDFUZZ = True
except ImportError:
    HAS_RAPIDFUZZ = False

from evals.scoring import MatchPrediction


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

DATE_WINDOW_DAYS = 30
NAME_THRESHOLD = 70       # fuzzy ratio threshold (0–100)
HIGH_CONFIDENCE = 0.95
MEDIUM_CONFIDENCE = 0.85
LOW_CONFIDENCE = 0.50


# ---------------------------------------------------------------------------
# Matcher
# ---------------------------------------------------------------------------

def match_all(conn: sqlite3.Connection) -> list[MatchPrediction]:
    """Run the rules matcher on all unmatched payments in the database.

    Returns a list of MatchPrediction objects.
    """
    payments = _get_payments(conn)
    installments = _get_installments(conn)
    student_names = _get_student_names(conn)

    predictions: list[MatchPrediction] = []

    for pay in payments:
        pred = _match_one(pay, installments, student_names)
        if pred:
            predictions.append(pred)

    return predictions


def _match_one(
    payment: dict,
    installments: list[dict],
    student_names: dict[int, dict],
) -> Optional[MatchPrediction]:
    """Try to match a single payment to installment(s)."""
    pay_amount = payment["amount_paid_paise"]
    pay_currency = payment["currency"]
    pay_date = _parse_iso_date(payment["date"])
    payer_name = normalize_name(payment["payer_name"] or "")

    # Step 1: Find candidates with exact amount match
    candidates = []
    for inst in installments:
        if inst["amount_due_paise"] == pay_amount and inst["currency"] == pay_currency:
            candidates.append(inst)

    if not candidates:
        # No exact amount match → unsure
        return MatchPrediction(
            payment_id=payment["id"],
            installment_ids=[],
            confidence=0.0,
            method="rules",
            reason="no_amount_match",
        )

    # Step 2: Filter by date window
    if pay_date:
        date_filtered = []
        for inst in candidates:
            due = _parse_iso_date(inst["due_date"])
            if due is None or abs((pay_date - due).days) <= DATE_WINDOW_DAYS:
                date_filtered.append(inst)
        if date_filtered:
            candidates = date_filtered

    # Step 3: Score by name similarity
    scored = []
    for inst in candidates:
        student_id = inst["student_id"]
        sinfo = student_names.get(student_id, {})
        name_score = _name_score(payer_name, sinfo)
        scored.append((inst, name_score))

    # Sort by name score descending
    scored.sort(key=lambda x: x[1], reverse=True)

    # Decision logic
    if len(scored) == 1:
        inst, nscore = scored[0]
        if nscore >= NAME_THRESHOLD:
            confidence = HIGH_CONFIDENCE
            reason = f"exact_amount+name_match({nscore})"
        elif payer_name == "":
            confidence = MEDIUM_CONFIDENCE
            reason = "exact_amount+blank_payer+unique_candidate"
        else:
            confidence = MEDIUM_CONFIDENCE
            reason = f"exact_amount+weak_name({nscore})"
        return MatchPrediction(
            payment_id=payment["id"],
            installment_ids=[inst["id"]],
            confidence=confidence,
            method="rules",
            reason=reason,
        )

    if len(scored) > 1:
        best_inst, best_score = scored[0]
        second_score = scored[1][1]

        # Clear winner by name
        if best_score >= NAME_THRESHOLD and (best_score - second_score) >= 20:
            return MatchPrediction(
                payment_id=payment["id"],
                installment_ids=[best_inst["id"]],
                confidence=MEDIUM_CONFIDENCE,
                method="rules",
                reason=f"amount_match+best_name({best_score})_vs_second({second_score})",
            )

        # Multiple candidates, no clear winner
        return MatchPrediction(
            payment_id=payment["id"],
            installment_ids=[],
            confidence=0.0,
            method="rules",
            reason=f"ambiguous:{len(scored)}_candidates",
        )

    return None


def _name_score(payer_name: str, student_info: dict) -> int:
    """Score how well the payer name matches the student or their payer aliases."""
    if not payer_name:
        return 0

    names_to_check = []
    if student_info.get("name"):
        names_to_check.append(normalize_name(student_info["name"]))
    for alias in student_info.get("payer_aliases", []):
        names_to_check.append(normalize_name(alias))
    for alias in student_info.get("aliases", []):
        names_to_check.append(normalize_name(alias))

    if not names_to_check:
        return 0

    if HAS_RAPIDFUZZ:
        best = 0
        for name in names_to_check:
            # Try both token_sort_ratio and partial_ratio
            s1 = fuzz.token_sort_ratio(payer_name.lower(), name.lower())
            s2 = fuzz.partial_ratio(payer_name.lower(), name.lower())
            best = max(best, s1, s2)
        return best
    else:
        # Fallback: exact substring check
        payer_lower = payer_name.lower()
        for name in names_to_check:
            if payer_lower == name.lower():
                return 100
            if payer_lower in name.lower() or name.lower() in payer_lower:
                return 80
        # Last-name match
        payer_parts = payer_lower.split()
        for name in names_to_check:
            name_parts = name.lower().split()
            if payer_parts and name_parts and payer_parts[-1] == name_parts[-1]:
                return 60
        return 0


# ---------------------------------------------------------------------------
# DB queries
# ---------------------------------------------------------------------------

def _get_payments(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute(
        "SELECT id, source, method, payer_name, date, "
        "amount_paid_paise, currency, case_types "
        "FROM payment_in"
    ).fetchall()
    return [dict(r) for r in rows]


def _get_installments(conn: sqlite3.Connection) -> list[dict]:
    """Get installments joined with enrollment to get student_id."""
    rows = conn.execute(
        "SELECT i.id, i.enrollment_id, i.due_date, i.amount_due_paise, "
        "i.currency, i.status, e.student_id "
        "FROM installment i "
        "JOIN enrollment e ON i.enrollment_id = e.id"
    ).fetchall()
    return [dict(r) for r in rows]


def _get_student_names(conn: sqlite3.Connection) -> dict[int, dict]:
    """Build a lookup: student_id → {name, aliases, payer_aliases}."""
    rows = conn.execute(
        "SELECT id, name, aliases, payer_aliases FROM student"
    ).fetchall()
    result = {}
    for r in rows:
        aliases = _parse_json_list(r["aliases"])
        payer_aliases = _parse_json_list(r["payer_aliases"])
        result[r["id"]] = {
            "name": r["name"],
            "aliases": aliases,
            "payer_aliases": payer_aliases,
        }
    return result


def _parse_json_list(val: str | None) -> list[str]:
    if not val:
        return []
    try:
        parsed = json.loads(val)
        if isinstance(parsed, list):
            return [str(x) for x in parsed]
    except (json.JSONDecodeError, TypeError):
        pass
    return []


def _parse_iso_date(val: str | None) -> date | None:
    if not val:
        return None
    try:
        return date.fromisoformat(val)
    except (ValueError, TypeError):
        return None
