"""Helpers shared by the routers."""

from __future__ import annotations

import json
from datetime import date, datetime
from typing import Optional
from zoneinfo import ZoneInfo

from fastapi import HTTPException

# Amounts leave the API as integer paise (minor units) plus a currency code.
# The front end formats them; the API never sends floats for money.


def data_date_range(conn) -> tuple[Optional[date], Optional[date]]:
    row = conn.execute(
        "SELECT MIN(due_date), MAX(due_date) FROM installment WHERE due_date IS NOT NULL"
    ).fetchone()
    lo = date.fromisoformat(row[0]) if row and row[0] else None
    hi = date.fromisoformat(row[1]) if row and row[1] else None
    return lo, hi


BUSINESS_TZ = ZoneInfo("Asia/Kolkata")


def today_in_india() -> date:
    """Cloud Run runs in UTC; the business day is Indian time."""
    return datetime.now(BUSINESS_TZ).date()


def resolve_as_of(conn, as_of: Optional[date]) -> date:
    """Explicit date wins; otherwise today, unless today falls outside the
    data (demo data), in which case the middle of the data range."""
    if as_of:
        return as_of
    today = today_in_india()
    lo, hi = data_date_range(conn)
    if lo and hi and not (lo <= today <= hi):
        return lo + (hi - lo) // 2
    return today


def parse_allocations(raw: Optional[str]) -> list[dict]:
    try:
        allocs = json.loads(raw or "[]")
    except ValueError:
        return []
    return [a for a in allocs if isinstance(a, dict) and "installment_id" in a]


def not_found(what: str) -> HTTPException:
    return HTTPException(status_code=404, detail=f"{what} not found")


def conflict(detail: str) -> HTTPException:
    return HTTPException(status_code=409, detail=detail)
