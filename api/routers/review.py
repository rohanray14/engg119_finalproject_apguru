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

from api.allocation import AllocationError, apply_status_changes, plan_allocation, remaining_by_installment
from api.auth import User, current_user, require_finance_lead
from api.common import conflict, not_found, parse_allocations
from api.database import get_conn
from api.reasons import format_match_reason
from api.seed import recompute_commissions
from ledger.db import decision_lock, log_audit

router = APIRouter(prefix="/review", tags=["review"])

BULK_MIN_CONFIDENCE = 0.90

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


def _summary(row, conn=None) -> dict:
    allocs = parse_allocations(row["allocations"])
    suggested_student = None
    if allocs and conn is not None:
        iid = int(allocs[0]["installment_id"])
        s = conn.execute(
            "SELECT s.name FROM installment i JOIN enrollment e ON i.enrollment_id = e.id "
            "JOIN student s ON e.student_id = s.id WHERE i.id = ?", (iid,)
        ).fetchone()
        if s:
            suggested_student = s["name"]
    return {
        "match_id": row["match_id"],
        "status": row["status"],
        "confidence": row["confidence"],
        "method": row["method"],
        "reason": row["reason"],
        "reason_text": format_match_reason(row["reason"] or ""),
        "has_suggestion": bool(allocs),
        "suggested_student": suggested_student,
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
        "items": [_summary(r, conn) for r in rows],
    }


@router.post("/from-payment/{payment_id}")
def create_review_from_payment(payment_id: int, conn=Depends(get_conn), user: User = Depends(current_user)):
    """Get or create a pending_review match_result for an unmatched payment.

    Returns the match_id so the frontend can navigate to /review?id=<match_id>.
    """
    # Check if payment exists
    pay = conn.execute("SELECT id FROM payment_in WHERE id = ?", (payment_id,)).fetchone()
    if pay is None:
        raise not_found("Payment")
    # Check if a match_result already exists
    existing = conn.execute(
        "SELECT id, status FROM match_result WHERE payment_id = ?", (payment_id,)
    ).fetchone()
    if existing:
        return {"match_id": existing["id"], "status": existing["status"], "created": False}
    # Create a blank pending_review match_result with no suggestion
    cur = conn.execute(
        "INSERT INTO match_result (payment_id, allocations, confidence, reason, method, status) "
        "VALUES (?, '[]', 0.0, 'manual_review_requested', 'human', 'pending_review')",
        (payment_id,),
    )
    match_id = cur.lastrowid
    log_audit(conn, user.audit_actor, "create_review", f"match:{match_id}",
              None, json.dumps({"payment_id": payment_id, "status": "pending_review"}))
    conn.commit()
    return {"match_id": match_id, "status": "pending_review", "created": True}


@router.get("/{match_id}/search-students")
def search_students(match_id: int, q: str = "", conn=Depends(get_conn), user: User = Depends(current_user)):
    """Search for students to manually assign a payment to."""
    row = _match_row(conn, match_id)
    if not q or len(q) < 2:
        return {"results": []}
    results = [dict(r) for r in conn.execute(
        f"SELECT {INST_COLS} {INST_JOIN} WHERE s.name LIKE ? AND i.status != 'paid' AND i.currency = ? "
        "ORDER BY s.name, i.due_date LIMIT 30",
        (f"%{q}%", row["currency"]),
    ).fetchall()]
    remaining = remaining_by_installment(conn)
    for inst in results:
        inst["remaining_paise"] = remaining.get(inst["installment_id"], inst["amount_due_paise"])
        inst["amount_difference_paise"] = inst["amount_due_paise"] - row["amount_paid_paise"]
    return {"results": results}


