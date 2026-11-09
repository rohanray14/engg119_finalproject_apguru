"""How much of each installment has been paid, and applying a payment to it.

Deterministic code only (CLAUDE.md rule 1).  An installment's paid-to-date is
the sum of ``allocated_paise`` over the auto/approved matches that point at it;
its status follows from that: ``paid`` when fully covered, ``partial`` when
something was received, otherwise unchanged.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from ledger.balances import allocated_by_installment, remaining_by_installment  # noqa: F401 (re-exported)
from ledger.db import log_audit


class AllocationError(ValueError):
    pass


@dataclass
class Allocation:
    allocations: list[dict]                 # [{installment_id, allocated_paise}]
    status_changes: list[tuple[int, str, str]] = field(default_factory=list)  # (id, old, new)
    unallocated_paise: int = 0              # overpayment left over


def plan_allocation(conn, payment_paise: int, currency: str, installment_ids: list[int],
                    exclude_match_id: int | None = None) -> Allocation:
    """Spread a payment over installments, earliest due first, never beyond
    what each still owes.  Refuses currency mismatches and fully paid
    installments."""
    if payment_paise <= 0:
        raise AllocationError("Payment amount must be positive.")
    if not installment_ids:
        raise AllocationError("No installment to apply the payment to.")
    marks = ",".join("?" * len(installment_ids))
    rows = conn.execute(
        f"SELECT id, due_date, amount_due_paise, currency, status FROM installment WHERE id IN ({marks})",
        list(installment_ids),
    ).fetchall()
    if len(rows) != len(set(installment_ids)):
        raise AllocationError("An installment in this match no longer exists.")
    received = allocated_by_installment(conn, exclude_match_id=exclude_match_id)

    rows = sorted(rows, key=lambda r: (r["due_date"] or "9999-12-31", r["id"]))
    left = payment_paise
    plan = Allocation(allocations=[])
    for r in rows:
        if r["currency"] != currency:
            raise AllocationError(
                f"Currency mismatch: payment is {currency}, installment {r['id']} is {r['currency']}.")
        owed = r["amount_due_paise"] - received.get(r["id"], 0)
        if owed <= 0 or r["status"] == "paid":
            raise AllocationError(f"Installment {r['id']} is already paid.")
        take = min(left, owed)
        if take <= 0:
            continue
        plan.allocations.append({"installment_id": r["id"], "allocated_paise": take})
        left -= take
        new_status = "paid" if take == owed else "partial"
        if new_status != r["status"]:
            plan.status_changes.append((r["id"], r["status"], new_status))
    plan.unallocated_paise = left
    return plan


def apply_status_changes(conn, plan: Allocation, actor: str, reason: str) -> None:
    """Write installment status changes, each with its own audit entry."""
    for iid, old, new in plan.status_changes:
        conn.execute("UPDATE installment SET status = ? WHERE id = ?", (new, iid))
        log_audit(conn, actor, f"installment_status:{reason}", f"installment:{iid}", old, new, commit=False)
