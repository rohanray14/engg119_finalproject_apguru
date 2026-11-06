"""AI-augmented payment matcher.

Pipeline (SPEC section 5):
1. Run rules first — high-confidence matches are kept as-is.
2. For remaining payments, shortlist ≤5 candidates in code using amount
   tolerance (GST/fee/FX/TDS), date window, and fuzzy name.
3. Call the Anthropic API for structured JSON: {installment_ids,
   allocations, confidence, reason} or "unsure".
4. Confidence ≥ threshold → auto-match; else → review queue.

Every LLM call is logged (input, output, model, tokens, latency) to logs/
and cached so re-running an eval is free and reproducible.
"""

from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import time
from datetime import date, timedelta
from pathlib import Path
from typing import Optional

from ledger.load import normalize_name
from ledger.money import add_gst, remove_gst, gateway_fee_with_gst, fx_convert
from evals.scoring import MatchPrediction

try:
    from rapidfuzz import fuzz
    HAS_RAPIDFUZZ = True
except ImportError:
    HAS_RAPIDFUZZ = False

try:
    import anthropic
    HAS_ANTHROPIC = True
except ImportError:
    HAS_ANTHROPIC = False

PROJECT_ROOT = Path(__file__).resolve().parent.parent
LOGS_DIR = PROJECT_ROOT / "logs"
CACHE_DIR = LOGS_DIR / "cache"

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

MODEL = "claude-sonnet-4-20250514"
MAX_CANDIDATES = 5
DATE_WINDOW_DAYS = 60
AMOUNT_TOLERANCE_PCT = 0.20   # ±20% to catch GST/fees/TDS differences
NAME_MIN_SCORE = 30           # lower bar for shortlisting (AI will judge)
HIGH_CONF_RULES = 0.90        # rules matches above this skip AI
AI_DEFAULT_CONFIDENCE = 0.85  # confidence assigned to AI "match" decisions


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def match_all(
    conn: sqlite3.Connection,
    threshold: float = 0.8,
    use_ai: bool = True,
) -> list[MatchPrediction]:
    """Run the full matching pipeline: rules first, then AI for the rest."""
    from agents.matching_rules import match_all as rules_match_all

    payments = _get_payments(conn)
    installments = _get_installments(conn)
    student_names = _get_student_names(conn)
    enrollments = _get_enrollments(conn)

    # Step 1: Rules pass
    rules_predictions = rules_match_all(conn)
    rules_by_pid = {p.payment_id: p for p in rules_predictions}

    predictions: list[MatchPrediction] = []
    ai_needed: list[dict] = []

    for pay in payments:
        pid = pay["id"]
        rules_pred = rules_by_pid.get(pid)

        if rules_pred and rules_pred.confidence >= HIGH_CONF_RULES and rules_pred.installment_ids:
            # High-confidence rules match — keep it
            predictions.append(rules_pred)
        else:
            ai_needed.append(pay)

    # Step 2+3: AI pass for remaining payments
    if use_ai and HAS_ANTHROPIC and os.environ.get("ANTHROPIC_API_KEY"):
        client = anthropic.Anthropic()
        for pay in ai_needed:
            pred = _ai_match_one(
                pay, installments, student_names, enrollments, client,
            )
            predictions.append(pred)
    else:
        # No API available — use rules predictions (possibly low confidence)
        for pay in ai_needed:
            pid = pay["id"]
            rules_pred = rules_by_pid.get(pid)
            if rules_pred:
                predictions.append(rules_pred)
            else:
                predictions.append(MatchPrediction(
                    payment_id=pid,
                    installment_ids=[],
                    confidence=0.0,
                    method="rules",
                    reason="no_api_key",
                ))

    return predictions


# ---------------------------------------------------------------------------
# Shortlisting (code-only, no LLM)
# ---------------------------------------------------------------------------