@router.get("/{match_id}")
def get_item(match_id: int, conn=Depends(get_conn), user: User = Depends(current_user)):
    row = _match_row(conn, match_id)
    allocs = parse_allocations(row["allocations"])
    suggested = _installments(conn, [int(a["installment_id"]) for a in allocs])
    amt = row["amount_paid_paise"]
    lo = int(amt * 0.8)
    hi = int(amt * 1.2)
    others = [dict(r) for r in conn.execute(
        f"SELECT {INST_COLS} {INST_JOIN} "
        "WHERE i.amount_due_paise BETWEEN ? AND ? AND i.currency = ? AND i.status != 'paid' "
        "ORDER BY ABS(i.amount_due_paise - ?) ASC, i.due_date LIMIT 20",
        (lo, hi, row["currency"], amt),
    ).fetchall()]
    remaining = remaining_by_installment(conn)
    for inst in suggested + others:
        inst["remaining_paise"] = remaining.get(inst["installment_id"], inst["amount_due_paise"])
    suggested_ids = {s["installment_id"] for s in suggested}
    for o in others:
        o["suggested"] = o["installment_id"] in suggested_ids
        o["amount_difference_paise"] = o["amount_due_paise"] - row["amount_paid_paise"]
    return {**_summary(row), "suggested_installments": suggested, "other_candidates": others}


# ---------------------------------------------------------------------------
# Decisions (finance lead only)
# ---------------------------------------------------------------------------


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


def _plan(conn, row, installment_ids: list[int]):
    try:
        return plan_allocation(conn, row["amount_paid_paise"], row["currency"], installment_ids,
                               exclude_match_id=row["match_id"])
    except AllocationError as exc:
        raise conflict(str(exc)) from exc


class DecisionResult(BaseModel):
    match_id: int
    status: str
    allocations: list[dict] = []
    installment_changes: list[dict] = []
    unallocated_paise: int = 0
    commission_lines: int


def _result(match_id, status, plan=None, n=0) -> DecisionResult:
    return DecisionResult(
        match_id=match_id, status=status, commission_lines=n,
        allocations=plan.allocations if plan else [],
        installment_changes=[{"installment_id": i, "from": a, "to": b} for i, a, b in plan.status_changes] if plan else [],
        unallocated_paise=plan.unallocated_paise if plan else 0,
    )


@router.post("/{match_id}/approve", response_model=DecisionResult)
def approve(match_id: int, conn=Depends(get_conn), user: User = Depends(require_finance_lead)):
    """Accept the matcher's suggestion.  The payment is applied to what each
    suggested installment still owes, so a part-payment leaves it 'partial'."""
    decision_lock(conn)
    row = _match_row(conn, match_id)
    if row["status"] != "pending_review":
        raise conflict(f"This payment was already decided (status: {row['status']}). Refresh the queue.")
    ids = [int(a["installment_id"]) for a in parse_allocations(row["allocations"])]
    if not ids:
        raise conflict("There is no suggested student to approve. Pick a student instead.")
    plan = _plan(conn, row, ids)
    _claim(conn, match_id, "approved", ", allocations = ?", (json.dumps(plan.allocations),))
    apply_status_changes(conn, plan, user.audit_actor, f"match:{match_id}")
    log_audit(conn, user.audit_actor, "approve_match", f"match:{match_id}",
              json.dumps({"status": "pending_review", "allocations": row["allocations"]}),
              json.dumps({"status": "approved", "allocations": plan.allocations,
                                     "unallocated_paise": plan.unallocated_paise}), commit=False)
    n = recompute_commissions(conn, actor=user.audit_actor)
    conn.commit()
    return _result(match_id, "approved", plan, n)


class AssignBody(BaseModel):
    installment_id: int


