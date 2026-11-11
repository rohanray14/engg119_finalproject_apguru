"""Read-only screens: payments, students, money out, risk flags."""

from __future__ import annotations

import json
from datetime import date, timedelta
from typing import Literal, Optional

from fastapi import APIRouter, Depends, Query

from api.allocation import remaining_by_installment
from api.auth import User, current_user
from api.common import not_found, parse_allocations, resolve_as_of
from api.database import get_conn

router = APIRouter(tags=["ledger"])

MatchFilter = Literal["matched", "unmatched", "pending_review", "rejected"]


@router.get("/payments")
def list_payments(
    source: Optional[Literal["bank", "gateway", "cash", "screenshot"]] = None,
    currency: Optional[str] = Query(None, min_length=3, max_length=3),
    confirmation: Optional[Literal["in_bank", "seen_by_gateway", "screenshot_only"]] = None,
    match: Optional[MatchFilter] = None,
    search: Optional[str] = Query(None, max_length=100, description="Payer name contains"),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    conn=Depends(get_conn),
    user: User = Depends(current_user),
):
    where, params = ["1=1"], []
    if source:
        where.append("p.source = ?")
        params.append(source)
    if currency:
        where.append("p.currency = ?")
        params.append(currency.upper())
    if confirmation:
        where.append("p.confirmation = ?")
        params.append(confirmation)
    if search:
        where.append("p.payer_name LIKE ?")
        params.append(f"%{search}%")
    if match == "matched":
        where.append("mr.status IN ('auto','approved')")
    elif match == "unmatched":
        where.append("mr.id IS NULL")
    elif match in ("pending_review", "rejected"):
        where.append("mr.status = ?")
        params.append(match)

    base = ("FROM payment_in p LEFT JOIN match_result mr ON mr.payment_id = p.id "
            "WHERE " + " AND ".join(where))
    total = conn.execute(f"SELECT COUNT(*) {base}", params).fetchone()[0]
    rows = conn.execute(
        "SELECT p.id, p.source, p.method, p.payer_name, p.date, p.amount_paid_paise, p.currency, "
        "p.gateway_fee_paise, p.gst_on_fee_paise, p.fx_diff_paise, p.tds_paise, "
        "p.amount_in_bank_paise, p.confirmation, mr.id AS match_id, mr.status AS match_status, "
        "mr.allocations "
        f"{base} ORDER BY p.date DESC, p.id DESC LIMIT ? OFFSET ?",
        [*params, limit, offset],
    ).fetchall()

    # Resolve matched student for each payment via allocations → installment → enrollment → student
    all_allocs = {}  # match_id -> list of installment_ids
    all_inst_ids = set()
    for r in rows:
        if r["allocations"] and r["match_status"] in ("auto", "approved", "pending_review"):
            parsed = parse_allocations(r["allocations"])
            iids = [int(a["installment_id"]) for a in parsed]
            all_allocs[r["match_id"]] = iids
            all_inst_ids.update(iids)

    # Batch lookup: installment_id -> (student_id, student_name)
    inst_to_student: dict[int, tuple[int, str]] = {}
    if all_inst_ids:
        marks = ",".join("?" * len(all_inst_ids))
        for r2 in conn.execute(
            "SELECT i.id AS inst_id, s.id AS student_id, s.name AS student_name "
            "FROM installment i JOIN enrollment e ON i.enrollment_id = e.id "
            f"JOIN student s ON e.student_id = s.id WHERE i.id IN ({marks})",
            list(all_inst_ids),
        ).fetchall():
            inst_to_student[r2["inst_id"]] = (r2["student_id"], r2["student_name"])

    items = []
    for r in rows:
        d = dict(r)
        d.pop("allocations", None)
        d["deductions_paise"] = (r["gateway_fee_paise"] + r["gst_on_fee_paise"]
                                 + r["fx_diff_paise"] + r["tds_paise"])
        d["match_status"] = r["match_status"] or "unmatched"
        # Attach matched student info
        d["matched_student_id"] = None
        d["matched_student_name"] = None
        if r["match_id"] in all_allocs:
            for iid in all_allocs[r["match_id"]]:
                if iid in inst_to_student:
                    d["matched_student_id"] = inst_to_student[iid][0]
                    d["matched_student_name"] = inst_to_student[iid][1]
                    break
        items.append(d)

    # Global summary stats (unfiltered) for the summary cards
    summary = conn.execute(
        "SELECT "
        "COUNT(*) AS total_payments, "
        "COALESCE(SUM(p.amount_in_bank_paise), 0) AS total_received, "
        "SUM(CASE WHEN p.confirmation = 'screenshot_only' THEN 1 ELSE 0 END) AS screenshot_count, "
        "SUM(CASE WHEN mr.id IS NULL THEN 1 ELSE 0 END) AS unmatched_count, "
        "SUM(CASE WHEN mr.status = 'pending_review' THEN 1 ELSE 0 END) AS review_count, "
        "SUM(CASE WHEN p.payer_name IS NULL OR p.payer_name = '' THEN 1 ELSE 0 END) AS blank_count "
        "FROM payment_in p LEFT JOIN match_result mr ON mr.payment_id = p.id"
    ).fetchone()

    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "items": items,
        "summary": {
            "total_received": summary["total_received"],
            "total_payments": summary["total_payments"],
            "screenshot_count": summary["screenshot_count"],
            "unmatched_count": summary["unmatched_count"],
            "review_count": summary["review_count"],
            "blank_count": summary["blank_count"],
        },
    }