def _shortlist_candidates(
    payment: dict,
    installments: list[dict],
    student_names: dict[int, dict],
    enrollments: dict[int, dict],
) -> list[dict]:
    """Build a shortlist of ≤5 candidate installments for a payment.

    Uses amount tolerance (catches GST/fees/FX/TDS), date window, and
    fuzzy name matching.
    """
    pay_amount = payment["amount_paid_paise"]
    pay_currency = payment["currency"]
    pay_date = _parse_iso_date(payment["date"])
    payer_name = normalize_name(payment["payer_name"] or "")

    scored_candidates = []

    for inst in installments:
        inst_amount = inst["amount_due_paise"]
        inst_currency = inst["currency"]

        # Amount tolerance check (same currency or cross-currency)
        if inst_currency == pay_currency:
            if inst_amount == 0:
                continue
            ratio = abs(pay_amount - inst_amount) / inst_amount
            if ratio > AMOUNT_TOLERANCE_PCT:
                continue
            amount_score = max(0, 100 - int(ratio * 500))  # 0% diff → 100, 20% → 0
        elif pay_currency != "INR" and inst_currency == "INR":
            # Foreign payment → INR installment: convert and compare
            pay_inr = fx_convert(pay_amount, pay_currency, "INR")
            if inst_amount == 0:
                continue
            ratio = abs(pay_inr - inst_amount) / inst_amount
            if ratio > AMOUNT_TOLERANCE_PCT:
                continue
            amount_score = max(0, 100 - int(ratio * 500))
        elif pay_currency == "INR" and inst_currency != "INR":
            inst_inr = fx_convert(inst_amount, inst_currency, "INR")
            if inst_inr == 0:
                continue
            ratio = abs(pay_amount - inst_inr) / inst_inr
            if ratio > AMOUNT_TOLERANCE_PCT:
                continue
            amount_score = max(0, 100 - int(ratio * 500))
        else:
            continue

        # Date window
        date_score = 50  # neutral if no dates
        if pay_date:
            due = _parse_iso_date(inst["due_date"])
            if due:
                days_diff = abs((pay_date - due).days)
                if days_diff > DATE_WINDOW_DAYS:
                    continue
                date_score = max(0, 100 - int(days_diff * 100 / DATE_WINDOW_DAYS))

        # Name score
        student_id = inst["student_id"]
        sinfo = student_names.get(student_id, {})
        name_score = _name_score(payer_name, sinfo)

        # Combined score (weighted)
        total_score = amount_score * 3 + date_score + name_score * 2
        enroll = enrollments.get(inst["enrollment_id"], {})

        scored_candidates.append({
            "installment": inst,
            "student_info": sinfo,
            "enrollment": enroll,
            "amount_score": amount_score,
            "date_score": date_score,
            "name_score": name_score,
            "total_score": total_score,
        })

    # Sort by total score descending, take top N
    scored_candidates.sort(key=lambda x: x["total_score"], reverse=True)
    return scored_candidates[:MAX_CANDIDATES]


# ---------------------------------------------------------------------------
# AI matching (one payment at a time)
# ---------------------------------------------------------------------------

def _ai_match_one(
    payment: dict,
    installments: list[dict],
    student_names: dict[int, dict],
    enrollments: dict[int, dict],
    client: "anthropic.Anthropic",
) -> MatchPrediction:
    """Shortlist candidates in code, then ask the LLM to choose."""
    candidates = _shortlist_candidates(
        payment, installments, student_names, enrollments,
    )

    if not candidates:
        return MatchPrediction(
            payment_id=payment["id"],
            installment_ids=[],
            confidence=0.0,
            method="ai",
            reason="no_candidates_after_shortlist",
        )

    # Build the prompt
    prompt = _build_prompt(payment, candidates)

    # Check cache
    cache_key = _cache_key(prompt)
    cached = _read_cache(cache_key)
    if cached is not None:
        return _parse_ai_response(payment["id"], cached, candidates)

    # Call the API
    start = time.time()
    try:
        response = client.messages.create(
            model=MODEL,
            max_tokens=1024,
            messages=[{"role": "user", "content": prompt}],
            system=(
                "You are a payment-matching assistant for an Indian tutoring company. "
                "Given an incoming payment and a shortlist of candidate installments, "
                "decide which installment(s) the payment belongs to. "
                "Respond ONLY with valid JSON — no markdown, no explanation outside the JSON. "
                "Format: {\"installment_ids\": [...], \"confidence\": 0.0-1.0, \"reason\": \"...\"} "
                "or {\"unsure\": true, \"reason\": \"...\"} if you cannot decide."
            ),
        )
        latency_ms = int((time.time() - start) * 1000)
        output_text = response.content[0].text
        input_tokens = response.usage.input_tokens
        output_tokens = response.usage.output_tokens
    except Exception as e:
        _log_call(prompt, f"ERROR: {e}", MODEL, 0, 0, 0)
        return MatchPrediction(
            payment_id=payment["id"],
            installment_ids=[],
            confidence=0.0,
            method="ai",
            reason=f"api_error:{e}",
        )

    # Log and cache
    _log_call(prompt, output_text, MODEL, input_tokens, output_tokens, latency_ms)
    _write_cache(cache_key, output_text)

    return _parse_ai_response(payment["id"], output_text, candidates)


