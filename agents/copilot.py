"""Copilot agent — answers finance questions using the ledger.

Input: natural-language question
Output: answer text + cited transactions (table)

This is the rules-based version. Maps question patterns to SQL queries.
"""

from __future__ import annotations

import re
import sqlite3
from dataclasses import dataclass, field


@dataclass
class CopilotAnswer:
    question: str
    answer: str
    query_used: str = ""
    transactions: list[dict] = field(default_factory=list)
    confidence: float = 1.0


# Question patterns → handlers
_PATTERNS = [
    (r"(?:how much|total).*(?:received|collected|income)", "total_received"),
    (r"(?:how much|total).*(?:paid out|spent|outgoing|expenses?)", "total_paid_out"),
    (r"(?:how much).*(?:spend|spent)", "total_paid_out"),
    (r"(?:what are).*(?:expenses?|outgoing)", "total_paid_out"),
    (r"(?:how many).*overdue", "count_overdue"),
    (r"(?:how many|count).*(?:payment|transaction)", "count_payments"),
    (r"(?:how many).*student", "count_students"),
    (r"(?:who|which).*(?:owe|outstanding|unpaid|balance)", "who_owes"),
    (r"(?:who|which).*(?:paid|payment).*(?:most|largest|biggest|highest)", "largest_payments"),
    (r"(?:biggest|largest|highest).*(?:payment|transaction)", "largest_payments"),
    (r"(?:unmatched|not matched|pending)", "unmatched_payments"),
    (r"(?:commission|counselor).*(?:total|earned|due|owed)", "commission_totals"),
    (r"(?:payment|transaction).*(?:for|from|by)\s+(.+)", "payments_for"),
    (r"(?:student|detail).*(?:for|about|named?)\s+(.+)", "student_detail"),
    (r"(?:cash|net|balance).*(?:position|flow|forecast)", "cash_position"),
    (r"(?:breakdown|split|by).*(?:category|type)", "expense_breakdown"),
]


def ask(conn: sqlite3.Connection, question: str) -> CopilotAnswer:
    """Answer a finance question using the ledger."""
    q = question.strip().lower()

    for pattern, handler_name in _PATTERNS:
        m = re.search(pattern, q)
        if m:
            handler = _HANDLERS.get(handler_name)
            if handler:
                return handler(conn, question, m)

    return CopilotAnswer(
        question=question,
        answer="I'm not sure how to answer that. Try asking about totals, "
               "payments, students, overdue amounts, or commissions.",
        confidence=0.0,
    )


def _total_received(conn: sqlite3.Connection, question: str, m) -> CopilotAnswer:
    row = conn.execute(
        "SELECT currency, SUM(amount_paid_paise) as total, COUNT(*) as cnt "
        "FROM payment_in GROUP BY currency ORDER BY total DESC"
    ).fetchall()
    lines = []
    for r in row:
        lines.append(f"{r['currency']}: {r['total']/100:,.0f} ({r['cnt']} payments)")
    return CopilotAnswer(
        question=question,
        answer="Total received:\n" + "\n".join(lines),
        query_used="SELECT currency, SUM(amount_paid_paise), COUNT(*) FROM payment_in GROUP BY currency",
        transactions=[dict(r) for r in row],
    )


def _total_paid_out(conn: sqlite3.Connection, question: str, m) -> CopilotAnswer:
    row = conn.execute(
        "SELECT category, SUM(amount_paise) as total, COUNT(*) as cnt "
        "FROM payment_out GROUP BY category ORDER BY total DESC"
    ).fetchall()
    lines = []
    grand_total = 0
    for r in row:
        lines.append(f"  {r['category']}: ₹{r['total']/100:,.0f} ({r['cnt']})")
        grand_total += r['total']
    return CopilotAnswer(
        question=question,
        answer=f"Total paid out: ₹{grand_total/100:,.0f}\n" + "\n".join(lines),
        query_used="SELECT category, SUM(amount_paise), COUNT(*) FROM payment_out GROUP BY category",
        transactions=[dict(r) for r in row],
    )


def _count_payments(conn: sqlite3.Connection, question: str, m) -> CopilotAnswer:
    row = conn.execute("SELECT COUNT(*) as cnt FROM payment_in").fetchone()
    return CopilotAnswer(
        question=question,
        answer=f"There are {row['cnt']} incoming payments in the ledger.",
        query_used="SELECT COUNT(*) FROM payment_in",
    )