@router.get("/students")
def list_students(
    search: Optional[str] = Query(None, max_length=100),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    conn=Depends(get_conn),
    user: User = Depends(current_user),
):
    where, params = "", []
    if search:
        where, params = "WHERE s.name LIKE ?", [f"%{search}%"]
    total = conn.execute(f"SELECT COUNT(*) FROM student s {where}", params).fetchone()[0]
    students = conn.execute(
        f"SELECT s.id, s.name, s.city, s.country FROM student s {where} ORDER BY s.name, s.id LIMIT ? OFFSET ?",
        [*params, limit, offset],
    ).fetchall()
    ids = [s["id"] for s in students]
    owed: dict[int, list] = {i: [] for i in ids}
    next_due: dict[int, Optional[str]] = {i: None for i in ids}
    enrollments: dict[int, int] = {i: 0 for i in ids}
    if ids:
        marks = ",".join("?" * len(ids))
        remaining = remaining_by_installment(conn)
        sums: dict[tuple, int] = {}
        for r in conn.execute(
            "SELECT i.id, e.student_id, i.currency, i.due_date FROM installment i "
            "JOIN enrollment e ON i.enrollment_id = e.id "
            f"WHERE e.student_id IN ({marks}) AND i.status IN ('open','overdue','partial')", ids).fetchall():
            left = remaining.get(r["id"], 0)
            if left <= 0:
                continue
            sums[(r["student_id"], r["currency"])] = sums.get((r["student_id"], r["currency"]), 0) + left
            nd = next_due[r["student_id"]]
            if r["due_date"] and (nd is None or r["due_date"] < nd):
                next_due[r["student_id"]] = r["due_date"]
        for (sid, cur), amt in sorted(sums.items()):
            owed[sid].append({"currency": cur, "amount_paise": amt})
        for r in conn.execute(
            f"SELECT student_id, COUNT(*) AS n FROM enrollment WHERE student_id IN ({marks}) GROUP BY student_id",
            ids).fetchall():
            enrollments[r["student_id"]] = r["n"]
    items = [{
        **dict(s),
        "owed": owed[s["id"]],
        "next_due": next_due[s["id"]],
        "enrollment_count": enrollments[s["id"]],
        "status": "outstanding" if owed[s["id"]] else "paid_up",
    } for s in students]
    return {"total": total, "limit": limit, "offset": offset, "items": items}


