"""Rules-based payment matcher (production quality).

Matching pipeline:
1. Find candidate installments via exact, TDS-adjusted, and partial amount matching
2. Score candidates by name similarity, date proximity, and amount explanation
3. Apply confidence logic (conservative for safety)
4. Global assignment: process by confidence, prevent double-claiming

All money math is deterministic (ledger/money.py). No LLM calls.
"""

from __future__ import annotations

import json
import sqlite3
from datetime import date
from typing import Optional

from ledger.load import normalize_name
from ledger.money import explain_amount

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
    """Run the rules matcher on all unmatched payments.

    Uses global assignment: processes payments by confidence (highest first)
    to prevent double-claiming installments.
    """
    payments = _get_payments(conn)
    installments = _get_installments(conn)
    student_names = _get_student_names(conn)
    enrollments = _get_enrollments(conn)

    # First pass: score all payments independently
    raw_predictions: list[MatchPrediction] = []
    for pay in payments:
        pred = _match_one(pay, installments, student_names, enrollments)
        if pred:
            raw_predictions.append(pred)

    # Global assignment: sort by confidence desc, prevent double-claiming
    return _global_assign(raw_predictions, installments)


def _global_assign(
    predictions: list[MatchPrediction],
    installments: list[dict],
) -> list[MatchPrediction]:
    """Prevent double-claiming: each installment can only be claimed once.

    Process predictions from highest confidence to lowest. If an installment
    is already claimed, reduce confidence or remove it.
    """
    # Track remaining balance per installment (paise)
    remaining: dict[int, int] = {}
    for inst in installments:
        remaining[inst["id"]] = inst["amount_due_paise"]

    # Sort: confident first, then by number of installments (prefer simpler matches)
    sorted_preds = sorted(
        predictions,
        key=lambda p: (-p.confidence, len(p.installment_ids)),
    )

    result: list[MatchPrediction] = []
    for pred in sorted_preds:
        if not pred.installment_ids:
            result.append(pred)
            continue

        # Check if all claimed installments have remaining balance
        all_available = True
        for iid in pred.installment_ids:
            if remaining.get(iid, 0) <= 0:
                all_available = False
                break

        if all_available:
            # Claim the installments
            for iid in pred.installment_ids:
                remaining[iid] = 0  # Fully claimed
            result.append(pred)
        else:
            # Installment already claimed — downgrade to unmatched
            result.append(MatchPrediction(
                payment_id=pred.payment_id,
                installment_ids=[],
                confidence=0.0,
                method=pred.method,
                reason=f"global_conflict:{pred.reason}",
            ))

    return result


