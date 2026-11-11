"""Reminders agent — generates payment reminder messages.

Schedule (from SPEC):
- 3 days before due date
- On due date
- 7 days after due date
- 3rd reminder or any dispute needs approval

Input: open/overdue installments from the ledger
Output: list of Reminder objects with correct student, amount, date, and message
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Optional


@dataclass
class Reminder:
    installment_id: int
    student_id: int
    student_name: str
    enrollment_program: str
    amount_due_paise: int
    currency: str
    due_date: Optional[date]
    reminder_type: str  # "pre_due", "on_due", "overdue"
    scheduled_for: date
    message: str
    needs_approval: bool  # True if 3rd+ reminder or dispute


# Schedule offsets (days relative to due date)
SCHEDULE = [
    (-3, "pre_due"),
    (0, "on_due"),
    (7, "overdue"),
]


def generate_reminders(
    conn: sqlite3.Connection,
    as_of: date | None = None,
) -> list[Reminder]:
    """Generate reminders for all open/overdue installments.

    Returns reminders that should be sent on or before `as_of`.
    """
    if as_of is None:
        as_of = date.today()

    installments = _get_open_installments(conn)
    existing = _get_existing_reminders(conn)

    reminders: list[Reminder] = []

    for inst in installments:
        due = _parse_date(inst["due_date"])
        if due is None:
            continue

        student_id = inst["student_id"]
        student_name = inst["student_name"]
        program = inst["program"]
        amount = inst["amount_due_paise"]
        currency = inst["currency"]
        inst_id = inst["id"]

        # Count existing reminders for this installment
        existing_count = existing.get(inst_id, 0)

        # Pick the single most relevant reminder type: the latest schedule
        # entry whose send_date has arrived.  An installment that is 7+ days
        # overdue should only appear as "overdue", not also as "pre_due" and
        # "on_due".
        best = None
        for offset_days, rtype in SCHEDULE:
            send_date = due + timedelta(days=offset_days)
            if send_date <= as_of:
                best = (offset_days, rtype, send_date)

        if best is None:
            continue  # none of the schedule entries apply yet

        offset_days, rtype, send_date = best
        reminder_index = SCHEDULE.index((offset_days, rtype))
        if reminder_index < existing_count:
            continue  # already sent

        needs_approval = (existing_count + 1) >= 3  # 3rd+ needs approval
        message = _compose_message(
            student_name, program, amount, currency, due, rtype,
        )

        reminders.append(Reminder(
            installment_id=inst_id,
            student_id=student_id,
            student_name=student_name,
            enrollment_program=program,
            amount_due_paise=amount,
            currency=currency,
            due_date=due,
            reminder_type=rtype,
            scheduled_for=send_date,
            message=message,
            needs_approval=needs_approval,
        ))

    return reminders


def _compose_message(
    student_name: str,
    program: str,
    amount_paise: int,
    currency: str,
    due_date: date,
    reminder_type: str,
) -> str:
    """Compose a reminder message."""
    amount_str = _fmt_amount(amount_paise, currency)
    date_str = due_date.strftime("%d/%m/%Y")

    if reminder_type == "pre_due":
        return (
            f"Dear Parent/Guardian of {student_name},\n\n"
            f"This is a friendly reminder that the payment of {amount_str} "
            f"for {program} is due on {date_str}.\n\n"
            f"Please arrange the payment at your earliest convenience.\n\n"
            f"Thank you,\nEducore Finance Team"
        )
    elif reminder_type == "on_due":
        return (
            f"Dear Parent/Guardian of {student_name},\n\n"
            f"The payment of {amount_str} for {program} is due today ({date_str}).\n\n"
            f"If you have already made the payment, please share the confirmation. "
            f"Otherwise, kindly arrange the payment today.\n\n"
            f"Thank you,\nEducore Finance Team"
        )
    else:  # overdue
        return (
            f"Dear Parent/Guardian of {student_name},\n\n"
            f"The payment of {amount_str} for {program} was due on {date_str} "
            f"and is now overdue.\n\n"
            f"Please arrange the payment immediately or contact us if you need "
            f"to discuss a payment plan.\n\n"
            f"Thank you,\nEducore Finance Team"
        )


def _fmt_amount(paise: int, currency: str) -> str:
    if currency == "INR":
        return f"₹{paise / 100:,.0f}"
    return f"{currency} {paise / 100:,.2f}"


def _get_open_installments(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute(
        "SELECT i.id, i.enrollment_id, i.due_date, i.amount_due_paise, "
        "i.currency, i.status, e.student_id, e.program, s.name as student_name "
        "FROM installment i "
        "JOIN enrollment e ON i.enrollment_id = e.id "
        "JOIN student s ON e.student_id = s.id "
        "WHERE i.status IN ('open', 'overdue', 'partial') "
        "ORDER BY i.due_date"
    ).fetchall()
    # Remind for what is still owed: a part-paid installment gets a reminder
    # for its remainder, a fully covered one gets none.
    from ledger.balances import remaining_by_installment

    remaining = remaining_by_installment(conn)
    out = []
    for r in rows:
        d = dict(r)
        d["amount_due_paise"] = remaining.get(d["id"], d["amount_due_paise"])
        if d["amount_due_paise"] > 0:
            out.append(d)
    return out


def _get_existing_reminders(conn: sqlite3.Connection) -> dict[int, int]:
    """Return {installment_id: count} of already-sent reminders."""
    from ledger.db import table_exists

    if not table_exists(conn, "reminder"):
        return {}
    rows = conn.execute(
        "SELECT installment_id, COUNT(*) as cnt FROM reminder GROUP BY installment_id"
    ).fetchall()
    return {r["installment_id"]: r["cnt"] for r in rows}


def _parse_date(val: str | None) -> date | None:
    if not val:
        return None
    try:
        return date.fromisoformat(val)
    except (ValueError, TypeError):
        return None
