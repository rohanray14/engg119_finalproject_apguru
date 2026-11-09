"""Review queue: payments the matcher wasn't sure about.

Every decision is one database transaction: the match status, the
installment status, the commission lines and the audit entry are written
together or not at all.  A decision only applies to a match that is still
pending, so two people (or a double click) can't approve the same payment
twice; the second gets 409 Conflict.
"""

from __future__ import annotations

import json
from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from api.auth import User, current_user, require_finance_lead
from api.common import conflict, not_found, parse_allocations
from api.database import get_conn
from api.reasons import format_match_reason
from api.seed import recompute_commissions
from ledger.db import log_audit

router = APIRouter(prefix="/review", tags=["review"])

PAYMENT_COLS = (
    "p.id AS payment_id, p.payer_name, p.amount_paid_paise, p.currency, p.date, p.source, "
    "p.method, p.gateway_fee_paise, p.gst_on_fee_paise, p.fx_diff_paise, p.tds_paise, "
    "p.amount_in_bank_paise, p.confirmation"
)
INST_COLS = (
    "i.id AS installment_id, i.due_date, i.amount_due_paise, i.currency, i.status, "
    "e.id AS enrollment_id, e.program, e.fee_model, s.id AS student_id, s.name AS student_name"
)
INST_JOIN = "FROM installment i JOIN enrollment e ON i.enrollment_id = e.id JOIN student s ON e.student_id = s.id"


def _installments(conn, ids: list[int]) -> list[dict]:
    if not ids:
        return []
    marks = ",".join("?" * len(ids))
    return [dict(r) for r in conn.execute(
        f"SELECT {INST_COLS} {INST_JOIN} WHERE i.id IN ({marks}) ORDER BY i.due_date", ids).fetchall()]


def _match_row(conn, match_id: int):
    row = conn.execute(
        f"SELECT mr.id AS match_id, mr.allocations, mr.confidence, mr.reason, mr.method, mr.status, {PAYMENT_COLS} "
        "FROM match_result mr JOIN payment_in p ON mr.payment_id = p.id WHERE mr.id = ?",
        (match_id,),
    ).fetchone()
    if row is None:
        raise not_found("Match")
    return row


def _summary(row) -> dict:
    allocs = parse_allocations(row["allocations"])
    return {
        "match_id": row["match_id"],
        "status": row["status"],
        "confidence": row["confidence"],
        "method": row["method"],
        "reason": row["reason"],
        "reason_text": format_match_reason(row["reason"] or ""),
        "has_suggestion": bool(allocs),
        "payment": {k: row[k] for k in (
            "payment_id", "payer_name", "amount_paid_paise", "currency", "date", "source", "method",
            "gateway_fee_paise", "gst_on_fee_paise", "fx_diff_paise", "tds_paise",
            "amount_in_bank_paise", "confirmation")},
    }


@router.get("")
def list_queue(conn=Depends(get_conn), user: User = Depends(current_user)):
    from config import CONFIG

    auto_count = conn.execute("SELECT COUNT(*) FROM match_result WHERE status='auto'").fetchone()[0]
    rows = conn.execute(
        f"SELECT mr.id AS match_id, mr.allocations, mr.confidence, mr.reason, mr.method, mr.status, {PAYMENT_COLS} "
        "FROM match_result mr JOIN payment_in p ON mr.payment_id = p.id "
        "WHERE mr.status = 'pending_review' ORDER BY mr.confidence DESC, mr.id"
    ).fetchall()
    return {
        "auto_matched_count": auto_count,
        "auto_match_threshold": CONFIG.matching.auto_match_threshold,
        "bulk_approve_min_confidence": BULK_MIN_CONFIDENCE,
        "items": [_summary(r) for r in rows],
    }


@router.get("/{match_id}")
def get_item(match_id: int, conn=Depends(get_conn), user: User = Depends(current_user)):
    row = _match_row(conn, match_id)
    allocs = parse_allocations(row["allocations"])
    suggested = _installments(conn, [int(a["installment_id"]) for a in allocs])
    others = [dict(r) for r in conn.execute(
        f"SELECT {INST_COLS} {INST_JOIN} "
        "WHERE i.amount_due_paise = ? AND i.currency = ? AND i.status != 'paid' "
        "ORDER BY i.due_date LIMIT 20",
        (row["amount_paid_paise"], row["currency"]),
    ).fetchall()]
    suggested_ids = {s["installment_id"] for s in suggested}
    for o in others:
        o["suggested"] = o["installment_id"] in suggested_ids
        o["amount_difference_paise"] = o["amount_due_paise"] - row["amount_paid_paise"]
    return {**_summary(row), "suggested_installments": suggested, "other_candidates": others}


# ---------------------------------------------------------------------------
# Decisions (finance lead only)
# ---------------------------------------------------------------------------

BULK_MIN_CONFIDENCE = 0.90


def _claim(conn, match_id: int, new_status: str, extra_sql: str = "", extra_params: tuple = ()) -> None:
    """Move a pending match to ``new_status``; 409 if it is no longer pending."""
    cur = conn.execute(
        f"UPDATE match_result SET status = ?{extra_sql} WHERE id = ? AND status = 'pending_review'",
        (new_status, *extra_params, match_id),
    )
    if cur.rowcount != 1:
        exists = conn.execute("SELECT status FROM match_result WHERE id = ?", (match_id,)).fetchone()
        if exists is None:
            raise not_found("Match")
        raise conflict(f"This payment was already decided (status: {exists[0]}). Refresh the queue.")