def _match_one(
    payment: dict,
    installments: list[dict],
    student_names: dict[int, dict],
    enrollments: dict[int, dict],
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

    # Safety: flag suspicious payer text (scam/refund keywords, prompt injection)
    raw_payer = (payment["payer_name"] or "").lower()
    _SUSPICIOUS_KEYWORDS = [
        "new account", "refund", "reversal", "chargeback",
        "cancel", "dispute", "ignore all", "system override",
        "instructions",
    ]
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

    # Step 1: Find candidates with amount explanations
    candidates = _find_candidates(pay_amount, pay_currency, installments, enrollments)

    if not candidates:
        return MatchPrediction(
            payment_id=payment["id"],
            installment_ids=[],
            confidence=0.0,
            method="rules",
            reason="no_amount_match",
        )

    # Step 2: Filter by date window
    if pay_date:
        in_window_student_ids: set[int] = set()
        for cand in candidates:
            due = _parse_iso_date(cand["inst"]["due_date"])
            if due is None or abs((pay_date - due).days) <= DATE_WINDOW_DAYS:
                in_window_student_ids.add(cand["inst"]["student_id"])
        if in_window_student_ids:
            candidates = [
                c for c in candidates
                if c["inst"]["student_id"] in in_window_student_ids
            ]

    # Step 3: Score each candidate
    scored: list[dict] = []
    for cand in candidates:
        student_id = cand["inst"]["student_id"]
        sinfo = student_names.get(student_id, {})
        nscore = _name_score(payer_name, sinfo)
        dscore = _date_proximity(pay_date, _parse_iso_date(cand["inst"]["due_date"]))
        scored.append({
            **cand,
            "nscore": nscore,
            "dscore": dscore,
        })

    # Sort by: explanation score desc, name score desc, date score desc
    scored.sort(key=lambda x: (-x["explanation"]["score"], -x["nscore"], -x["dscore"]))

    # --- Decision logic ---
    return _decide(payment, scored, installments, student_names, payer_name, pay_amount, pay_currency)


def _find_candidates(
    pay_amount: int,
    pay_currency: str,
    installments: list[dict],
    enrollments: dict[int, dict],
) -> list[dict]:
    """Find candidate installments using amount explanations.

    Tries exact match, TDS-adjusted, and partial matching.
    """
    candidates: list[dict] = []

    for inst in installments:
        if inst["currency"] != pay_currency:
            continue

        # Check if installment is already marked as paid (skip it)
        if inst.get("status") == "paid":
            continue

        inst_amount = inst["amount_due_paise"]

        # Get GST applicability from enrollment
        enroll = enrollments.get(inst["enrollment_id"], {})
        gst_applicable = bool(enroll.get("gst_applicable", True))

        explanations = explain_amount(
            pay_amount, inst_amount,
            gst_applicable=gst_applicable,
        )

        for expl in explanations:
            candidates.append({
                "inst": inst,
                "explanation": expl,
            })

    return candidates


def _decide(
    payment: dict,
    scored: list[dict],
    installments: list[dict],
    student_names: dict[int, dict],
    payer_name: str,
    pay_amount: int,
    pay_currency: str,
) -> MatchPrediction:
    """Apply confidence logic to scored candidates."""
    if not scored:
        return MatchPrediction(
            payment_id=payment["id"],
            installment_ids=[],
            confidence=0.0,
            method="rules",
            reason="no_candidates_after_scoring",
        )

    # Count same-amount installments and students (for the best explanation type)
    best_story = scored[0]["explanation"]["story"]

    # For exact matches, count installments with exact same amount
    # For TDS/partial, count installments whose adjusted amount matches
    same_amount_student_ids = set()
    total_same_amount = 0
    for cand in scored:
        if cand["explanation"]["story"] == best_story:
            same_amount_student_ids.add(cand["inst"]["student_id"])
            total_same_amount += 1

    # Blank payer
    if payer_name == "":
        if total_same_amount == 1:
            inst = scored[0]["inst"]
            expl = scored[0]["explanation"]
            return MatchPrediction(
                payment_id=payment["id"],
                installment_ids=[inst["id"]],
                confidence=MEDIUM_CONFIDENCE,
                reason=f"{expl['story']}+blank_payer+globally_unique",
                method="rules",
            )
        return MatchPrediction(
            payment_id=payment["id"],
            installment_ids=[],
            confidence=0.0,
            method="rules",
            reason=f"blank_payer+{total_same_amount}_same_amount",
        )

    # Count distinct students globally matching payer name
    students_with_name_match = set()
    for sid, sinfo in student_names.items():
        ns = _name_score(payer_name, sinfo)
        if ns >= NAME_THRESHOLD:
            students_with_name_match.add(sid)

    # Filter to same-story candidates for decision logic
    same_story = [s for s in scored if s["explanation"]["story"] == best_story]

    if len(same_story) == 1:
        return _single_candidate_decision(
            payment, same_story[0], total_same_amount,
            same_amount_student_ids, students_with_name_match,
        )

    if len(same_story) > 1:
        return _multi_candidate_decision(
            payment, same_story, total_same_amount,
            same_amount_student_ids, students_with_name_match, payer_name,
        )

    return None


MAX_STUDENTS_FOR_HIGH = 5  # Max distinct students sharing amount for HIGH confidence


def _single_candidate_decision(
    payment: dict,
    cand: dict,
    total_same_amount: int,
    same_amount_student_ids: set[int],
    students_with_name_match: set[int],
) -> MatchPrediction:
    """Decision when only one candidate matches the best explanation story."""
    inst = cand["inst"]
    nscore = cand["nscore"]
    expl = cand["explanation"]
    story = expl["story"]

    if nscore >= NAME_THRESHOLD:
        # Confidence depends on how many distinct students share this amount.
        # With few students, name matching is reliable enough for auto-match.
        # With many students, name noise makes auto-matching risky.
        if len(same_amount_student_ids) <= MAX_STUDENTS_FOR_HIGH:
            confidence = HIGH_CONFIDENCE
        else:
            confidence = MEDIUM_CONFIDENCE
        return MatchPrediction(
            payment_id=payment["id"],
            installment_ids=[inst["id"]],
            confidence=confidence,
            method="rules",
            reason=f"{story}+name({nscore})+global({total_same_amount})+students({len(same_amount_student_ids)})",
        )

    return MatchPrediction(
        payment_id=payment["id"],
        installment_ids=[],
        confidence=LOW_CONFIDENCE,
        method="rules",
        reason=f"{story}+weak_name({nscore})",
    )


def _multi_candidate_decision(
    payment: dict,
    candidates: list[dict],
    total_same_amount: int,
    same_amount_student_ids: set[int],
    students_with_name_match: set[int],
    payer_name: str,
) -> MatchPrediction:
    """Decision when multiple candidates match the best explanation story."""
    best = candidates[0]
    best_nscore = best["nscore"]
    second_nscore = candidates[1]["nscore"]
    expl = best["explanation"]
    story = expl["story"]

    # Check for exact payer_alias match (strongest signal)
    # Exact match = 100, fuzzy cap = 90, so gap of 10 means exact vs fuzzy
    has_exact = best_nscore == 100

    # Check if all top candidates belong to the same student (not really ambiguous)
    top_student_ids = set(c["inst"]["student_id"] for c in candidates if c["nscore"] == best_nscore)
    if len(top_student_ids) == 1 and best_nscore >= NAME_THRESHOLD:
        # All top-scoring candidates are the same student's installments
        top_cands = [c for c in candidates if c["nscore"] == best_nscore]
        # FIFO: earliest due date first
        top_cands.sort(key=lambda x: _parse_iso_date(x["inst"]["due_date"]) or date.max)
        winner = top_cands[0]
        inst = winner["inst"]

        # Only HIGH when this student has exactly 1 matching installment
        # (multiple installments = can't reliably pick which one)
        if len(top_cands) == 1 and len(same_amount_student_ids) <= MAX_STUDENTS_FOR_HIGH:
            confidence = HIGH_CONFIDENCE
        else:
            confidence = MEDIUM_CONFIDENCE
        return MatchPrediction(
            payment_id=payment["id"],
            installment_ids=[inst["id"]],
            confidence=confidence,
            method="rules",
            reason=f"{story}+name({best_nscore})+same_student({len(top_cands)})+fifo+global({total_same_amount})+students({len(same_amount_student_ids)})",
        )

    # Lower gap threshold when we have an exact alias match
    min_gap = 10 if has_exact else 20

    if best_nscore >= NAME_THRESHOLD and (best_nscore - second_nscore) >= min_gap:
        # Among candidates with same top name score, pick FIFO (earliest due date)
        top_cands = [c for c in candidates if c["nscore"] == best_nscore]
        if len(top_cands) > 1:
            top_cands.sort(
                key=lambda x: _parse_iso_date(x["inst"]["due_date"]) or date.max,
            )
        winner = top_cands[0]
        inst = winner["inst"]

        # Confidence: conservative for multi-student amounts
        if len(same_amount_student_ids) <= MAX_STUDENTS_FOR_HIGH:
            confidence = HIGH_CONFIDENCE
        else:
            confidence = LOW_CONFIDENCE
        return MatchPrediction(
            payment_id=payment["id"],
            installment_ids=[inst["id"]],
            confidence=confidence,
            method="rules",
            reason=f"{story}+name({best_nscore})vs({second_nscore})+fifo+global({total_same_amount})+students({len(same_amount_student_ids)})",
        )

    return MatchPrediction(
        payment_id=payment["id"],
        installment_ids=[],
        confidence=0.0,
        method="rules",
        reason=f"ambiguous:{len(candidates)}_candidates",
    )


# ---------------------------------------------------------------------------
# Scoring helpers
# ---------------------------------------------------------------------------

def _date_proximity(pay_date: date | None, due_date: date | None) -> int:
    """Score 0-100 for how close two dates are. Closer = higher. None = 50."""
    if pay_date is None or due_date is None:
        return 50
    days = abs((pay_date - due_date).days)
    return max(0, 100 - days)


def _name_score(payer_name: str, student_info: dict) -> int:
    """Score how well the payer name matches the student or their payer aliases.

    Returns a score 0-100. A score of 100 means exact payer_alias match.
    """
    if not payer_name:
        return 0

    payer_lower = payer_name.lower().strip()

    # Check for EXACT payer_alias match first (strongest signal)
    for alias in student_info.get("payer_aliases", []):
        if normalize_name(alias).lower().strip() == payer_lower:
            return 100

    # Check exact student name match
    if student_info.get("name"):
        if normalize_name(student_info["name"]).lower().strip() == payer_lower:
            return 100

    # Check exact alias match
    for alias in student_info.get("aliases", []):
        if normalize_name(alias).lower().strip() == payer_lower:
            return 100

    # Fuzzy matching (weaker signal)
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
            s1 = fuzz.token_sort_ratio(payer_lower, name.lower())
            s2 = fuzz.partial_ratio(payer_lower, name.lower())
            best = max(best, s1, s2)
        # Cap fuzzy-only matches at 90 to create a clear gap from exact (100)
        return min(best, 90)
    else:
        for name in names_to_check:
            if payer_lower in name.lower() or name.lower() in payer_lower:
                return 80
        payer_parts = payer_lower.split()
        for name in names_to_check:
            name_parts = name.lower().split()
            if payer_parts and name_parts and payer_parts[-1] == name_parts[-1]:
                return 60
        return 0


def _has_exact_alias(payer_name: str, student_info: dict) -> bool:
    """Check if payer_name exactly matches a registered payer_alias."""
    if not payer_name:
        return False
    payer_lower = payer_name.lower().strip()
    for alias in student_info.get("payer_aliases", []):
        if normalize_name(alias).lower().strip() == payer_lower:
            return True
    return False


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


def _get_enrollments(conn: sqlite3.Connection) -> dict[int, dict]:
    """Get enrollments as a dict keyed by enrollment id."""
    rows = conn.execute(
        "SELECT id, student_id, program, fee_model, total_fee_paise, "
        "currency, gst_applicable FROM enrollment"
    ).fetchall()
    return {r["id"]: dict(r) for r in rows}


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