def _build_prompt(payment: dict, candidates: list[dict]) -> str:
    """Build the LLM prompt for one payment + its candidates."""
    currency = payment["currency"]
    amount_display = _format_amount(payment["amount_paid_paise"], currency)

    lines = [
        f"PAYMENT #{payment['id']}:",
        f"  Amount: {amount_display} ({currency})",
        f"  Payer: {payment['payer_name'] or '(blank)'}",
        f"  Date: {payment['date'] or '(unknown)'}",
        f"  Method: {payment['method'] or '(unknown)'}",
        f"  Source: {payment['source']}",
        "",
        "CANDIDATE INSTALLMENTS:",
    ]

    for i, cand in enumerate(candidates, 1):
        inst = cand["installment"]
        sinfo = cand["student_info"]
        enroll = cand["enrollment"]
        inst_amount = _format_amount(inst["amount_due_paise"], inst["currency"])

        lines.append(f"  [{i}] Installment #{inst['id']}:")
        lines.append(f"      Student: {sinfo.get('name', '?')}")
        payer_aliases = sinfo.get("payer_aliases", [])
        if payer_aliases:
            lines.append(f"      Known payers: {', '.join(payer_aliases)}")
        lines.append(f"      Program: {enroll.get('program', '?')} ({enroll.get('fee_model', '?')})")
        lines.append(f"      Amount due: {inst_amount} ({inst['currency']})")
        lines.append(f"      Due date: {inst['due_date'] or '(none)'}")
        lines.append(f"      Scores — amount: {cand['amount_score']}, "
                     f"name: {cand['name_score']}, date: {cand['date_score']}")
        lines.append("")

    lines.append(
        "Which installment(s) does this payment belong to? "
        "Consider: payer name vs student/parent name, amount match "
        "(accounting for GST, gateway fees, FX, TDS), date proximity. "
        "If a parent is paying for multiple children, list all matching installments. "
        "If truly ambiguous, say unsure."
    )

    return "\n".join(lines)


def _parse_ai_response(
    payment_id: int,
    response_text: str,
    candidates: list[dict],
) -> MatchPrediction:
    """Parse the LLM's JSON response into a MatchPrediction."""
    try:
        # Strip markdown code fences if present
        text = response_text.strip()
        if text.startswith("```"):
            text = text.split("\n", 1)[1] if "\n" in text else text[3:]
            if text.endswith("```"):
                text = text[:-3]
            text = text.strip()

        data = json.loads(text)
    except json.JSONDecodeError:
        return MatchPrediction(
            payment_id=payment_id,
            installment_ids=[],
            confidence=0.0,
            method="ai",
            reason=f"json_parse_error: {response_text[:200]}",
        )

    if data.get("unsure"):
        return MatchPrediction(
            payment_id=payment_id,
            installment_ids=[],
            confidence=0.0,
            method="ai",
            reason=data.get("reason", "unsure"),
        )

    inst_ids = data.get("installment_ids", [])
    confidence = float(data.get("confidence", AI_DEFAULT_CONFIDENCE))
    reason = data.get("reason", "")

    # Validate that returned IDs are in our candidate list
    valid_ids = {c["installment"]["id"] for c in candidates}
    inst_ids = [iid for iid in inst_ids if iid in valid_ids]

    if not inst_ids:
        return MatchPrediction(
            payment_id=payment_id,
            installment_ids=[],
            confidence=0.0,
            method="ai",
            reason=f"no_valid_ids_in_response: {reason}",
        )

    return MatchPrediction(
        payment_id=payment_id,
        installment_ids=inst_ids,
        confidence=min(confidence, 1.0),
        method="ai",
        reason=reason,
    )


