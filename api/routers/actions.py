"""Commissions, reminders, the Ask box, the audit log and the current user."""

from __future__ import annotations

import hashlib
import json
import threading
import time
from collections import defaultdict, deque
from datetime import date, datetime, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from agents.commissions import human_rule, parse_terms, to_bps
from api.auth import User, current_user, require_finance_lead
from api.common import conflict, not_found, resolve_as_of
from api.database import get_conn
from api.seed import recompute_commissions
from api.settings import get_settings
from ledger.db import decision_lock, log_audit

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
        "rate_bps": to_bps(rule.rate),
        "scope": rule.scope,
        "city": rule.city,
        "split": rule.split,
        "source": "finance_lead" if hr else ("parsed_from_terms" if rule.rate > 0 else "none"),
    }


def _by_currency(rows) -> list[dict]:
    return [{"currency": cur, **vals} for cur, vals in sorted(rows.items())]


def _commission_overview(conn) -> dict:
    """Commission totals, always split by currency: a dollar commission is
    never added to a rupee one."""
    per = {}  # counselor_id -> currency -> totals
    for r in conn.execute(
        "SELECT counselor_id, currency, COALESCE(SUM(commission_paise),0) AS earned_paise, "
        "COALESCE(SUM(tds_paise),0) AS tds_paise, COALESCE(SUM(net_paise),0) AS net_paise, COUNT(*) AS lines "
        "FROM commission_line GROUP BY counselor_id, currency").fetchall():
        per.setdefault(r["counselor_id"], {})[r["currency"]] = {
            k: r[k] for k in ("earned_paise", "tds_paise", "net_paise", "lines")}

    totals: dict[str, dict] = {}
    counselors = []
    for c in conn.execute("SELECT * FROM counselor ORDER BY name, id").fetchall():
        amounts = per.get(c["id"], {})
        rule = _rule_view(c)
        has_net = any(v["net_paise"] > 0 for v in amounts.values())
        status = "needs_rate" if rule["rate"] <= 0 else ("ready" if has_net else "no_fees")
        for cur, v in amounts.items():
            t = totals.setdefault(cur, {"earned_paise": 0, "tds_paise": 0, "net_paise": 0, "counselors": 0})
            for k in ("earned_paise", "tds_paise", "net_paise"):
                t[k] += v[k]
            t["counselors"] += 1
        counselors.append({"id": c["id"], "name": c["name"], "terms_text": c["terms_text"] or "",
                           "rule": rule, "status": status, "amounts": _by_currency(amounts)})
    return {
        "totals": _by_currency(totals),
        "needs_rate": sum(c["status"] == "needs_rate" for c in counselors),
        "counselors": counselors,
    }


def _lines_fingerprint(conn, currency: str) -> tuple[str, int, dict]:
    rows = conn.execute(
        "SELECT counselor_id, payment_id, net_paise FROM commission_line WHERE currency = ? "
        "ORDER BY counselor_id, payment_id, net_paise", (currency,)).fetchall()
    digest = hashlib.sha256(json.dumps([list(r) for r in rows]).encode()).hexdigest()
    per = {}
    for r in rows:
        per[r["counselor_id"]] = per.get(r["counselor_id"], 0) + r["net_paise"]
    return digest, sum(per.values()), per


@router.get("/commissions")
def commissions(conn=Depends(get_conn), user: User = Depends(current_user)):
    out = _commission_overview(conn)
    out["approved_payouts"] = [dict(r) for r in conn.execute(
        "SELECT id, approved_at, actor, currency, total_net_paise FROM payout_approval "
        "ORDER BY id DESC LIMIT 20").fetchall()]
    return out


