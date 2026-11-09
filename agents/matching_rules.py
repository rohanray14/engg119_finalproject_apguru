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

from config import CONFIG

DATE_WINDOW_DAYS = CONFIG.matching.date_window_days
NAME_THRESHOLD = CONFIG.matching.name_threshold
HIGH_CONFIDENCE = CONFIG.matching.auto_match_threshold
MEDIUM_CONFIDENCE = 0.85
LOW_CONFIDENCE = CONFIG.matching.review_threshold


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

    # Safety: reject invalid amounts
    if pay_amount <= 0:
        return MatchPrediction(
            payment_id=payment["id"],
            installment_ids=[],
            confidence=0.0,
            method="rules",
            reason="invalid_amount",
        )

    # Safety: flag suspicious payer text (scam/refund keywords)
    raw_payer = (payment["payer_name"] or "").lower()
    _SUSPICIOUS_KEYWORDS = ["new account", "refund", "reversal", "chargeback",
                            "cancel", "dispute"]
    if any(kw in raw_payer for kw in _SUSPICIOUS_KEYWORDS):
        return MatchPrediction(
            payment_id=payment["id"],
            installment_ids=[],
            confidence=0.0,
            method="rules",
            reason="suspicious_payer_text",
        )

    # Safety: flag very old payments (>1 year before earliest installment due)
    if pay_date:
        earliest_due = None
        for inst in installments:
            d = _parse_iso_date(inst["due_date"])
            if d and (earliest_due is None or d < earliest_due):
                earliest_due = d
        if earliest_due and (earliest_due - pay_date).days > 365:
            return MatchPrediction(
                payment_id=payment["id"],
                installment_ids=[],
                confidence=0.0,
                method="rules",
                reason="payment_date_too_old",
            )

    # Step 1: Find candidates with exact amount match
    candidates = []
    for inst in installments:
        if inst["amount_due_paise"] == pay_amount and inst["currency"] == pay_currency:
            candidates.append(inst)

    if not candidates:
        return MatchPrediction(
            payment_id=payment["id"],
            installment_ids=[],
            confidence=0.0,
            method="rules",
            reason="no_amount_match",
        )

    # Step 2: Filter by date window — but keep all installments for students
    # that have at least one installment in the window (FIFO needs them).
    if pay_date:
        in_window_student_ids: set[int] = set()
        for inst in candidates:
            due = _parse_iso_date(inst["due_date"])
            if due is None or abs((pay_date - due).days) <= DATE_WINDOW_DAYS:
                in_window_student_ids.add(inst["student_id"])
        if in_window_student_ids:
            candidates = [
                inst for inst in candidates
                if inst["student_id"] in in_window_student_ids
            ]

    # Step 3: Score each candidate by name similarity + date proximity
    scored = []
    for inst in candidates:
        student_id = inst["student_id"]
        sinfo = student_names.get(student_id, {})
        nscore = _name_score(payer_name, sinfo)
        dscore = _date_proximity(pay_date, _parse_iso_date(inst["due_date"]))
        scored.append((inst, nscore, dscore))

    # Sort by name score descending (primary).
    # Tie-breaking happens in decision logic below (FIFO by due date).
    scored.sort(key=lambda x: x[1], reverse=True)

    # --- Decision logic ---

    # Blank payer: only match if truly one candidate in the entire dataset
    # for this amount+currency (not just after date filtering).
    if payer_name == "":
        total_same_amount = sum(
            1 for i in installments
            if i["amount_due_paise"] == pay_amount and i["currency"] == pay_currency
        )
        if total_same_amount == 1:
            inst = scored[0][0]
            return MatchPrediction(
                payment_id=payment["id"],
                installment_ids=[inst["id"]],
                confidence=MEDIUM_CONFIDENCE,
                reason="exact_amount+blank_payer+globally_unique",
                method="rules",
            )
        # Multiple same-amount installments with blank payer → never confident
        return MatchPrediction(
            payment_id=payment["id"],
            installment_ids=[],
            confidence=0.0,
            method="rules",
            reason=f"blank_payer+{total_same_amount}_same_amount",
        )

    # Count how many installments globally share this exact amount+currency.
    # High counts (common amounts) require extra caution.
    total_same_amount = sum(
        1 for i in installments
        if i["amount_due_paise"] == pay_amount and i["currency"] == pay_currency
    )

    # Single candidate with name
    if len(scored) == 1:
        inst, nscore, dscore = scored[0]
        if nscore >= NAME_THRESHOLD:
            # Even with a name match, if the amount is very common globally
            # (>5 installments share it), don't be too confident — the date
            # filter may have just happened to leave one candidate.
            if total_same_amount <= 3:
                confidence = HIGH_CONFIDENCE
            else:
                confidence = MEDIUM_CONFIDENCE
            return MatchPrediction(
                payment_id=payment["id"],
                installment_ids=[inst["id"]],
                confidence=confidence,
                method="rules",
                reason=f"exact_amount+name_match({nscore})+global({total_same_amount})",
            )
        # Weak name, single candidate — not confident enough
        return MatchPrediction(
            payment_id=payment["id"],
            installment_ids=[],
            confidence=LOW_CONFIDENCE,
            method="rules",
            reason=f"exact_amount+weak_name({nscore})",
        )

    # Multiple candidates: need a clear name winner
    if len(scored) > 1:
        best_inst, best_nscore, best_dscore = scored[0]
        second_nscore = scored[1][1]

        # Strong name match with clear gap over second-best
        if best_nscore >= NAME_THRESHOLD and (best_nscore - second_nscore) >= 20:
            # Among candidates with the same top name score, pick earliest
            # due date (FIFO — pay what's due first).
            top_name_cands = [(i, ns, ds) for i, ns, ds in scored if ns == best_nscore]
            if len(top_name_cands) > 1:
                top_name_cands.sort(
                    key=lambda x: _parse_iso_date(x[0]["due_date"]) or date.max,
                )
            winner = top_name_cands[0][0]
            # If amount is very common globally, cap confidence below
            # threshold — send to review queue even with a name match.
            if total_same_amount <= 3:
                confidence = MEDIUM_CONFIDENCE
            else:
                confidence = LOW_CONFIDENCE
            return MatchPrediction(
                payment_id=payment["id"],
                installment_ids=[winner["id"]],
                confidence=confidence,
                method="rules",
                reason=f"amount+name({best_nscore})_vs_second({second_nscore})+fifo+global({total_same_amount})",
            )

        # Multiple candidates, all with similar name scores → ambiguous
        return MatchPrediction(
            payment_id=payment["id"],
            installment_ids=[],
            confidence=0.0,
            method="rules",
            reason=f"ambiguous:{len(scored)}_candidates",
        )

    return None


def _date_proximity(pay_date: date | None, due_date: date | None) -> int:
    """Score 0-100 for how close two dates are. Closer = higher. None = 50."""
    if pay_date is None or due_date is None:
        return 50
    days = abs((pay_date - due_date).days)
    return max(0, 100 - days)


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
        "amount_paid_paise, currency "
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
