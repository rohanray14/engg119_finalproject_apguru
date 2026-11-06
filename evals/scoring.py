"""Scoring functions for payment-matching evals.

Compares matcher predictions against the answer key and computes:
- precision of auto-matches (confident predictions that are correct)
- coverage (fraction of payments the matcher attempted to match)
- wrong_confident (confident predictions that are wrong — worst metric)
- per-case-type breakdown
"""

from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass, field


@dataclass
class MatchPrediction:
    """One matcher prediction for a payment."""
    payment_id: int
    installment_ids: list[int]  # predicted installment IDs
    confidence: float           # 0.0–1.0
    method: str = "rules"
    reason: str = ""


@dataclass
class EvalResult:
    """Aggregate evaluation result."""
    total: int = 0
    attempted: int = 0          # matcher returned a prediction (not "unsure")
    correct: int = 0            # predicted installment_ids exactly match answer
    wrong_confident: int = 0    # confident but wrong
    skipped: int = 0            # matcher said "unsure"

    # Per case-type breakdown
    case_type_total: dict[str, int] = field(default_factory=lambda: Counter())
    case_type_attempted: dict[str, int] = field(default_factory=lambda: Counter())
    case_type_correct: dict[str, int] = field(default_factory=lambda: Counter())
    case_type_wrong: dict[str, int] = field(default_factory=lambda: Counter())

    @property
    def precision(self) -> float:
        """Fraction of attempted matches that are correct."""
        return self.correct / self.attempted if self.attempted else 0.0

    @property
    def coverage(self) -> float:
        """Fraction of total payments the matcher attempted."""
        return self.attempted / self.total if self.total else 0.0

    def summary_dict(self) -> dict:
        return {
            "total": self.total,
            "attempted": self.attempted,
            "correct": self.correct,
            "wrong_confident": self.wrong_confident,
            "skipped": self.skipped,
            "precision": round(self.precision, 4),
            "coverage": round(self.coverage, 4),
        }

    def case_type_table(self) -> list[dict]:
        """Return a list of dicts for the per-case-type breakdown."""
        all_types = sorted(set(self.case_type_total.keys()))
        rows = []
        for ct in all_types:
            total = self.case_type_total[ct]
            attempted = self.case_type_attempted[ct]
            correct = self.case_type_correct[ct]
            wrong = self.case_type_wrong[ct]
            rows.append({
                "case_type": ct,
                "total": total,
                "attempted": attempted,
                "correct": correct,
                "wrong": wrong,
                "precision": round(correct / attempted, 4) if attempted else 0.0,
                "coverage": round(attempted / total, 4) if total else 0.0,
            })
        return rows


def score(
    predictions: list[MatchPrediction],
    answers: list[dict],
    confidence_threshold: float = 0.8,
) -> EvalResult:
    """Score a list of matcher predictions against the answer key.

    A prediction is "attempted" if confidence >= threshold.
    A prediction is "correct" if the predicted installment_ids set matches
    the answer's installment_ids set exactly.
    """
    answer_map = {a["payment_id"]: a for a in answers}
    pred_map = {p.payment_id: p for p in predictions}

    result = EvalResult()
    result.total = len(answers)

    for ans in answers:
        pid = ans["payment_id"]
        case_types = ans.get("case_types", [])
        for ct in case_types:
            result.case_type_total[ct] += 1

        pred = pred_map.get(pid)
        if pred is None or pred.confidence < confidence_threshold:
            result.skipped += 1
            continue

        result.attempted += 1
        for ct in case_types:
            result.case_type_attempted[ct] += 1

        # Check correctness: installment_ids must match exactly as sets
        pred_ids = set(pred.installment_ids)
        ans_ids = set(ans["installment_ids"])

        if pred_ids == ans_ids:
            result.correct += 1
            for ct in case_types:
                result.case_type_correct[ct] += 1
        else:
            result.wrong_confident += 1
            for ct in case_types:
                result.case_type_wrong[ct] += 1

    return result
