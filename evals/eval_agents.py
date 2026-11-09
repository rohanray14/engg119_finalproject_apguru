#!/usr/bin/env python3
"""Eval harness for non-matching agents: commissions, reminders, risk, copilot.

Usage:
    python evals/eval_agents.py --agent commissions
    python evals/eval_agents.py --agent reminders
    python evals/eval_agents.py --agent risk
    python evals/eval_agents.py --agent copilot
    python evals/eval_agents.py --all
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import date
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from agents.commissions import parse_terms, TDS_RATE
from agents.reminders import generate_reminders
from agents.risk import scan_risks
from agents.copilot import ask
from ledger.db import get_connection
from ledger.load import load_all

EVALS_DIR = PROJECT_ROOT / "evals"
DATA_DIR = PROJECT_ROOT / "data"


# ---------------------------------------------------------------------------
# Commissions eval
# ---------------------------------------------------------------------------

def eval_commissions() -> dict:
    """Evaluate parse_terms accuracy and payout math."""
    with open(EVALS_DIR / "commission_cases.json") as f:
        cases = json.load(f)

    # Part 1: parse_terms accuracy
    parse_results = []
    parse_correct = 0
    parse_total = len(cases["cases"])

    for c in cases["cases"]:
        rule = parse_terms(c["terms_text"])
        errors = []

        if abs(rule.rate - c["expected_rate"]) > 1e-9:
            errors.append(f"rate: got {rule.rate}, expected {c['expected_rate']}")
        if rule.scope != c["expected_scope"]:
            errors.append(f"scope: got {rule.scope}, expected {c['expected_scope']}")
        if c["expected_city"] is not None:
            if rule.city != c["expected_city"]:
                errors.append(f"city: got {rule.city}, expected {c['expected_city']}")
        elif rule.city is not None:
            errors.append(f"city: got {rule.city}, expected None")
        if c["expected_split"] is not None:
            if rule.split is None or abs(rule.split - c["expected_split"]) > 1e-9:
                errors.append(f"split: got {rule.split}, expected {c['expected_split']}")
        elif rule.split is not None:
            errors.append(f"split: got {rule.split}, expected None")

        correct = len(errors) == 0
        if correct:
            parse_correct += 1
        parse_results.append({
            "id": c["id"],
            "terms": c["terms_text"],
            "correct": correct,
            "errors": errors,
        })

    # Part 2: payout math exactness
    payout_results = []
    payout_correct = 0
    payout_total = len(cases["payout_cases"])

    for pc in cases["payout_cases"]:
        base = pc["base_paise"]
        rate = pc["rate"]
        split = pc["split"]

        commission = int(base * rate)
        if split is not None:
            commission = int(commission * split)
        tds = int(commission * TDS_RATE)
        net = commission - tds

        errors = []
        if commission != pc["expected_commission_paise"]:
            errors.append(f"commission: got {commission}, expected {pc['expected_commission_paise']}")
        if tds != pc["expected_tds_paise"]:
            errors.append(f"tds: got {tds}, expected {pc['expected_tds_paise']}")
        if net != pc["expected_net_paise"]:
            errors.append(f"net: got {net}, expected {pc['expected_net_paise']}")

        correct = len(errors) == 0
        if correct:
            payout_correct += 1
        payout_results.append({
            "id": pc["id"],
            "description": pc["description"],
            "correct": correct,
            "errors": errors,
        })

    parse_accuracy = parse_correct / parse_total if parse_total > 0 else 0
    payout_accuracy = payout_correct / payout_total if payout_total > 0 else 0

    return {
        "agent": "commissions",
        "parse_accuracy": parse_accuracy,
        "parse_correct": parse_correct,
        "parse_total": parse_total,
        "payout_accuracy": payout_accuracy,
        "payout_correct": payout_correct,
        "payout_total": payout_total,
        "parse_failures": [r for r in parse_results if not r["correct"]],
        "payout_failures": [r for r in payout_results if not r["correct"]],
    }


# ---------------------------------------------------------------------------
# Reminders eval
# ---------------------------------------------------------------------------

def eval_reminders() -> dict:
    """Evaluate reminder generation: correct families, amounts, dates, types."""
    conn = load_all(data_dir=DATA_DIR, db_path=":memory:")

    # Use a date that ensures some reminders fire
    as_of = date(2026, 6, 1)
    reminders = generate_reminders(conn, as_of=as_of)

    checks = {
        "total_generated": len(reminders),
        "all_have_student_name": True,
        "all_have_valid_type": True,
        "all_amounts_match_installment": True,
        "all_dates_follow_schedule": True,
        "no_reminders_for_paid": True,
        "all_messages_nonempty": True,
    }

    # Check paid installments don't get reminders
    paid_ids = {
        r["id"] for r in conn.execute(
            "SELECT id FROM installment WHERE status = 'paid'"
        ).fetchall()
    }
    reminder_inst_ids = {r.installment_id for r in reminders}
    paid_overlap = paid_ids & reminder_inst_ids
    if paid_overlap:
        checks["no_reminders_for_paid"] = False

    valid_types = {"pre_due", "on_due", "overdue"}
    valid_offsets = {-3, 0, 7}
    amount_mismatches = 0
    date_violations = 0

    for r in reminders:
        if not r.student_name:
            checks["all_have_student_name"] = False
        if r.reminder_type not in valid_types:
            checks["all_have_valid_type"] = False
        if not r.message:
            checks["all_messages_nonempty"] = False

        # Verify amount matches installment
        inst = conn.execute(
            "SELECT amount_due_paise, currency FROM installment WHERE id = ?",
            (r.installment_id,),
        ).fetchone()
        if inst:
            if r.amount_due_paise != inst["amount_due_paise"] or r.currency != inst["currency"]:
                checks["all_amounts_match_installment"] = False
                amount_mismatches += 1

        # Verify schedule offset
        if r.due_date is not None:
            offset = (r.scheduled_for - r.due_date).days
            if offset not in valid_offsets:
                checks["all_dates_follow_schedule"] = False
                date_violations += 1

    conn.close()

    passed = sum(1 for v in checks.values() if v is True or (isinstance(v, int) and v > 0))
    total_checks = len(checks) - 1  # exclude total_generated from pass/fail
    pass_rate = (passed - 1) / (total_checks) if total_checks > 0 else 0

    return {
        "agent": "reminders",
        "checks": checks,
        "amount_mismatches": amount_mismatches,
        "date_violations": date_violations,
        "paid_overlap": list(paid_overlap),
        "pass_rate": pass_rate,
    }


# ---------------------------------------------------------------------------
# Risk eval
# ---------------------------------------------------------------------------

def eval_risk() -> dict:
    """Evaluate risk scanning: planted problems → recall of planted issues."""
    conn = get_connection(":memory:")

    # Plant known problems
    conn.execute(
        "INSERT INTO student (id, name, city, country) VALUES (1, 'Test Student', 'Mumbai', 'India')"
    )
    conn.execute(
        "INSERT INTO student (id, name, city, country) VALUES (2, 'Other Student', 'Delhi', 'India')"
    )
    conn.execute(
        "INSERT INTO enrollment (id, student_id, program, fee_model, total_fee_paise, currency) "
        "VALUES (1, 1, 'SAT', 'package', 17700000, 'INR')"
    )

    # Planted: overdue installment (180 days overdue from as_of=2025-07-01)
    conn.execute(
        "INSERT INTO installment (id, enrollment_id, due_date, amount_due_paise, currency, status) "
        "VALUES (1, 1, '2025-01-01', 8850000, 'INR', 'overdue')"
    )

    # Planted: large unconfirmed payment (₹9,00,000 screenshot only)
    conn.execute(
        "INSERT INTO payment_in (id, source, payer_name, date, amount_paid_paise, currency, confirmation) "
        "VALUES (1, 'screenshot', 'Big Payer', '2025-06-01', 90000000, 'INR', 'screenshot_only')"
    )

    # Planted: duplicate payments
    conn.execute(
        "INSERT INTO payment_in (id, source, payer_name, date, amount_paid_paise, currency, confirmation) "
        "VALUES (2, 'bank', 'Dupe Payer', '2025-06-10', 5000000, 'INR', 'in_bank')"
    )
    conn.execute(
        "INSERT INTO payment_in (id, source, payer_name, date, amount_paid_paise, currency, confirmation) "
        "VALUES (3, 'bank', 'Dupe Payer', '2025-06-10', 5000000, 'INR', 'in_bank')"
    )

    # Planted: suspicious payer text
    conn.execute(
        "INSERT INTO payment_in (id, source, payer_name, date, amount_paid_paise, currency, confirmation) "
        "VALUES (4, 'bank', 'Please pay to new account', '2025-06-01', 1000000, 'INR', 'screenshot_only')"
    )

    # Planted: old unmatched payment (>14 days)
    conn.execute(
        "INSERT INTO payment_in (id, source, payer_name, date, amount_paid_paise, currency, confirmation) "
        "VALUES (5, 'bank', 'Old Payer', '2025-05-01', 3000000, 'INR', 'in_bank')"
    )

    # Planted: oversized payment (3x max installment = 3 * 8850000 = 26550000; payment is 30000000)
    conn.execute(
        "INSERT INTO payment_in (id, source, payer_name, date, amount_paid_paise, currency, confirmation) "
        "VALUES (6, 'bank', 'Huge Payer', '2025-06-15', 30000000, 'INR', 'in_bank')"
    )

    conn.commit()

    # Expected categories from planted problems
    expected_categories = {
        "unconfirmed_large",
        "duplicate_payment",
        "suspicious_payer",
        "overdue_installment",
        "unmatched_old",
        "oversized_payment",
    }

    flags = scan_risks(conn, as_of=date(2025, 7, 1))
    conn.close()

    found_categories = {f.category for f in flags}
    detected = expected_categories & found_categories
    missed = expected_categories - found_categories
    false_positives = found_categories - expected_categories

    recall = len(detected) / len(expected_categories) if expected_categories else 1.0

    return {
        "agent": "risk",
        "expected_categories": sorted(expected_categories),
        "detected_categories": sorted(detected),
        "missed_categories": sorted(missed),
        "false_positive_categories": sorted(false_positives),
        "total_flags": len(flags),
        "recall": recall,
        "severity_sorted": all(
            flags[i].severity <= flags[i + 1].severity
            or flags[i].severity == flags[i + 1].severity
            for i in range(len(flags) - 1)
        ) if len(flags) > 1 else True,
        "all_flags_valid": all(
            f.severity in ("high", "medium", "low") and f.category and f.entity and f.explanation
            for f in flags
        ),
    }


# ---------------------------------------------------------------------------
# Copilot eval
# ---------------------------------------------------------------------------

def eval_copilot() -> dict:
    """Evaluate copilot question answering against known patterns."""
    with open(EVALS_DIR / "copilot_cases.json") as f:
        cases = json.load(f)

    conn = load_all(data_dir=DATA_DIR, db_path=":memory:")

    results = []
    correct = 0
    total = len(cases["cases"])

    for c in cases["cases"]:
        ans = ask(conn, c["question"])
        errors = []

        # Check answer contains expected strings
        for expected in c.get("answer_contains", []):
            if expected.lower() not in ans.answer.lower():
                errors.append(f"missing '{expected}' in answer")

        # Check confidence
        if c["expected_pattern"] == "unknown":
            if ans.confidence != 0.0:
                errors.append(f"expected confidence=0 for unknown, got {ans.confidence}")
        elif c.get("expect_confidence_gt", 0) > 0:
            if ans.confidence <= 0:
                errors.append(f"expected confidence>0, got {ans.confidence}")

        is_correct = len(errors) == 0
        if is_correct:
            correct += 1
        results.append({
            "id": c["id"],
            "question": c["question"],
            "expected_pattern": c["expected_pattern"],
            "correct": is_correct,
            "errors": errors,
            "answer_preview": ans.answer[:100],
        })

    conn.close()

    accuracy = correct / total if total > 0 else 0

    return {
        "agent": "copilot",
        "accuracy": accuracy,
        "correct": correct,
        "total": total,
        "failures": [r for r in results if not r["correct"]],
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def print_result(result: dict):
    agent = result["agent"]
    print(f"\n{'='*60}")
    print(f"Eval: {agent}")
    print(f"{'='*60}")

    if agent == "commissions":
        print(f"Parse accuracy:  {result['parse_accuracy']:.0%} ({result['parse_correct']}/{result['parse_total']})")
        print(f"Payout accuracy: {result['payout_accuracy']:.0%} ({result['payout_correct']}/{result['payout_total']})")
        if result["parse_failures"]:
            print(f"\nParse failures:")
            for f in result["parse_failures"]:
                print(f"  #{f['id']} \"{f['terms']}\" → {', '.join(f['errors'])}")
        if result["payout_failures"]:
            print(f"\nPayout failures:")
            for f in result["payout_failures"]:
                print(f"  #{f['id']} {f['description']} → {', '.join(f['errors'])}")

    elif agent == "reminders":
        print(f"Pass rate: {result['pass_rate']:.0%}")
        for k, v in result["checks"].items():
            status = "PASS" if (v is True or (isinstance(v, int) and v > 0)) else "FAIL"
            if k == "total_generated":
                print(f"  {k}: {v}")
            else:
                print(f"  {k}: {status}")

    elif agent == "risk":
        print(f"Recall: {result['recall']:.0%} ({len(result['detected_categories'])}/{len(result['expected_categories'])})")
        print(f"Total flags: {result['total_flags']}")
        print(f"Severity sorted: {result['severity_sorted']}")
        if result["missed_categories"]:
            print(f"Missed: {result['missed_categories']}")
        if result["false_positive_categories"]:
            print(f"False positives: {result['false_positive_categories']}")

    elif agent == "copilot":
        print(f"Accuracy: {result['accuracy']:.0%} ({result['correct']}/{result['total']})")
        if result["failures"]:
            print(f"\nFailures:")
            for f in result["failures"]:
                print(f"  #{f['id']} \"{f['question']}\" ({f['expected_pattern']})")
                for e in f["errors"]:
                    print(f"    → {e}")

    print()


def main():
    parser = argparse.ArgumentParser(description="Run agent evals")
    parser.add_argument("--agent", choices=["commissions", "reminders", "risk", "copilot"],
                       help="Agent to evaluate")
    parser.add_argument("--all", action="store_true", help="Run all agent evals")
    args = parser.parse_args()

    if not args.agent and not args.all:
        args.all = True

    agents_to_run = []
    if args.all:
        agents_to_run = ["commissions", "reminders", "risk", "copilot"]
    else:
        agents_to_run = [args.agent]

    results = {}
    for agent in agents_to_run:
        if agent == "commissions":
            results[agent] = eval_commissions()
        elif agent == "reminders":
            results[agent] = eval_reminders()
        elif agent == "risk":
            results[agent] = eval_risk()
        elif agent == "copilot":
            results[agent] = eval_copilot()

        print_result(results[agent])

    # Summary
    if len(results) > 1:
        print(f"{'='*60}")
        print("SUMMARY")
        print(f"{'='*60}")
        if "commissions" in results:
            r = results["commissions"]
            print(f"  Commissions: parse {r['parse_accuracy']:.0%}, payout {r['payout_accuracy']:.0%}")
        if "reminders" in results:
            r = results["reminders"]
            print(f"  Reminders:   {r['pass_rate']:.0%} checks pass")
        if "risk" in results:
            r = results["risk"]
            print(f"  Risk:        {r['recall']:.0%} recall ({len(r['detected_categories'])}/{len(r['expected_categories'])} categories)")
        if "copilot" in results:
            r = results["copilot"]
            print(f"  Copilot:     {r['accuracy']:.0%} ({r['correct']}/{r['total']})")
        print()


if __name__ == "__main__":
    main()