def _count_students(conn: sqlite3.Connection, question: str, m) -> CopilotAnswer:
    row = conn.execute("SELECT COUNT(*) as cnt FROM student").fetchone()
    return CopilotAnswer(
        question=question,
        answer=f"There are {row['cnt']} students in the system.",
        query_used="SELECT COUNT(*) FROM student",
    )


def _count_overdue(conn: sqlite3.Connection, question: str, m) -> CopilotAnswer:
    row = conn.execute(
        "SELECT COUNT(*) as cnt, COALESCE(SUM(amount_due_paise), 0) as total "
        "FROM installment WHERE status = 'overdue'"
    ).fetchone()
    return CopilotAnswer(
        question=question,
        answer=f"There are {row['cnt']} overdue installments totaling ₹{row['total']/100:,.0f}.",
        query_used="SELECT COUNT(*), SUM(amount_due_paise) FROM installment WHERE status='overdue'",
    )


def _who_owes(conn: sqlite3.Connection, question: str, m) -> CopilotAnswer:
    rows = conn.execute(
        "SELECT s.name, SUM(i.amount_due_paise) as owed, i.currency "
        "FROM installment i "
        "JOIN enrollment e ON i.enrollment_id = e.id "
        "JOIN student s ON e.student_id = s.id "
        "WHERE i.status IN ('open', 'overdue') "
        # Group per currency too: never add rupees to dollars (CLAUDE.md rule 8).
        "GROUP BY s.id, s.name, i.currency ORDER BY owed DESC LIMIT 20"
    ).fetchall()
    lines = []
    for r in rows:
        lines.append(f"  {r['name']}: {r['currency']} {r['owed']/100:,.0f}")
    return CopilotAnswer(
        question=question,
        answer=f"Top students with outstanding balances:\n" + "\n".join(lines),
        query_used="SELECT student, SUM(amount_due) ... WHERE status IN (open, overdue) GROUP BY student",
        transactions=[dict(r) for r in rows],
    )


def _largest_payments(conn: sqlite3.Connection, question: str, m) -> CopilotAnswer:
    rows = conn.execute(
        "SELECT id, payer_name, amount_paid_paise, currency, date, source "
        "FROM payment_in ORDER BY amount_paid_paise DESC LIMIT 10"
    ).fetchall()
    lines = []
    for r in rows:
        lines.append(
            f"  #{r['id']}: {r['payer_name'] or '(blank)'} — "
            f"{r['currency']} {r['amount_paid_paise']/100:,.0f} on {r['date'] or '?'}"
        )
    return CopilotAnswer(
        question=question,
        answer="Largest payments:\n" + "\n".join(lines),
        query_used="SELECT * FROM payment_in ORDER BY amount_paid_paise DESC LIMIT 10",
        transactions=[dict(r) for r in rows],
    )


def _unmatched_payments(conn: sqlite3.Connection, question: str, m) -> CopilotAnswer:
    rows = conn.execute(
        "SELECT p.id, p.payer_name, p.amount_paid_paise, p.currency, p.date "
        "FROM payment_in p "
        "LEFT JOIN match_result mr ON mr.payment_id = p.id "
        "AND mr.status IN ('auto', 'approved') "
        "WHERE mr.id IS NULL "
        "ORDER BY p.amount_paid_paise DESC LIMIT 20"
    ).fetchall()
    return CopilotAnswer(
        question=question,
        answer=f"There are {len(rows)} unmatched payments (showing top 20 by amount).",
        query_used="SELECT payment_in LEFT JOIN match_result WHERE match IS NULL",
        transactions=[dict(r) for r in rows],
    )