def _mark_installments_paid(conn, installment_ids: list[int]) -> None:
    for iid in installment_ids:
        conn.execute("UPDATE installment SET status = 'paid' WHERE id = ?", (iid,))


class DecisionResult(BaseModel):
    match_id: int
    status: str
    commission_lines: int


@router.post("/{match_id}/approve", response_model=DecisionResult)
def approve(match_id: int, conn=Depends(get_conn), user: User = Depends(require_finance_lead)):
    row = _match_row(conn, match_id)
    allocs = parse_allocations(row["allocations"])
    if not allocs:
        raise conflict("There is no suggested student to approve. Pick a student instead.")
    _claim(conn, match_id, "approved")
    _mark_installments_paid(conn, [int(a["installment_id"]) for a in allocs])
    n = recompute_commissions(conn)
    log_audit(conn, user.audit_actor, "approve_match", f"match:{match_id}",
              "pending_review", "approved", commit=False)
    conn.commit()
    return DecisionResult(match_id=match_id, status="approved", commission_lines=n)


class AssignBody(BaseModel):
    installment_id: int


@router.post("/{match_id}/assign", response_model=DecisionResult)
def assign(match_id: int, body: AssignBody, conn=Depends(get_conn),
           user: User = Depends(require_finance_lead)):
    """Pick a different student: link the payment to the chosen installment."""
    row = _match_row(conn, match_id)
    inst = conn.execute(
        "SELECT id, amount_due_paise, currency, status FROM installment WHERE id = ?",
        (body.installment_id,),
    ).fetchone()
    if inst is None:
        raise not_found("Installment")
    if inst["status"] == "paid":
        raise conflict("That installment is already paid.")
    if inst["currency"] != row["currency"]:
        raise conflict(f"Currency mismatch: payment is {row['currency']}, installment is {inst['currency']}.")

    paid = row["amount_paid_paise"]
    new_allocs = json.dumps([{"installment_id": inst["id"], "allocated_paise": paid}])
    _claim(conn, match_id, "approved", ", allocations = ?, method = 'human', reason = 'manually_assigned'",
           (new_allocs,))
    new_status = "paid" if paid >= inst["amount_due_paise"] else "partial"
    conn.execute("UPDATE installment SET status = ? WHERE id = ?", (new_status, inst["id"]))
    n = recompute_commissions(conn)
    log_audit(conn, user.audit_actor, "manual_match", f"match:{match_id}",
              row["allocations"], new_allocs, commit=False)
    conn.commit()
    return DecisionResult(match_id=match_id, status="approved", commission_lines=n)


class RejectBody(BaseModel):
    reason: Literal["not_a_fee"] = "not_a_fee"
    note: str = Field("", max_length=500)


@router.post("/{match_id}/reject", response_model=DecisionResult)
def reject(match_id: int, body: RejectBody, conn=Depends(get_conn),
           user: User = Depends(require_finance_lead)):
    _match_row(conn, match_id)
    _claim(conn, match_id, "rejected", ", reason = ?", (body.reason,))
    log_audit(conn, user.audit_actor, "mark_not_fee", f"match:{match_id}",
              "pending_review", json.dumps({"status": "rejected", "reason": body.reason, "note": body.note}),
              commit=False)
    conn.commit()
    return DecisionResult(match_id=match_id, status="rejected", commission_lines=0)


class BulkBody(BaseModel):
    match_ids: list[int] = Field(..., min_length=1, max_length=200,
                                 description="The exact items the finance lead saw and chose")


class BulkResult(BaseModel):
    approved: list[int]
    skipped: list[dict]
    commission_lines: int


@router.post("/bulk-approve", response_model=BulkResult)
def bulk_approve(body: BulkBody, conn=Depends(get_conn), user: User = Depends(require_finance_lead)):
    """Approve several high-confidence suggestions in one go.

    Takes an explicit list of ids rather than "everything above 90%", so an
    item that arrived after the page loaded is never approved unseen.
    """
    approved, skipped = [], []
    for mid in dict.fromkeys(body.match_ids):
        row = conn.execute(
            "SELECT id, allocations, confidence, status FROM match_result WHERE id = ?", (mid,)
        ).fetchone()
        allocs = parse_allocations(row["allocations"]) if row else []
        if row is None:
            skipped.append({"match_id": mid, "reason": "not found"})
        elif row["status"] != "pending_review":
            skipped.append({"match_id": mid, "reason": f"already {row['status']}"})
        elif row["confidence"] < BULK_MIN_CONFIDENCE:
            skipped.append({"match_id": mid, "reason": "below bulk-approve confidence"})
        elif not allocs:
            skipped.append({"match_id": mid, "reason": "no suggested student"})
        else:
            conn.execute("UPDATE match_result SET status = 'approved' WHERE id = ? AND status = 'pending_review'", (mid,))
            _mark_installments_paid(conn, [int(a["installment_id"]) for a in allocs])
            log_audit(conn, user.audit_actor, "bulk_approve_match", f"match:{mid}",
                      "pending_review", "approved", commit=False)
            approved.append(mid)
    n = recompute_commissions(conn) if approved else 0
    conn.commit()
    return BulkResult(approved=approved, skipped=skipped, commission_lines=n)
