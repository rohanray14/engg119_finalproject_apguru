"""Today screen: briefing, month snapshot, confirmation, forecast, top lists."""

from __future__ import annotations

from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Query

from api.allocation import remaining_by_installment
from api.auth import User, current_user
from api.common import data_date_range, resolve_as_of
from api.database import get_conn

router = APIRouter(tags=["dashboard"])


def _month_range(d: date) -> tuple[date, date]:
    first = d.replace(day=1)
    nxt = first.replace(year=first.year + 1, month=1) if first.month == 12 else first.replace(month=first.month + 1)
    return first, nxt - timedelta(days=1)


def _one(conn, sql: str, params=()) -> int:
    return conn.execute(sql, params).fetchone()[0] or 0


@router.get("/meta")
def meta(conn=Depends(get_conn), user: User = Depends(current_user)):
    lo, hi = data_date_range(conn)
    currencies = [r[0] for r in conn.execute(
        "SELECT DISTINCT currency FROM payment_in ORDER BY currency").fetchall()]
    return {
        "data_from": lo,
        "data_to": hi,
        "default_as_of": resolve_as_of(conn, None),
        "currencies": currencies,
    }


@router.get("/dashboard")
def dashboard(
    as_of: Optional[date] = Query(None, description="Date the overdue/forecast numbers are computed for"),
    conn=Depends(get_conn),
    user: User = Depends(current_user),
):
    from agents.reminders import generate_reminders
    from agents.risk import scan_risks

    as_of = resolve_as_of(conn, as_of)
    iso = as_of.isoformat()
    this_start, this_end = _month_range(as_of)
    prev_start, prev_end = _month_range(this_start - timedelta(days=1))

    def received(a: date, b: date) -> int:
        return _one(conn, "SELECT COALESCE(SUM(amount_paid_paise),0) FROM payment_in WHERE currency='INR' AND date BETWEEN ? AND ?",
                    (a.isoformat(), b.isoformat()))

    def expected(a: date, b: date) -> int:
        return _one(conn, "SELECT COALESCE(SUM(amount_due_paise),0) FROM installment WHERE currency='INR' AND due_date BETWEEN ? AND ?",
                    (a.isoformat(), b.isoformat()))

    received_this = received(this_start, this_end)
    received_last = received(prev_start, prev_end)
    expected_this = expected(this_start, this_end)
    spent_this = _one(conn, "SELECT COALESCE(SUM(amount_paise),0) FROM payment_out WHERE currency='INR' AND date BETWEEN ? AND ?",
                      (this_start.isoformat(), this_end.isoformat()))

    # Balances use what is still owed (amount due minus what was received),
    # so a part-paid installment counts only for its remainder.
    remaining = remaining_by_installment(conn)
    open_insts = conn.execute(
        "SELECT i.id, i.due_date, i.currency, s.id AS student_id, s.name "
        "FROM installment i JOIN enrollment e ON i.enrollment_id = e.id JOIN student s ON e.student_id = s.id "
        "WHERE i.status IN ('open','partial','overdue') AND i.due_date IS NOT NULL"
    ).fetchall()
    overdue = [r for r in open_insts if r["due_date"] < iso and remaining.get(r["id"], 0) > 0]
    overdue_count = len(overdue)
    by_cur: dict[str, dict] = {}
    for r in overdue:
        b = by_cur.setdefault(r["currency"], {"currency": r["currency"], "amount_paise": 0, "count": 0})
        b["amount_paise"] += remaining[r["id"]]
        b["count"] += 1
    overdue_by_currency = [by_cur[k] for k in sorted(by_cur)]
    oldest = min((r["due_date"] for r in overdue), default=None)

    matched = _one(conn, "SELECT COUNT(*) FROM match_result WHERE status IN ('auto','approved')")
    suggested = _one(conn, "SELECT COUNT(*) FROM match_result WHERE status='pending_review' AND allocations != '[]'")
    needs_review = _one(conn, "SELECT COUNT(*) FROM match_result WHERE status='pending_review' AND allocations = '[]'")
    unmatched = _one(conn, "SELECT COUNT(*) FROM payment_in p LEFT JOIN match_result mr ON mr.payment_id=p.id WHERE mr.id IS NULL")

    confirmation = {r[0]: r[1] for r in conn.execute(
        "SELECT confirmation, COUNT(*) FROM payment_in GROUP BY confirmation").fetchall()}

    # Expected vs collected per month (INR), only months with activity
    months = []
    lo = conn.execute("SELECT MIN(d) FROM (SELECT MIN(date) AS d FROM payment_in UNION SELECT MIN(due_date) FROM installment) t").fetchone()[0]
    hi = conn.execute("SELECT MAX(d) FROM (SELECT MAX(date) AS d FROM payment_in UNION SELECT MAX(due_date) FROM installment) t").fetchone()[0]
    if lo and hi:
        cur = date.fromisoformat(lo).replace(day=1)
        end = date.fromisoformat(hi).replace(day=1)
        while cur <= end:
            a, b = _month_range(cur)
            e, c = expected(a, b), received(a, b)
            if e or c:
                months.append({"month": a.isoformat()[:7], "expected_paise": e, "collected_paise": c})
            cur = b + timedelta(days=1)

    forecast = []
    for i in range(6):
        ws = as_of + timedelta(weeks=i)
        we = ws + timedelta(days=6)
        scheduled = sum(remaining.get(r["id"], 0) for r in open_insts
                        if r["currency"] == "INR" and ws.isoformat() <= r["due_date"] <= we.isoformat())
        forecast.append({"week_start": ws, "scheduled_paise": scheduled, "likely_paise": scheduled * 7 // 10})

    commissions = [dict(r) for r in conn.execute(
        "SELECT currency, COALESCE(SUM(commission_paise),0) AS earned_paise, COALESCE(SUM(tds_paise),0) AS tds_paise, "
        "COALESCE(SUM(net_paise),0) AS net_paise, COUNT(DISTINCT counselor_id) AS counselors "
        "FROM commission_line GROUP BY currency ORDER BY currency").fetchall()]

    owing: dict[tuple, dict] = {}
    for r in overdue:
        k = (r["student_id"], r["currency"])
        o = owing.setdefault(k, {"student_id": r["student_id"], "name": r["name"], "currency": r["currency"],
                                 "owed_paise": 0, "earliest_due": r["due_date"]})
        o["owed_paise"] += remaining[r["id"]]
        o["earliest_due"] = min(o["earliest_due"], r["due_date"])
    top_owing = sorted(owing.values(), key=lambda o: (-o["owed_paise"], o["student_id"]))[:5]
    largest_unmatched = [dict(r) for r in conn.execute(
        "SELECT p.id, p.payer_name, p.amount_paid_paise, p.currency, p.date, p.method FROM payment_in p "
        "LEFT JOIN match_result mr ON mr.payment_id=p.id WHERE mr.id IS NULL "
        "ORDER BY p.amount_paid_paise DESC, p.id LIMIT 5").fetchall()]

    flags = scan_risks(conn, as_of=as_of)
    reminders = generate_reminders(conn, as_of=as_of)

    return {
        "as_of": as_of,
        "month": {
            "currency": "INR",
            "received_paise": received_this,
            "received_last_month_paise": received_last,
            "expected_paise": expected_this,
            "spent_paise": spent_this,
            "collection_rate_pct": round(received_this * 100 / expected_this, 1) if expected_this else None,
        },
        "overdue": {
            "count": overdue_count,
            "by_currency": overdue_by_currency,
            "oldest_days": (as_of - date.fromisoformat(oldest)).days if oldest else 0,
        },
        "matching": {
            "matched": matched,
            "suggested": suggested,
            "needs_review": needs_review,
            "pending_total": suggested + needs_review,
            "never_matched": unmatched,
        },
        "confirmation": {k: confirmation.get(k, 0) for k in ("in_bank", "seen_by_gateway", "screenshot_only")},
        "months": months,
        "forecast": forecast,
        "commissions": commissions,
        "risk": {
            "high": sum(f.severity == "high" for f in flags),
            "medium": sum(f.severity == "medium" for f in flags),
            "low": sum(f.severity == "low" for f in flags),
        },
        "reminders": {
            "total": len(reminders),
            "overdue": sum(r.reminder_type == "overdue" for r in reminders),
            "needs_approval": sum(r.needs_approval for r in reminders),
        },
        "top_owing": top_owing,
        "largest_unmatched": largest_unmatched,
    }
