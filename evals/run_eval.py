#!/usr/bin/env python3
"""Eval harness for payment-matching agents.

Usage:
    python evals/run_eval.py --agent matching --split dev
    python evals/run_eval.py --agent matching --split test --threshold 0.8

Loads the specified split's answer key, runs the specified agent, scores
the results, and saves a report to results/.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from evals.scoring import score, MatchPrediction
from ledger.load import load_all


def run_matching_eval(
    split: str = "dev",
    threshold: float = 0.8,
) -> dict:
    """Run the rules-based matcher eval on the given split."""
    data_dir = PROJECT_ROOT / "data"
    split_dir = data_dir / split
    answers_path = split_dir / "answers.json"

    if not answers_path.exists():
        print(f"Error: {answers_path} not found. Run data/generate.py first.")
        sys.exit(1)

    with open(answers_path) as f:
        answers = json.load(f)

    # Load data into an in-memory database
    conn = load_all(data_dir=data_dir, db_path=":memory:")

    # Run the matcher
    from agents.matching_rules import match_all
    predictions = match_all(conn)
    conn.close()

    # Filter predictions to only those in this split's answer set
    split_payment_ids = {a["payment_id"] for a in answers}
    split_predictions = [p for p in predictions if p.payment_id in split_payment_ids]

    # Score
    result = score(split_predictions, answers, confidence_threshold=threshold)

    return _build_report(result, split, threshold, len(predictions))


def _build_report(result, split: str, threshold: float, total_predictions: int) -> dict:
    """Build the eval report dict."""
    summary = result.summary_dict()
    case_table = result.case_type_table()

    report = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "agent": "matching_rules",
        "split": split,
        "threshold": threshold,
        "total_predictions": total_predictions,
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
        print(f"\n{'Case Type':<25} {'Total':>6} {'Tried':>6} {'Right':>6} {'Wrong':>6} {'Prec':>8} {'Cover':>8}")
        print(f"{'-'*25} {'-'*6} {'-'*6} {'-'*6} {'-'*6} {'-'*8} {'-'*8}")
        for row in ct:
            print(f"{row['case_type']:<25} {row['total']:>6} {row['attempted']:>6} "
                  f"{row['correct']:>6} {row['wrong']:>6} "
                  f"{row['precision']:>7.2%} {row['coverage']:>7.2%}")
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


def main():
    parser = argparse.ArgumentParser(description="Run payment-matching eval")
    parser.add_argument("--agent", default="matching", choices=["matching"],
                       help="Agent to evaluate")
    parser.add_argument("--split", default="dev", choices=["dev", "test"],
                       help="Data split to evaluate on")
    parser.add_argument("--threshold", type=float, default=0.8,
                       help="Confidence threshold for auto-match")
    args = parser.parse_args()

    if args.agent == "matching":
        report = run_matching_eval(split=args.split, threshold=args.threshold)

    print_report(report)
    save_report(report)


if __name__ == "__main__":
    main()
