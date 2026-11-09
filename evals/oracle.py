"""Oracle analysis: for each payment, can the correct installment(s) be told
apart from the others using only observable fields?

Reports identifiable_rate and coverage as a share of identifiable payments.
"""

from __future__ import annotations

import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from ledger.load import load_all, normalize_name
from ledger.money import fx_convert


def oracle_analysis(split: str = "dev") -> dict:
    """Run oracle analysis on the given split."""
    data_dir = PROJECT_ROOT / "data"
    split_dir = data_dir / split
    answers_path = split_dir / "answers.json"

    with open(answers_path) as f:
        answers = json.load(f)

    conn = load_all(data_dir=data_dir, db_path=":memory:")

    # Build lookups
    installments = {}
    for row in conn.execute(
        "SELECT i.id, i.enrollment_id, i.due_date, i.amount_due_paise, "
        "i.currency, e.student_id "
        "FROM installment i JOIN enrollment e ON i.enrollment_id = e.id"
    ).fetchall():
        installments[row["id"]] = dict(row)

    student_names = {}
    for row in conn.execute("SELECT id, name, payer_aliases FROM student").fetchall():
        aliases = []
        try:
            aliases = json.loads(row["payer_aliases"]) if row["payer_aliases"] else []
        except (json.JSONDecodeError, TypeError):
            pass
        student_names[row["id"]] = {
            "name": row["name"],
            "payer_aliases": aliases,
        }

    payments = {}
    for row in conn.execute(
        "SELECT id, payer_name, amount_paid_paise, currency, date FROM payment_in"
    ).fetchall():
        payments[row["id"]] = dict(row)

    conn.close()

    # For each answer, check if the correct installment(s) can be uniquely identified
    identifiable = 0
    not_identifiable = 0
    reasons: Counter = Counter()

    for ans in answers:
        pid = ans["payment_id"]
        correct_iids = set(ans["installment_ids"])
        pay = payments.get(pid)
        if not pay:
            not_identifiable += 1
            reasons["payment_not_found"] += 1
            continue

        pay_amount = pay["amount_paid_paise"]
        pay_currency = pay["currency"]
        payer_name = normalize_name(pay.get("payer_name") or "")

        # Find all installments with matching amount+currency
        same_amount = []
        for iid, inst in installments.items():
            if inst["amount_due_paise"] == pay_amount and inst["currency"] == pay_currency:
                same_amount.append(iid)
            elif pay_currency != "INR" and inst["currency"] == "INR":
                pay_inr = fx_convert(pay_amount, pay_currency, "INR")
                if abs(pay_inr - inst["amount_due_paise"]) / max(inst["amount_due_paise"], 1) < 0.05:
                    same_amount.append(iid)

        if len(same_amount) <= 1:
            # Unique amount — identifiable
            identifiable += 1
            continue

        # Multiple candidates with same amount. Can payer name disambiguate?
        if payer_name:
            # Check if name uniquely identifies the correct student(s)
            correct_students = set()
            for iid in correct_iids:
                inst = installments.get(iid)
                if inst:
                    correct_students.add(inst["student_id"])

            name_matches = set()
            for iid in same_amount:
                inst = installments[iid]
                sid = inst["student_id"]
                sinfo = student_names.get(sid, {})
                all_names = [normalize_name(sinfo.get("name", ""))]
                all_names.extend(normalize_name(a) for a in sinfo.get("payer_aliases", []))

                for n in all_names:
                    if n and payer_name.lower() == n.lower():
                        name_matches.add(sid)
                        break
                    if n and (payer_name.lower() in n.lower() or n.lower() in payer_name.lower()):
                        name_matches.add(sid)
                        break

            if name_matches == correct_students and len(name_matches) > 0:
                identifiable += 1
                continue

        # Cannot be uniquely identified
        not_identifiable += 1
        case_types = ans.get("case_types", [])
        for ct in case_types:
            reasons[ct] += 1

    total = len(answers)
    identifiable_rate = identifiable / total if total else 0
    not_identifiable_rate = not_identifiable / total if total else 0

    return {
        "split": split,
        "total": total,
        "identifiable": identifiable,
        "not_identifiable": not_identifiable,
        "identifiable_rate": round(identifiable_rate, 4),
        "not_identifiable_reasons": dict(reasons.most_common()),
    }


if __name__ == "__main__":
    split = sys.argv[1] if len(sys.argv) > 1 else "dev"
    result = oracle_analysis(split)
    print(f"\nOracle Analysis ({split} split)")
    print(f"{'='*50}")
    print(f"Total payments:      {result['total']}")
    print(f"Identifiable:        {result['identifiable']} ({result['identifiable_rate']:.1%})")
    print(f"Not identifiable:    {result['not_identifiable']}")
    print(f"\nReasons for non-identifiability:")
    for reason, count in result["not_identifiable_reasons"].items():
        print(f"  {reason}: {count}")
    print()