@router.get("/students/{student_id}")
def get_student(student_id: int, conn=Depends(get_conn), user: User = Depends(current_user)):
    s = conn.execute("SELECT * FROM student WHERE id = ?", (student_id,)).fetchone()
    if s is None:
        raise not_found("Student")

    def _json_list(v):
        try:
            return json.loads(v) if v else []
        except ValueError:
            return []

    remaining = remaining_by_installment(conn)
    enrollments = []
    inst_ids = set()
    for e in conn.execute("SELECT * FROM enrollment WHERE student_id = ? ORDER BY id", (student_id,)).fetchall():
        insts = [dict(i) for i in conn.execute(
            "SELECT id, due_date, amount_due_paise, currency, status FROM installment "
            "WHERE enrollment_id = ? ORDER BY due_date, id", (e["id"],)).fetchall()]
        for i in insts:
            i["remaining_paise"] = remaining.get(i["id"], i["amount_due_paise"])
        inst_ids.update(i["id"] for i in insts)
        enrollments.append({**dict(e), "gst_applicable": bool(e["gst_applicable"]), "installments": insts})

    payments = []
    for m in conn.execute(
        "SELECT mr.id AS match_id, mr.status AS match_status, mr.allocations, p.id, p.date, p.payer_name, "
        "p.amount_paid_paise, p.currency, p.confirmation FROM match_result mr "
        "JOIN payment_in p ON p.id = mr.payment_id WHERE mr.status IN ('auto','approved','pending_review') "
        "ORDER BY p.date DESC").fetchall():
        linked = [int(a["installment_id"]) for a in parse_allocations(m["allocations"])]
        if inst_ids.intersection(linked):
            d = dict(m)
            d.pop("allocations")
            payments.append(d)

    return {
        "id": s["id"], "name": s["name"], "city": s["city"], "country": s["country"],
        "aliases": _json_list(s["aliases"]), "payer_aliases": _json_list(s["payer_aliases"]),
        "parent_name": s["parent_name"] or None,
        "parent_phone": s["parent_phone"] or None,
        "parent_email": s["parent_email"] or None,
        "enrollments": enrollments, "payments": payments,
    }


def _mo_month_range(d: date) -> tuple[date, date]:
    first = d.replace(day=1)
    nxt = first.replace(year=first.year + 1, month=1) if first.month == 12 else first.replace(month=first.month + 1)
    return first, nxt - timedelta(days=1)


def _mo_add_months(d: date, n: int) -> date:
    month = d.month - 1 + n
    year = d.year + month // 12
    month = month % 12 + 1
    return d.replace(year=year, month=month, day=1)


