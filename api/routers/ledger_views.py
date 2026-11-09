"""Read-only screens: payments, students, money out, risk flags."""

from __future__ import annotations

import json
from datetime import date
from typing import Literal, Optional

from fastapi import APIRouter, Depends, Query

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
        "p.amount_in_bank_paise, p.confirmation, mr.id AS match_id, mr.status AS match_status "
        f"{base} ORDER BY p.date DESC, p.id DESC LIMIT ? OFFSET ?",
        [*params, limit, offset],
    ).fetchall()
    items = []
    for r in rows:
        d = dict(r)
        d["deductions_paise"] = (r["gateway_fee_paise"] + r["gst_on_fee_paise"]
                                 + r["fx_diff_paise"] + r["tds_paise"])
        d["match_status"] = r["match_status"] or "unmatched"
        items.append(d)
    return {"total": total, "limit": limit, "offset": offset, "items": items}


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
        for r in conn.execute(
            "SELECT e.student_id, i.currency, SUM(i.amount_due_paise) AS owed_paise, MIN(i.due_date) AS next_due "
            "FROM installment i JOIN enrollment e ON i.enrollment_id = e.id "
            f"WHERE e.student_id IN ({marks}) AND i.status IN ('open','overdue','partial') "
            "GROUP BY e.student_id, i.currency", ids).fetchall():
            owed[r["student_id"]].append({"currency": r["currency"], "amount_paise": r["owed_paise"]})
            nd = next_due[r["student_id"]]
            if r["next_due"] and (nd is None or r["next_due"] < nd):
                next_due[r["student_id"]] = r["next_due"]
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

    enrollments = []
    inst_ids = set()
    for e in conn.execute("SELECT * FROM enrollment WHERE student_id = ? ORDER BY id", (student_id,)).fetchall():
        insts = [dict(i) for i in conn.execute(
            "SELECT id, due_date, amount_due_paise, currency, status FROM installment "
            "WHERE enrollment_id = ? ORDER BY due_date, id", (e["id"],)).fetchall()]
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
        "enrollments": enrollments, "payments": payments,
    }


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
    return {"summary": summary, "total": total, "limit": limit, "offset": offset, "items": rows}


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
