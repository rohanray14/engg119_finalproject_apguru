"""Insights endpoint: business-level aggregations for the finance lead."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from api.auth import User, current_user
from api.database import get_conn

router = APIRouter(tags=["insights"])

# Normalise messy country / city strings coming from the fee tracker.
_COUNTRY_MAP: dict[str, str] = {
    "in": "India", "india": "India",
    "us": "United States", "usa": "United States", "united states": "United States",
    "uk": "United Kingdom", "united kingdom": "United Kingdom",
    "uae": "UAE", "u.a.e": "UAE", "u.a.e.": "UAE",
    "united arab emirates": "UAE", "dubai": "UAE",
    "sg": "Singapore", "singapore": "Singapore",
}

def _norm_country(raw: str) -> str:
    return _COUNTRY_MAP.get(raw.strip().lower(), raw.strip().title())

def _norm_city(raw: str) -> str:
    return raw.strip().title()

def _merge_rows(rows: list[dict], key: str, norm_fn, sum_fields: list[str], count_fields: list[str]) -> list[dict]:
    """Merge rows whose key normalises to the same value."""
    merged: dict[str, dict] = {}
    for r in rows:
        k = norm_fn(r[key])
        if k in merged:
            for f in sum_fields:
                merged[k][f] += r.get(f, 0) or 0
            for f in count_fields:
                merged[k][f] += r.get(f, 0) or 0
        else:
            merged[k] = {**r, key: k}
    return sorted(merged.values(), key=lambda x: x.get(sum_fields[0], 0), reverse=True)


@router.get("/insights")
def insights(conn=Depends(get_conn), user: User = Depends(current_user)):
    """Return aggregated business insights across multiple dimensions."""

    # --- By program ---
    by_program = conn.execute("""
        SELECT e.program,
               COUNT(DISTINCT e.student_id) AS students,
               COUNT(DISTINCT e.id) AS enrollments,
               SUM(i.amount_due_paise) AS total_fee_paise,
               COALESCE(SUM(CASE WHEN mr.status IN ('auto','approved')
                   THEN p.amount_in_bank_paise ELSE 0 END), 0) AS collected_paise
        FROM enrollment e
        JOIN installment i ON i.enrollment_id = e.id
        LEFT JOIN match_result mr ON mr.status IN ('auto','approved')
            AND EXISTS (
                SELECT 1 FROM json_each(mr.allocations) j
                WHERE json_extract(j.value, '$.installment_id') = i.id
            )
        LEFT JOIN payment_in p ON p.id = mr.payment_id
        GROUP BY e.program
        ORDER BY collected_paise DESC
    """).fetchall()

    # --- By geography (country) ---
    by_country = conn.execute("""
        SELECT COALESCE(s.country, 'Unknown') AS country,
               COUNT(DISTINCT s.id) AS students,
               SUM(i.amount_due_paise) AS total_fee_paise,
               COALESCE(SUM(CASE WHEN mr.status IN ('auto','approved')
                   THEN p.amount_in_bank_paise ELSE 0 END), 0) AS collected_paise
        FROM student s
        JOIN enrollment e ON e.student_id = s.id
        JOIN installment i ON i.enrollment_id = e.id
        LEFT JOIN match_result mr ON mr.status IN ('auto','approved')
            AND EXISTS (
                SELECT 1 FROM json_each(mr.allocations) j
                WHERE json_extract(j.value, '$.installment_id') = i.id
            )
        LEFT JOIN payment_in p ON p.id = mr.payment_id
        GROUP BY country
        ORDER BY collected_paise DESC
    """).fetchall()

    # --- By city (top 10) ---
    by_city = conn.execute("""
        SELECT COALESCE(s.city, 'Unknown') AS city,
               COUNT(DISTINCT s.id) AS students,
               COALESCE(SUM(CASE WHEN mr.status IN ('auto','approved')
                   THEN p.amount_in_bank_paise ELSE 0 END), 0) AS collected_paise
        FROM student s
        JOIN enrollment e ON e.student_id = s.id
        JOIN installment i ON i.enrollment_id = e.id
        LEFT JOIN match_result mr ON mr.status IN ('auto','approved')
            AND EXISTS (
                SELECT 1 FROM json_each(mr.allocations) j
                WHERE json_extract(j.value, '$.installment_id') = i.id
            )
        LEFT JOIN payment_in p ON p.id = mr.payment_id
        GROUP BY city
        ORDER BY collected_paise DESC
        LIMIT 10
    """).fetchall()

    # --- By fee model ---
    by_fee_model = conn.execute("""
        SELECT e.fee_model,
               COUNT(DISTINCT e.student_id) AS students,
               COUNT(DISTINCT e.id) AS enrollments,
               SUM(i.amount_due_paise) AS total_fee_paise,
               COALESCE(SUM(CASE WHEN mr.status IN ('auto','approved')
                   THEN p.amount_in_bank_paise ELSE 0 END), 0) AS collected_paise
        FROM enrollment e
        JOIN installment i ON i.enrollment_id = e.id
        LEFT JOIN match_result mr ON mr.status IN ('auto','approved')
            AND EXISTS (
                SELECT 1 FROM json_each(mr.allocations) j
                WHERE json_extract(j.value, '$.installment_id') = i.id
            )
        LEFT JOIN payment_in p ON p.id = mr.payment_id
        GROUP BY e.fee_model
        ORDER BY collected_paise DESC
    """).fetchall()

    # --- By payment method ---
    by_method = conn.execute("""
        SELECT COALESCE(p.method, p.source) AS pay_method,
               COUNT(*) AS payments,
               SUM(p.amount_in_bank_paise) AS collected_paise
        FROM payment_in p
        JOIN match_result mr ON mr.payment_id = p.id AND mr.status IN ('auto','approved')
        GROUP BY pay_method
        ORDER BY collected_paise DESC
    """).fetchall()

    # --- Monthly revenue (last 12 months) ---
    by_month = conn.execute("""
        SELECT substr(p.date, 1, 7) AS month,
               COUNT(*) AS payments,
               SUM(p.amount_in_bank_paise) AS collected_paise
        FROM payment_in p
        JOIN match_result mr ON mr.payment_id = p.id AND mr.status IN ('auto','approved')
        WHERE p.date IS NOT NULL
        GROUP BY month
        ORDER BY month
    """).fetchall()

    # --- Collection health ---
    total_due = conn.execute("SELECT COALESCE(SUM(amount_due_paise), 0) FROM installment").fetchone()[0]
    total_collected = conn.execute("""
        SELECT COALESCE(SUM(p.amount_in_bank_paise), 0)
        FROM payment_in p
        JOIN match_result mr ON mr.payment_id = p.id AND mr.status IN ('auto','approved')
    """).fetchone()[0]
    overdue_count = conn.execute(
        "SELECT COUNT(*) FROM installment WHERE status = 'overdue'"
    ).fetchone()[0]
    total_installments = conn.execute("SELECT COUNT(*) FROM installment").fetchone()[0]

    # Previous-month collection rate for MoM comparison
    prev_month_rate = None
    if len(by_month) >= 2:
        last_two = by_month[-2:]  # already sorted by month ASC
        prev_collected = last_two[0]["collected_paise"] or 0
        curr_collected = last_two[1]["collected_paise"] or 0
        if prev_collected > 0:
            prev_month_rate = round((curr_collected - prev_collected) / prev_collected, 3)

    country_rows = _merge_rows(
        [dict(r) for r in by_country], "country", _norm_country,
        sum_fields=["collected_paise", "total_fee_paise"], count_fields=["students"],
    )
    city_rows = _merge_rows(
        [dict(r) for r in by_city], "city", _norm_city,
        sum_fields=["collected_paise"], count_fields=["students"],
    )

    return {
        "by_program": [dict(r) for r in by_program],
        "by_country": country_rows,
        "by_city": city_rows,
        "by_fee_model": [dict(r) for r in by_fee_model],
        "by_method": [dict(r) for r in by_method],
        "by_month": [dict(r) for r in by_month],
        "collection": {
            "total_due_paise": total_due,
            "total_collected_paise": total_collected,
            "collection_rate": round(total_collected / total_due, 3) if total_due > 0 else 0,
            "overdue_installments": overdue_count,
            "total_installments": total_installments,
            "mom_change": prev_month_rate,
        },
    }
