"""Commissions, reminders, the Ask box, the audit log and the current user."""

from __future__ import annotations

import json
import threading
import time
from collections import defaultdict, deque
from datetime import date
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from agents.commissions import human_rule, parse_terms
from api.auth import User, current_user, require_finance_lead
from api.common import conflict, not_found, resolve_as_of
from api.database import get_conn
from api.seed import recompute_commissions
from api.settings import get_settings
from ledger.db import log_audit

router = APIRouter(tags=["actions"])


@router.get("/me")
def me(user: User = Depends(current_user)):
    return {"id": user.id, "email": user.email, "role": user.role,
            "can_approve": user.is_finance_lead}


# ---------------------------------------------------------------------------
# Commissions
# ---------------------------------------------------------------------------

def _rule_view(c) -> dict:
    hr = human_rule(c["parsed_rule"])
    rule = hr or parse_terms(c["terms_text"] or "")
    return {
        "rate": rule.rate,
        "scope": rule.scope,
        "city": rule.city,
        "split": rule.split,
        "source": "finance_lead" if hr else ("parsed_from_terms" if rule.rate > 0 else "none"),
    }


def _commission_overview(conn) -> dict:
    totals = {r["counselor_id"]: dict(r) for r in conn.execute(
        "SELECT counselor_id, COALESCE(SUM(commission_paise),0) AS earned_paise, "
        "COALESCE(SUM(tds_paise),0) AS tds_paise, COALESCE(SUM(net_paise),0) AS net_paise, "
        "COUNT(*) AS lines FROM commission_line GROUP BY counselor_id").fetchall()}
    counselors = []
    for c in conn.execute("SELECT * FROM counselor ORDER BY name, id").fetchall():
        t = totals.get(c["id"], {"earned_paise": 0, "tds_paise": 0, "net_paise": 0, "lines": 0})
        rule = _rule_view(c)
        status = "needs_rate" if rule["rate"] <= 0 else ("ready" if t["net_paise"] > 0 else "no_fees")
        counselors.append({"id": c["id"], "name": c["name"], "terms_text": c["terms_text"] or "",
                           "rule": rule, "status": status, **{k: t[k] for k in ("earned_paise", "tds_paise", "net_paise", "lines")}})
    return {
        "currency": "INR",
        "totals": {
            "earned_paise": sum(c["earned_paise"] for c in counselors),
            "tds_paise": sum(c["tds_paise"] for c in counselors),
            "net_paise": sum(c["net_paise"] for c in counselors),
            "needs_rate": sum(c["status"] == "needs_rate" for c in counselors),
        },
        "counselors": counselors,
    }


@router.get("/commissions")
def commissions(conn=Depends(get_conn), user: User = Depends(current_user)):
    return _commission_overview(conn)


@router.get("/commissions/counselors/{counselor_id}/statement")
def statement(counselor_id: int, conn=Depends(get_conn), user: User = Depends(current_user)):
    c = conn.execute("SELECT id, name FROM counselor WHERE id = ?", (counselor_id,)).fetchone()
    if c is None:
        raise not_found("Counselor")
    lines = [dict(r) for r in conn.execute(
        "SELECT cl.payment_id, p.date, p.payer_name, cl.base_paise, cl.rate, cl.commission_paise, "
        "cl.refund_deduction_paise, cl.tds_paise, cl.net_paise FROM commission_line cl "
        "JOIN payment_in p ON p.id = cl.payment_id WHERE cl.counselor_id = ? ORDER BY p.date, cl.id",
        (counselor_id,)).fetchall()]
    return {"counselor": dict(c), "lines": lines,
            "net_paise": sum(line["net_paise"] for line in lines)}


class RuleBody(BaseModel):
    rate_pct: float = Field(..., gt=0, le=50, description="Commission rate in percent")
    scope: Literal["own_referrals", "city", "all"] = "own_referrals"
    city: Optional[str] = Field(None, max_length=60)
    split_pct: Optional[float] = Field(None, gt=0, le=100)


@router.post("/commissions/counselors/{counselor_id}/rule")
def set_rule(counselor_id: int, body: RuleBody, conn=Depends(get_conn),
             user: User = Depends(require_finance_lead)):
    c = conn.execute("SELECT id, parsed_rule FROM counselor WHERE id = ?", (counselor_id,)).fetchone()
    if c is None:
        raise not_found("Counselor")
    if body.scope == "city" and not body.city:
        raise HTTPException(422, "A city is required when the scope is 'city'.")
    rule = json.dumps({
        "rate": round(body.rate_pct / 100, 6), "scope": body.scope, "city": body.city,
        "split": round(body.split_pct / 100, 6) if body.split_pct else None, "set_by": "human",
    })
    conn.execute("UPDATE counselor SET parsed_rule = ? WHERE id = ?", (rule, counselor_id))
    n = recompute_commissions(conn)
    log_audit(conn, user.audit_actor, "set_commission_rule", f"counselor:{counselor_id}",
              c["parsed_rule"], rule, commit=False)
    conn.commit()
    return {"counselor_id": counselor_id, "rule": json.loads(rule), "commission_lines": n}


class PayoutBody(BaseModel):
    expected_net_paise: int = Field(..., ge=0, description="The total the finance lead saw on screen")