# ---------------------------------------------------------------------------
# Logging & caching
# ---------------------------------------------------------------------------

def _log_call(
    prompt: str, output: str, model: str,
    input_tokens: int, output_tokens: int, latency_ms: int,
):
    """Append one LLM call to the log file."""
    LOGS_DIR.mkdir(parents=True, exist_ok=True)
    log_entry = {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "model": model,
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "latency_ms": latency_ms,
        "prompt_preview": prompt[:500],
        "output_preview": output[:500],
    }
    log_path = LOGS_DIR / "llm_calls.jsonl"
    with open(log_path, "a") as f:
        f.write(json.dumps(log_entry) + "\n")


def _cache_key(prompt: str) -> str:
    return hashlib.sha256(prompt.encode()).hexdigest()


def _read_cache(key: str) -> Optional[str]:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path = CACHE_DIR / f"{key}.json"
    if path.exists():
        with open(path) as f:
            return f.read()
    return None


def _write_cache(key: str, response: str):
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path = CACHE_DIR / f"{key}.json"
    with open(path, "w") as f:
        f.write(response)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _format_amount(paise: int, currency: str) -> str:
    if currency == "INR":
        rupees = paise / 100
        return f"₹{rupees:,.0f}"
    elif currency == "USD":
        return f"${paise / 100:,.0f}"
    elif currency == "AED":
        return f"AED {paise / 100:,.0f}"
    return f"{paise / 100:,.0f} {currency}"


def _name_score(payer_name: str, student_info: dict) -> int:
    """Score payer name against student/alias/payer names."""
    if not payer_name:
        return 0
    names = []
    if student_info.get("name"):
        names.append(normalize_name(student_info["name"]))
    for alias in student_info.get("payer_aliases", []):
        names.append(normalize_name(alias))
    for alias in student_info.get("aliases", []):
        names.append(normalize_name(alias))
    if not names:
        return 0
    if HAS_RAPIDFUZZ:
        best = 0
        for name in names:
            s1 = fuzz.token_sort_ratio(payer_name.lower(), name.lower())
            s2 = fuzz.partial_ratio(payer_name.lower(), name.lower())
            best = max(best, s1, s2)
        return best
    else:
        payer_lower = payer_name.lower()
        for name in names:
            if payer_lower == name.lower():
                return 100
            if payer_lower in name.lower() or name.lower() in payer_lower:
                return 80
        payer_parts = payer_lower.split()
        for name in names:
            name_parts = name.lower().split()
            if payer_parts and name_parts and payer_parts[-1] == name_parts[-1]:
                return 60
        return 0


def _parse_iso_date(val: str | None) -> date | None:
    if not val:
        return None
    try:
        return date.fromisoformat(val)
    except (ValueError, TypeError):
        return None


def _get_payments(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute(
        "SELECT id, source, method, payer_name, date, "
        "amount_paid_paise, currency, case_types "
        "FROM payment_in"
    ).fetchall()
    return [dict(r) for r in rows]


def _get_installments(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute(
        "SELECT i.id, i.enrollment_id, i.due_date, i.amount_due_paise, "
        "i.currency, i.status, e.student_id "
        "FROM installment i "
        "JOIN enrollment e ON i.enrollment_id = e.id"
    ).fetchall()
    return [dict(r) for r in rows]


def _get_student_names(conn: sqlite3.Connection) -> dict[int, dict]:
    rows = conn.execute(
        "SELECT id, name, aliases, payer_aliases FROM student"
    ).fetchall()
    result = {}
    for r in rows:
        result[r["id"]] = {
            "name": r["name"],
            "aliases": _parse_json_list(r["aliases"]),
            "payer_aliases": _parse_json_list(r["payer_aliases"]),
        }
    return result


def _get_enrollments(conn: sqlite3.Connection) -> dict[int, dict]:
    rows = conn.execute(
        "SELECT id, student_id, program, fee_model, total_fee_paise, currency, gst_applicable "
        "FROM enrollment"
    ).fetchall()
    return {r["id"]: dict(r) for r in rows}


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