@router.get("/money-out")
def money_out(
    category: Optional[str] = Query(None, max_length=30),
    currency: Optional[str] = Query(None, min_length=3, max_length=3),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    conn=Depends(get_conn),
    user: User = Depends(current_user),
):
    summary = [dict(r) for r in conn.execute(
        "SELECT category, currency, COUNT(*) AS count, SUM(amount_paise) AS total_paise "
        "FROM payment_out GROUP BY category, currency ORDER BY total_paise DESC").fetchall()]
    where, params = ["1=1"], []
    if category:
        where.append("category = ?")
        params.append(category)
    if currency:
        where.append("currency = ?")
        params.append(currency.upper())
    clause = " AND ".join(where)
    total = conn.execute(f"SELECT COUNT(*) FROM payment_out WHERE {clause}", params).fetchone()[0]
    rows = [dict(r) for r in conn.execute(
        f"SELECT * FROM payment_out WHERE {clause} ORDER BY date DESC, id DESC LIMIT ? OFFSET ?",
        [*params, limit, offset]).fetchall()]

    # ── Monthly spend by category ──
    min_row = conn.execute("SELECT MIN(date) FROM payment_out").fetchone()
    max_row = conn.execute("SELECT MAX(date) FROM payment_out").fetchone()
    monthly_spend: list[dict] = []
    if min_row[0] and max_row[0]:
        cursor = date.fromisoformat(min_row[0]).replace(day=1)
        end = date.fromisoformat(max_row[0]).replace(day=1)
        while cursor <= end:
            ms, me = _mo_month_range(cursor)
            cats = conn.execute(
                "SELECT category, SUM(amount_paise) AS total_paise FROM payment_out "
                "WHERE date BETWEEN ? AND ? GROUP BY category",
                (ms.isoformat(), me.isoformat()),
            ).fetchall()
            month_total = sum(c["total_paise"] for c in cats)
            if month_total > 0:
                by_cat = {c["category"]: c["total_paise"] for c in cats}
                monthly_spend.append({"month": ms.isoformat()[:7], "total_paise": month_total, "by_category": by_cat})
            cursor = _mo_add_months(cursor, 1)

    # ── Totals for metrics ──
    total_spent = conn.execute("SELECT COALESCE(SUM(amount_paise),0) FROM payment_out").fetchone()[0]
    total_received = conn.execute("SELECT COALESCE(SUM(amount_paid_paise),0) FROM payment_in").fetchone()[0]
    avg_monthly_burn = int(sum(m["total_paise"] for m in monthly_spend) / len(monthly_spend)) if monthly_spend else 0

    # ── Runway projection ──
    inflow_min = conn.execute(
        "SELECT MIN(d) FROM (SELECT MIN(date) AS d FROM payment_in UNION SELECT MIN(due_date) FROM installment) t"
    ).fetchone()[0]
    inflow_max = conn.execute(
        "SELECT MAX(d) FROM (SELECT MAX(date) AS d FROM payment_in UNION SELECT MAX(due_date) FROM installment) t"
    ).fetchone()[0]
    inflow_months: list[dict] = []
    if inflow_min and inflow_max:
        cursor = date.fromisoformat(inflow_min).replace(day=1)
        end = date.fromisoformat(inflow_max).replace(day=1)
        while cursor <= end:
            ms, me = _mo_month_range(cursor)
            exp = conn.execute(
                "SELECT COALESCE(SUM(amount_due_paise),0) FROM installment WHERE due_date BETWEEN ? AND ?",
                (ms.isoformat(), me.isoformat()),
            ).fetchone()[0]
            rec = conn.execute(
                "SELECT COALESCE(SUM(amount_paid_paise),0) FROM payment_in WHERE date BETWEEN ? AND ?",
                (ms.isoformat(), me.isoformat()),
            ).fetchone()[0]
            if exp > 0 or rec > 0:
                inflow_months.append({"expected": exp, "received": rec})
            cursor = _mo_add_months(cursor, 1)

    avg_expected = int(sum(m["expected"] for m in inflow_months) / len(inflow_months)) if inflow_months else 0
    avg_received = int(sum(m["received"] for m in inflow_months) / len(inflow_months)) if inflow_months else 0
    collection_rate_pct = round(avg_received * 100 / avg_expected, 1) if avg_expected > 0 else 0

    scenarios = [
        {"name": "current_rate", "drop_pct": 0},
        {"name": "drop_10", "drop_pct": 10},
        {"name": "drop_25", "drop_pct": 25},
        {"name": "drop_50", "drop_pct": 50},
    ]
    last_month_date = date.fromisoformat(max_row[0]).replace(day=1) if max_row[0] else date.today().replace(day=1)
    projection: list[dict] = []
    for i in range(1, 13):
        proj_month = _mo_add_months(last_month_date, i)
        row: dict = {"month": proj_month.isoformat()[:7]}
        for s in scenarios:
            rate = max(0, collection_rate_pct - s["drop_pct"]) / 100
            monthly_inflow = int(avg_expected * rate)
            monthly_net = monthly_inflow - avg_monthly_burn
            row[s["name"]] = monthly_net * i  # cumulative paise
        projection.append(row)

    runway = {
        "avg_monthly_expected_paise": avg_expected,
        "avg_monthly_received_paise": avg_received,
        "collection_rate_pct": collection_rate_pct,
        "avg_monthly_burn_paise": avg_monthly_burn,
        "projection": projection,
    }

    return {
        "summary": summary, "total": total, "limit": limit, "offset": offset, "items": rows,
        "total_spent_paise": total_spent,
        "total_received_paise": total_received,
        "avg_monthly_burn_paise": avg_monthly_burn,
        "monthly_spend": monthly_spend,
        "runway": runway,
    }


@router.get("/risk")
def risk(
    as_of: Optional[date] = None,
    severity: Optional[Literal["high", "medium", "low"]] = None,
    conn=Depends(get_conn),
    user: User = Depends(current_user),
):
    from agents.risk import scan_risks

    as_of = resolve_as_of(conn, as_of)
    flags = scan_risks(conn, as_of=as_of)
    counts = {s: sum(f.severity == s for f in flags) for s in ("high", "medium", "low")}
    if severity:
        flags = [f for f in flags if f.severity == severity]
    return {"as_of": as_of, "counts": counts, "items": [vars(f) for f in flags]}