@router.get("/commissions/counselors/{counselor_id}/statement")
def statement(counselor_id: int, conn=Depends(get_conn), user: User = Depends(current_user)):
    c = conn.execute("SELECT id, name FROM counselor WHERE id = ?", (counselor_id,)).fetchone()
    if c is None:
        raise not_found("Counselor")
    lines = [dict(r) for r in conn.execute(
        "SELECT cl.payment_id, p.date, p.payer_name, cl.currency, cl.base_paise, cl.rate, cl.commission_paise, "
        "cl.refund_deduction_paise, cl.tds_paise, cl.net_paise FROM commission_line cl "
        "JOIN payment_in p ON p.id = cl.payment_id WHERE cl.counselor_id = ? ORDER BY cl.currency, p.date, cl.id",
        (counselor_id,)).fetchall()]
    net: dict[str, int] = {}
    for line in lines:
        net[line["currency"]] = net.get(line["currency"], 0) + line["net_paise"]
    return {"counselor": dict(c), "lines": lines,
            "net_by_currency": [{"currency": k, "net_paise": v} for k, v in sorted(net.items())]}


class RuleBody(BaseModel):
    rate_bps: int = Field(..., gt=0, le=5000, description="Commission rate in basis points (1000 = 10%)")
    # Only "own_referrals" is applied by the commission calculation today.
    # City-scoped rules are refused rather than stored and silently ignored.
    scope: Literal["own_referrals"] = "own_referrals"
    split_bps: Optional[int] = Field(None, gt=0, le=10000, description="Share kept, in basis points")


@router.post("/commissions/counselors/{counselor_id}/rule")
def set_rule(counselor_id: int, body: RuleBody, conn=Depends(get_conn),
             user: User = Depends(require_finance_lead)):
    decision_lock(conn)
    c = conn.execute("SELECT id, parsed_rule FROM counselor WHERE id = ?", (counselor_id,)).fetchone()
    if c is None:
        raise not_found("Counselor")
    rule = json.dumps({
        "rate": body.rate_bps / 10_000, "rate_bps": body.rate_bps, "scope": body.scope, "city": None,
        "split": body.split_bps / 10_000 if body.split_bps else None, "split_bps": body.split_bps,
        "set_by": "human",
    })
    conn.execute("UPDATE counselor SET parsed_rule = ? WHERE id = ?", (rule, counselor_id))
    log_audit(conn, user.audit_actor, "set_commission_rule", f"counselor:{counselor_id}",
              c["parsed_rule"], rule, commit=False)
    n = recompute_commissions(conn, actor=user.audit_actor)
    conn.commit()
    return {"counselor_id": counselor_id, "rule": json.loads(rule), "commission_lines": n}


class PayoutBody(BaseModel):
    currency: str = Field(..., min_length=3, max_length=3)
    expected_net_paise: int = Field(..., ge=0, description="The total the finance lead saw on screen")


@router.post("/commissions/payout/approve")
def approve_payout(body: PayoutBody, conn=Depends(get_conn), user: User = Depends(require_finance_lead)):
    """Approve the commission payout for one currency.

    The client sends the total it displayed; if the numbers changed since,
    refuse, so nobody approves an amount they didn't see.  The exact set of
    lines is fingerprinted, so the same payout can't be approved twice.
    """
    decision_lock(conn)
    currency = body.currency.upper()
    fingerprint, current, per_counselor = _lines_fingerprint(conn, currency)
    if current == 0:
        raise conflict(f"There is no {currency} commission to pay out.")
    if body.expected_net_paise != current:
        raise conflict("The payout total changed since you loaded the page. Refresh and review it again.")
    if conn.execute("SELECT 1 FROM payout_approval WHERE currency = ? AND lines_fingerprint = ?",
                    (currency, fingerprint)).fetchone():
        raise conflict("This exact payout was already approved.")
    conn.execute(
        "INSERT INTO payout_approval (approved_at, actor, currency, total_net_paise, lines_fingerprint) "
        "VALUES (?, ?, ?, ?, ?)",
        (datetime.now(timezone.utc).isoformat(), user.audit_actor, currency, current, fingerprint))
    log_audit(conn, user.audit_actor, "approve_commission_payout", f"commissions:{currency}", None,
              json.dumps({"currency": currency, "total_net_paise": current,
                          "per_counselor_net_paise": per_counselor, "fingerprint": fingerprint}),
              commit=False)
    conn.commit()
    return {"currency": currency, "approved_net_paise": current, "counselors": len(per_counselor)}


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
    decision_lock(conn)  # two clicks can't both approve
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
