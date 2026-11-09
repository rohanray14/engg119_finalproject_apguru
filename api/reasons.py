"""Turn the matcher's internal reason codes into plain English.

Moved from the Streamlit review page so the API returns readable reasons.
"""

import re


def format_match_reason(reason_str: str) -> str:
    """Convert internal reason codes to human-readable text.

    Examples of internal codes:
        "exact_amount+name_match(85)+global(3)"
        "amount+name(100.0)_vs_second(47.6)+fifo+global(11)"
        "blank_payer+3_same_amount"
        "exact_amount+blank_payer+globally_unique"
        "no_amount_match"
        "ambiguous:5_candidates"
        "no_candidates_after_shortlist"
        "api_error:..."
        "json_parse_error: ..."
        "manually_assigned"
        "suspicious_payer_text"
        "invalid_amount"
        "payment_date_too_old"
    """
    if not reason_str:
        return "No reason provided"

    r = reason_str.strip()

    # Simple known tokens
    if r == "manually_assigned":
        return "Manually assigned by a user"
    if r == "no_amount_match":
        return "No installment matches the payment amount"
    if r == "invalid_amount":
        return "Payment amount is invalid"
    if r == "suspicious_payer_text":
        return "Payer name looks suspicious or invalid"
    if r == "payment_date_too_old":
        return "Payment date is too far in the past"
    if r == "no_candidates_after_shortlist":
        return "No viable candidates remained after shortlisting"
    if r == "no_api_key":
        return "AI matching skipped (no API key configured)"
    if r.startswith("api_error:"):
        return "AI matching failed due to an API error"
    if r.startswith("json_parse_error"):
        return "AI matching failed (could not parse response)"
    if r.startswith("no_valid_ids_in_response"):
        return "AI returned installment IDs that don't exist"

    # Ambiguous
    m = re.match(r"ambiguous:(\d+)_candidates", r)
    if m:
        return f"Ambiguous: {m.group(1)} candidates with similar amounts"

    # Composite reasons built with '+' separators
    parts = []

    if "exact_amount" in r or r.startswith("amount"):
        parts.append("Payment amount matches an installment exactly")

    # name_match(score) or name(score)_vs_second(score)
    nm = re.search(r"name(?:_match)?\(([0-9.]+)\)", r)
    if nm:
        score = float(nm.group(1))
        parts.append(f"Payer name similarity: {score:.0f}%")

    vs = re.search(r"vs_second\(([0-9.]+)\)", r)
    if vs:
        second = float(vs.group(1))
        parts.append(f"Next-best name match: {second:.0f}%")

    if "weak_name" in r:
        wn = re.search(r"weak_name\(([0-9.]+)\)", r)
        score_val = float(wn.group(1)) if wn else 0
        parts.append(f"Payer name is a weak match ({score_val:.0f}%)")

    if "blank_payer" in r:
        parts.append("Payer name was blank on the bank statement")

    if "globally_unique" in r:
        parts.append("Only one installment matches this amount globally")

    gm = re.search(r"global\((\d+)\)", r)
    if gm:
        count = int(gm.group(1))
        parts.append(f"{count} installments share this amount across all students")

    bm = re.search(r"(\d+)_same_amount", r)
    if bm and not gm:
        count = int(bm.group(1))
        parts.append(f"{count} installments share this amount")

    if "fifo" in r.lower() or "FIFO" in r:
        parts.append("Earliest due date selected (FIFO)")

    # AI free-text reason (from the LLM) -- if none of the patterns matched
    if not parts:
        return r

    return ". ".join(parts) + "."
