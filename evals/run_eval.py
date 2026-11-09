#!/usr/bin/env python3
"""Eval harness for payment-matching agents.

Usage:
    python evals/run_eval.py --agent matching --split dev
    python evals/run_eval.py --agent matching_ai --split dev --threshold 0.8
    python evals/run_eval.py --agent matching --split test --threshold 0.8
    python evals/run_eval.py --agent matching --split safety

Loads the specified split's answer key, runs the specified agent, scores
the results, and saves a report to results/.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from evals.scoring import score, MatchPrediction
from ledger.load import load_all


def _load_safety_cases(conn, safety_path: Path):
    """Insert safety-case students, enrollments, installments, and payments
    into the database so the matcher sees them alongside normal data."""
    with open(safety_path) as f:
        cases = json.load(f)

    for s in cases["students"]:
        conn.execute(
            "INSERT OR REPLACE INTO student (id, name, aliases, city, country, counselor_ids, payer_aliases) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (s["id"], s["name"], json.dumps(s.get("aliases", [])),
             s.get("city", ""), s.get("country", ""),
             json.dumps(s.get("counselor_ids", [])),
             json.dumps(s.get("payer_aliases", []))),
        )
    for e in cases["enrollments"]:
        conn.execute(
            "INSERT OR REPLACE INTO enrollment "
            "(id, student_id, program, fee_model, total_fee_paise, currency, gst_applicable) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (e["id"], e["student_id"], e["program"], e["fee_model"],
             e["total_fee_paise"], e["currency"],
             int(e.get("gst_applicable", True))),
        )
    for i in cases["installments"]:
        conn.execute(
            "INSERT OR REPLACE INTO installment "
            "(id, enrollment_id, due_date, amount_due_paise, currency, status) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (i["id"], i["enrollment_id"], i.get("due_date"),
             i["amount_due_paise"], i["currency"], i.get("status", "open")),
        )
    for p in cases["payments"]:
        conn.execute(
            "INSERT OR REPLACE INTO payment_in "
            "(id, source, method, payer_name, date, amount_paid_paise, currency, "
            " gateway_fee_paise, gst_on_fee_paise, fx_diff_paise, tds_paise, "
            " amount_in_bank_paise, confirmation) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (p["id"], p["source"], p.get("method"),
             p.get("payer_name"), p.get("date"),
             p["amount_paid_paise"], p["currency"],
             p.get("gateway_fee_paise", 0), p.get("gst_on_fee_paise", 0),
             p.get("fx_diff_paise", 0), p.get("tds_paise", 0),
             p.get("amount_in_bank_paise", 0),
             p.get("confirmation", "screenshot_only")),
        )
    conn.commit()
    return cases["answers"]


def run_matching_eval(
    split: str = "dev",
    threshold: float = 0.8,
    agent: str = "matching",
) -> dict:
    """Run a matcher eval on the given split.

    agent='matching' → rules only; agent='matching_ai' → rules + AI.
    split='safety' → run on hand-crafted safety cases.
    """
    data_dir = PROJECT_ROOT / "data"
    safety_path = PROJECT_ROOT / "evals" / "safety_cases.json"

    if split == "safety":
        # Load normal data + safety data together
        conn = load_all(data_dir=data_dir, db_path=":memory:")
        answers = _load_safety_cases(conn, safety_path)
    else:
        split_dir = data_dir / split
        answers_path = split_dir / "answers.json"
        if not answers_path.exists():
            print(f"Error: {answers_path} not found. Run data/generate.py first.")
            sys.exit(1)
        with open(answers_path) as f:
            answers = json.load(f)
        conn = load_all(data_dir=data_dir, db_path=":memory:")

    # Run the matcher
    start_time = time.time()
    if agent == "matching_ai":
        from agents.matching_ai import match_all
        predictions = match_all(conn, threshold=threshold)
        agent_name = "matching_ai"
    else:
        from agents.matching_rules import match_all
        predictions = match_all(conn)
        agent_name = "matching_rules"
    latency_ms = int((time.time() - start_time) * 1000)
    conn.close()

    # Filter predictions to only those in this split's answer set
    split_payment_ids = {a["payment_id"] for a in answers}
    split_predictions = [p for p in predictions if p.payment_id in split_payment_ids]

    # Score
    result = score(split_predictions, answers, confidence_threshold=threshold)

    # For safety split, also check expect_confident flag
    safety_violations = []
    if split == "safety":
        pred_map = {p.payment_id: p for p in split_predictions}
        for ans in answers:
            pid = ans["payment_id"]
            expect_confident = ans.get("expect_confident", True)
            pred = pred_map.get(pid)
            if not expect_confident and pred and pred.confidence >= threshold and pred.installment_ids:
                safety_violations.append({
                    "payment_id": pid,
                    "case_types": ans["case_types"],
                    "predicted_ids": pred.installment_ids,
                    "confidence": pred.confidence,
                    "reason": pred.reason,
                    "expected_reason": ans.get("reason", ""),
                })

    report = _build_report(result, split, threshold, len(predictions), agent_name, latency_ms=latency_ms)
    if split == "safety":
        report["safety_violations"] = safety_violations
        report["safety_violation_count"] = len(safety_violations)
    return report


def _get_git_sha() -> str:
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=str(PROJECT_ROOT), stderr=subprocess.DEVNULL,
        ).decode().strip()
    except Exception:
        return "unknown"


def _get_data_hash() -> str:
    """SHA256 of all data files used for eval."""
    h = hashlib.sha256()
    for f in sorted((PROJECT_ROOT / "data").glob("*.csv")):
        h.update(f.read_bytes())
    for f in sorted((PROJECT_ROOT / "data").glob("*.json")):
        h.update(f.read_bytes())
    return h.hexdigest()[:16]


def _build_report(
    result, split: str, threshold: float, total_predictions: int,
    agent_name: str = "matching_rules",
    latency_ms: int = 0, cost_estimate: float = 0.0,
) -> dict:
    """Build the eval report dict."""
    summary = result.summary_dict()
    case_table = result.case_type_table()

    from config import CONFIG
    report = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "git_sha": _get_git_sha(),
        "agent": agent_name,
        "model": CONFIG.model if agent_name == "matching_ai" else "n/a",
        "split": split,
        "threshold": threshold,
        "data_hash": _get_data_hash(),
        "total_predictions": total_predictions,
        "latency_ms": latency_ms,
        "cost_estimate_usd": round(cost_estimate, 4),
        "summary": summary,
        "case_type_table": case_table,
    }
    return report


def print_report(report: dict):
    """Pretty-print the eval report."""
    s = report["summary"]
    print(f"\n{'='*60}")
    print(f"Eval: {report['agent']} | split={report['split']} | threshold={report['threshold']}")
    print(f"{'='*60}")
    print(f"Total answers:     {s['total']}")
    print(f"Attempted:         {s['attempted']}")
    print(f"Correct:           {s['correct']}")
    print(f"Wrong confident:   {s['wrong_confident']}")
    print(f"Skipped:           {s['skipped']}")
    print(f"Precision:         {s['precision']:.2%}")
    print(f"Coverage:          {s['coverage']:.2%}")

    ct = report["case_type_table"]
    if ct:
        print(f"\n{'Case Type':<40} {'Total':>6} {'Tried':>6} {'Right':>6} {'Wrong':>6} {'Prec':>8} {'Cover':>8}")
        print(f"{'-'*40} {'-'*6} {'-'*6} {'-'*6} {'-'*6} {'-'*8} {'-'*8}")
        for row in ct:
            print(f"{row['case_type']:<40} {row['total']:>6} {row['attempted']:>6} "
                  f"{row['correct']:>6} {row['wrong']:>6} "
                  f"{row['precision']:>7.2%} {row['coverage']:>7.2%}")

    # Safety violations
    violations = report.get("safety_violations", [])
    if report.get("split") == "safety":
        n = report.get("safety_violation_count", 0)
        print(f"\nSafety violations (confident on must-not-be-confident): {n}")
        if violations:
            for v in violations:
                print(f"  Payment {v['payment_id']}: {v['case_types']} "
                      f"→ predicted {v['predicted_ids']} (conf={v['confidence']:.2f})")
                print(f"    reason: {v['reason']}")
                print(f"    expected: {v['expected_reason']}")
        else:
            print("  PASS — no safety violations")
    print()


def save_report(report: dict):
    """Save the eval report to results/."""
    results_dir = PROJECT_ROOT / "results"
    results_dir.mkdir(exist_ok=True)

    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    filename = f"{report['agent']}_{report['split']}_{ts}.json"
    path = results_dir / filename

    with open(path, "w") as f:
        json.dump(report, f, indent=2)

    print(f"Report saved to {path}")

    # Also save a markdown summary
    md_path = path.with_suffix(".md")
    s = report["summary"]
    lines = [
        f"# Eval: {report['agent']} ({report['split']})",
        f"",
        f"- **Precision:** {s['precision']:.2%}",
        f"- **Coverage:** {s['coverage']:.2%}",
        f"- **Wrong confident:** {s['wrong_confident']}",
        f"- **Threshold:** {report['threshold']}",
        f"- **Timestamp:** {report['timestamp']}",
        f"",
        f"## Per case type",
        f"",
        f"| Case Type | Total | Tried | Right | Wrong | Precision | Coverage |",
        f"|---|---|---|---|---|---|---|",
    ]
    for row in report["case_type_table"]:
        lines.append(
            f"| {row['case_type']} | {row['total']} | {row['attempted']} | "
            f"{row['correct']} | {row['wrong']} | "
            f"{row['precision']:.2%} | {row['coverage']:.2%} |"
        )
    lines.append("")

    with open(md_path, "w") as f:
        f.write("\n".join(lines))


def compare_runs(path_a: str, path_b: str):
    """Print a diff table comparing two eval runs."""
    with open(path_a) as f:
        a = json.load(f)
    with open(path_b) as f:
        b = json.load(f)

    sa, sb = a["summary"], b["summary"]
    print(f"\n{'Metric':<25} {'Run A':>12} {'Run B':>12} {'Delta':>12}")
    print(f"{'-'*25} {'-'*12} {'-'*12} {'-'*12}")
    for key in ["total", "attempted", "correct", "wrong_confident", "skipped"]:
        va, vb = sa[key], sb[key]
        print(f"{key:<25} {va:>12} {vb:>12} {vb - va:>+12}")
    for key in ["precision", "coverage"]:
        va, vb = sa[key], sb[key]
        print(f"{key:<25} {va:>11.2%} {vb:>11.2%} {vb - va:>+11.2%}")
    print(f"\nA: {a.get('agent', '?')} ({a.get('git_sha', '?')}) @ {a.get('threshold', '?')}")
    print(f"B: {b.get('agent', '?')} ({b.get('git_sha', '?')}) @ {b.get('threshold', '?')}")
    print()


def main():
    parser = argparse.ArgumentParser(description="Run payment-matching eval")
    parser.add_argument("--agent", default="matching",
                       choices=["matching", "matching_ai"],
                       help="Agent to evaluate (matching=rules only, matching_ai=rules+AI)")
    parser.add_argument("--split", default="dev", choices=["dev", "test", "safety"],
                       help="Data split to evaluate on")
    parser.add_argument("--threshold", type=float, default=None,
                       help="Confidence threshold for auto-match (default: from config.py)")
    parser.add_argument("--compare", nargs=2, metavar=("RUN_A", "RUN_B"),
                       help="Compare two eval result JSON files")
    args = parser.parse_args()

    if args.compare:
        compare_runs(args.compare[0], args.compare[1])
        return

    from config import CONFIG
    threshold = args.threshold if args.threshold is not None else CONFIG.matching.auto_match_threshold
    report = run_matching_eval(
        split=args.split, threshold=threshold, agent=args.agent,
    )

    print_report(report)
    save_report(report)


if __name__ == "__main__":
    main()