@router.post("/{match_id}/assign", response_model=DecisionResult)
def assign(match_id: int, body: AssignBody, conn=Depends(get_conn),
           user: User = Depends(require_finance_lead)):
    """Pick a different student: apply the payment to the chosen installment."""
    decision_lock(conn)
    row = _match_row(conn, match_id)
    if row["status"] != "pending_review":
        raise conflict(f"This payment was already decided (status: {row['status']}). Refresh the queue.")
    if conn.execute("SELECT 1 FROM installment WHERE id = ?", (body.installment_id,)).fetchone() is None:
        raise not_found("Installment")
    plan = _plan(conn, row, [body.installment_id])
    new_allocs = json.dumps(plan.allocations)
    _claim(conn, match_id, "approved", ", allocations = ?, method = 'human', reason = 'manually_assigned'",
           (new_allocs,))
    apply_status_changes(conn, plan, user.audit_actor, f"match:{match_id}")
    log_audit(conn, user.audit_actor, "manual_match", f"match:{match_id}",
              row["allocations"], json.dumps({"allocations": plan.allocations,
                                              "unallocated_paise": plan.unallocated_paise}), commit=False)
    n = recompute_commissions(conn, actor=user.audit_actor)
    conn.commit()
    return _result(match_id, "approved", plan, n)


class RejectBody(BaseModel):
    reason: Literal["not_a_fee"] = "not_a_fee"
    note: str = Field("", max_length=500)


@router.post("/{match_id}/reject", response_model=DecisionResult)
def reject(match_id: int, body: RejectBody, conn=Depends(get_conn),
           user: User = Depends(require_finance_lead)):
    decision_lock(conn)
    _match_row(conn, match_id)
    _claim(conn, match_id, "rejected", ", reason = ?", (body.reason,))
    log_audit(conn, user.audit_actor, "mark_not_fee", f"match:{match_id}",
              "pending_review", json.dumps({"status": "rejected", "reason": body.reason, "note": body.note}),
              commit=False)
    conn.commit()
    return _result(match_id, "rejected")


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
    item that arrived after the page loaded is never approved unseen.  Each
    item gets the same checks and allocation as a single approval.
    """
    decision_lock(conn)
    approved, skipped = [], []
    for mid in dict.fromkeys(body.match_ids):
        row = conn.execute(
            f"SELECT mr.id AS match_id, mr.allocations, mr.confidence, mr.status, {PAYMENT_COLS} "
            "FROM match_result mr JOIN payment_in p ON mr.payment_id = p.id WHERE mr.id = ?", (mid,)
        ).fetchone()
        ids = [int(a["installment_id"]) for a in parse_allocations(row["allocations"])] if row else []
        if row is None:
            skipped.append({"match_id": mid, "reason": "not found"})
            continue
        if row["status"] != "pending_review":
            skipped.append({"match_id": mid, "reason": f"already {row['status']}"})
            continue
        if row["confidence"] < BULK_MIN_CONFIDENCE:
            skipped.append({"match_id": mid, "reason": "below bulk-approve confidence"})
            continue
        if not ids:
            skipped.append({"match_id": mid, "reason": "no suggested student"})
            continue
        try:
            plan = plan_allocation(conn, row["amount_paid_paise"], row["currency"], ids, exclude_match_id=mid)
        except AllocationError as exc:
            skipped.append({"match_id": mid, "reason": str(exc)})
            continue
        cur = conn.execute(
            "UPDATE match_result SET status = 'approved', allocations = ? WHERE id = ? AND status = 'pending_review'",
            (json.dumps(plan.allocations), mid))
        if cur.rowcount != 1:
            skipped.append({"match_id": mid, "reason": "decided by someone else just now"})
            continue
        apply_status_changes(conn, plan, user.audit_actor, f"match:{mid}")
        log_audit(conn, user.audit_actor, "bulk_approve_match", f"match:{mid}",
                  json.dumps({"status": "pending_review", "allocations": row["allocations"]}),
                  json.dumps({"status": "approved", "allocations": plan.allocations,
                                     "unallocated_paise": plan.unallocated_paise}), commit=False)
        approved.append(mid)
    n = recompute_commissions(conn, actor=user.audit_actor) if approved else 0
    conn.commit()
    return BulkResult(approved=approved, skipped=skipped, commission_lines=n)