def _commission_totals(conn: sqlite3.Connection, question: str, m) -> CopilotAnswer:
    rows = conn.execute(
        "SELECT c.name, "
        "COALESCE(SUM(cl.commission_paise), 0) as earned, "
        "COALESCE(SUM(cl.tds_paise), 0) as tds, "
        "COALESCE(SUM(cl.net_paise), 0) as net "
        "FROM counselor c "
        "LEFT JOIN commission_line cl ON cl.counselor_id = c.id "
        "GROUP BY c.id ORDER BY earned DESC"
    ).fetchall()
    lines = []
    for r in rows:
        if r['earned'] > 0:
            lines.append(
                f"  {r['name']}: earned ₹{r['earned']/100:,.0f}, "
                f"TDS ₹{r['tds']/100:,.0f}, net ₹{r['net']/100:,.0f}"
            )
    if not lines:
        return CopilotAnswer(question=question, answer="No commissions computed yet.")
    return CopilotAnswer(
        question=question,
        answer="Commission totals:\n" + "\n".join(lines),
        query_used="SELECT counselor, SUM(commission), SUM(tds), SUM(net) ... GROUP BY counselor",
        transactions=[dict(r) for r in rows],
    )


def _payments_for(conn: sqlite3.Connection, question: str, m) -> CopilotAnswer:
    name = m.group(1).strip().rstrip("?.")
    rows = conn.execute(
        "SELECT id, payer_name, amount_paid_paise, currency, date, source "
        "FROM payment_in WHERE payer_name LIKE ? "
        "ORDER BY date DESC LIMIT 20",
        (f"%{name}%",),
    ).fetchall()
    if not rows:
        return CopilotAnswer(
            question=question,
            answer=f"No payments found for '{name}'.",
        )
    return CopilotAnswer(
        question=question,
        answer=f"Found {len(rows)} payment(s) matching '{name}'.",
        transactions=[dict(r) for r in rows],
    )


def _student_detail(conn: sqlite3.Connection, question: str, m) -> CopilotAnswer:
    name = m.group(1).strip().rstrip("?.")
    student = conn.execute(
        "SELECT * FROM student WHERE name LIKE ? LIMIT 1",
        (f"%{name}%",),
    ).fetchone()
    if not student:
        return CopilotAnswer(question=question, answer=f"No student found matching '{name}'.")

    enrollments = conn.execute(
        "SELECT * FROM enrollment WHERE student_id = ?", (student["id"],)
    ).fetchall()
    installments = conn.execute(
        "SELECT i.* FROM installment i "
        "JOIN enrollment e ON i.enrollment_id = e.id "
        "WHERE e.student_id = ?", (student["id"],)
    ).fetchall()

    total_due = sum(i["amount_due_paise"] for i in installments if i["status"] in ("open", "overdue"))
    lines = [
        f"Student: {student['name']} (ID: {student['id']})",
        f"City: {student['city'] or '?'}, Country: {student['country'] or '?'}",
        f"Enrollments: {len(enrollments)}",
        f"Outstanding: ₹{total_due/100:,.0f}",
    ]
    return CopilotAnswer(
        question=question,
        answer="\n".join(lines),
        transactions=[dict(i) for i in installments],
    )


def _cash_position(conn: sqlite3.Connection, question: str, m) -> CopilotAnswer:
    inflow = conn.execute(
        "SELECT COALESCE(SUM(amount_paid_paise), 0) FROM payment_in WHERE currency='INR'"
    ).fetchone()[0]
    outflow = conn.execute(
        "SELECT COALESCE(SUM(amount_paise), 0) FROM payment_out WHERE currency='INR'"
    ).fetchone()[0]
    net = inflow - outflow
    return CopilotAnswer(
        question=question,
        answer=(
            f"Cash position (INR):\n"
            f"  Inflow:  ₹{inflow/100:,.0f}\n"
            f"  Outflow: ₹{outflow/100:,.0f}\n"
            f"  Net:     ₹{net/100:,.0f}"
        ),
        query_used="SUM(payment_in) - SUM(payment_out)",
    )


def _expense_breakdown(conn: sqlite3.Connection, question: str, m) -> CopilotAnswer:
    return _total_paid_out(conn, question, m)


_HANDLERS = {
    "total_received": _total_received,
    "total_paid_out": _total_paid_out,
    "count_payments": _count_payments,
    "count_students": _count_students,
    "count_overdue": _count_overdue,
    "who_owes": _who_owes,
    "largest_payments": _largest_payments,
    "unmatched_payments": _unmatched_payments,
    "commission_totals": _commission_totals,
    "payments_for": _payments_for,
    "student_detail": _student_detail,
    "cash_position": _cash_position,
    "expense_breakdown": _expense_breakdown,
}