@router.post("/commissions/payout/approve")
def approve_payout(body: PayoutBody, conn=Depends(get_conn), user: User = Depends(require_finance_lead)):
    """Approve the current commission payout.  The client sends the total it
    displayed; if the numbers changed since (e.g. a new approval), refuse, so
    nobody approves an amount they didn't see."""
    overview = _commission_overview(conn)
    current = overview["totals"]["net_paise"]
    if current == 0:
        raise conflict("There is nothing to pay out.")
    if body.expected_net_paise != current:
        raise conflict("The payout total changed since you loaded the page. Refresh and review it again.")
    per_counselor = {c["id"]: c["net_paise"] for c in overview["counselors"] if c["net_paise"] > 0}
    log_audit(conn, user.audit_actor, "approve_commission_payout", "commissions", None,
              json.dumps({"total_net_paise": current, "per_counselor_net_paise": per_counselor}),
              commit=False)
    conn.commit()
    return {"approved_net_paise": current, "counselors": len(per_counselor)}


# ---------------------------------------------------------------------------
# Reminders
# ---------------------------------------------------------------------------

@router.get("/reminders")
def reminders(
    as_of: Optional[date] = None,
    type: Optional[Literal["pre_due", "on_due", "overdue"]] = None,
    approval: Optional[Literal["auto", "needs_approval"]] = None,
    conn=Depends(get_conn),
    user: User = Depends(current_user),
):
    from agents.reminders import generate_reminders

    as_of = resolve_as_of(conn, as_of)
    items = generate_reminders(conn, as_of=as_of)
    approved = {(r["entity"], r["new_value"]) for r in conn.execute(
        "SELECT entity, new_value FROM audit_log WHERE action = 'approve_reminder'").fetchall()}
    counts = {
        "pre_due": sum(r.reminder_type == "pre_due" for r in items),
        "on_due": sum(r.reminder_type == "on_due" for r in items),
        "overdue": sum(r.reminder_type == "overdue" for r in items),
        "needs_approval": sum(r.needs_approval for r in items),
    }
    if type:
        items = [r for r in items if r.reminder_type == type]
    if approval == "auto":
        items = [r for r in items if not r.needs_approval]
    elif approval == "needs_approval":
        items = [r for r in items if r.needs_approval]
    out = []
    for r in items:
        d = vars(r).copy()
        d["approved"] = (f"installment:{r.installment_id}", r.reminder_type) in approved
        out.append(d)
    return {"as_of": as_of, "counts": counts, "items": out}


class ReminderApproval(BaseModel):
    installment_id: int
    reminder_type: Literal["pre_due", "on_due", "overdue"]


@router.post("/reminders/approve")
def approve_reminder(body: ReminderApproval, conn=Depends(get_conn),
                     user: User = Depends(require_finance_lead)):
    if conn.execute("SELECT 1 FROM installment WHERE id = ?", (body.installment_id,)).fetchone() is None:
        raise not_found("Installment")
    entity = f"installment:{body.installment_id}"
    if conn.execute("SELECT 1 FROM audit_log WHERE action='approve_reminder' AND entity=? AND new_value=?",
                    (entity, body.reminder_type)).fetchone():
        raise conflict("This reminder is already approved.")
    log_audit(conn, user.audit_actor, "approve_reminder", entity, None, body.reminder_type, commit=False)
    conn.commit()
    # Sending is simulated in the prototype; a real channel (email/WhatsApp) plugs in here.
    return {"approved": True, "sent": False}


# ---------------------------------------------------------------------------
# Ask
# ---------------------------------------------------------------------------

class _RateLimiter:
    """Per-user sliding window. In-memory, so per server instance: a guard
    against runaway clients, not a billing control."""

    def __init__(self):
        self._hits: dict[str, deque] = defaultdict(deque)
        self._lock = threading.Lock()

    def check(self, key: str, limit: int, window: float = 60.0) -> bool:
        now = time.monotonic()
        with self._lock:
            q = self._hits[key]
            while q and now - q[0] > window:
                q.popleft()
            if len(q) >= limit:
                return False
            q.append(now)
            return True


_ask_limiter = _RateLimiter()


class AskBody(BaseModel):
    question: str = Field(..., min_length=2, max_length=500)


@router.post("/ask")
def ask(body: AskBody, conn=Depends(get_conn), user: User = Depends(current_user)):
    from agents.copilot import ask as copilot_ask

    if not _ask_limiter.check(user.id, get_settings().ask_rate_limit_per_minute):
        raise HTTPException(429, "Too many questions in a minute. Try again shortly.",
                            headers={"Retry-After": "60"})
    result = copilot_ask(conn, body.question)
    return {"question": body.question, "answer": result.answer, "transactions": result.transactions,
            "how_worked_out": result.query_used, "confidence": result.confidence}


# ---------------------------------------------------------------------------
# Audit log
# ---------------------------------------------------------------------------

@router.get("/audit")
def audit(
    limit: int = Query(100, ge=1, le=500),
    before_id: Optional[int] = Query(None, description="Page backwards from this id"),
    conn=Depends(get_conn),
    user: User = Depends(require_finance_lead),
):
    if before_id:
        rows = conn.execute("SELECT * FROM audit_log WHERE id < ? ORDER BY id DESC LIMIT ?", (before_id, limit))
    else:
        rows = conn.execute("SELECT * FROM audit_log ORDER BY id DESC LIMIT ?", (limit,))
    items = [dict(r) for r in rows.fetchall()]
    return {"items": items, "next_before_id": items[-1]["id"] if len(items) == limit else None}
