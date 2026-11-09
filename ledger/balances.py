"""What each installment has received and still owes (deterministic code).

Paid-to-date is the sum of ``allocated_paise`` over the auto/approved matches
that point at an installment.  Used by the API, reminders and the copilot so
every screen agrees on what a family owes.
"""

from __future__ import annotations

import json


def _allocations(raw) -> list[dict]:
    try:
        allocs = json.loads(raw or "[]")
    except (TypeError, ValueError):
        return []
    return [a for a in allocs if isinstance(a, dict) and "installment_id" in a]


def allocated_by_installment(conn, exclude_match_id: int | None = None) -> dict[int, int]:
    """{installment_id: paise received so far} from settled matches."""
    totals: dict[int, int] = {}
    for m in conn.execute(
        "SELECT id, allocations FROM match_result WHERE status IN ('auto','approved')"
    ).fetchall():
        if exclude_match_id is not None and m["id"] == exclude_match_id:
            continue
        for a in _allocations(m["allocations"]):
            iid = int(a["installment_id"])
            totals[iid] = totals.get(iid, 0) + int(a.get("allocated_paise") or 0)
    return totals


def remaining_by_installment(conn) -> dict[int, int]:
    """{installment_id: paise still owed}; 0 for anything marked paid."""
    received = allocated_by_installment(conn)
    out = {}
    for r in conn.execute("SELECT id, amount_due_paise, status FROM installment").fetchall():
        out[r["id"]] = 0 if r["status"] == "paid" else max(r["amount_due_paise"] - received.get(r["id"], 0), 0)
    return out
