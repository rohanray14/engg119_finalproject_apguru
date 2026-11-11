"""Students page — searchable list with detail view."""

import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

import json
import streamlit as st
from app.Home import get_db
from app.style import apply_theme, badge, fmt_inr, fmt_amount, fmt_date_display
from ledger.money import fx_convert

st.set_page_config(page_title="Students | Educore", page_icon="💰", layout="wide")
apply_theme()

conn = get_db()

with st.sidebar:
    st.markdown("## Educore")
    st.caption("Finance Desk")

st.title("Students")
st.caption("Current balances — outstanding amounts reflect all-time position, not a single month.")

# Pre-fill search from risk page navigation
default_search = ""
if st.session_state.get("risk_nav_student"):
    default_search = st.session_state.pop("risk_nav_student")

# Search
search = st.text_input("Search by name", default_search, placeholder="Type a student name...")

query = """
    SELECT s.id, s.name, s.city, s.country,
           COUNT(DISTINCT e.id) as enrollment_count,
           MIN(CASE WHEN i.status IN ('open','overdue') THEN i.due_date END) as next_due
    FROM student s
    LEFT JOIN enrollment e ON e.student_id = s.id
    LEFT JOIN installment i ON i.enrollment_id = e.id
    WHERE 1=1
"""
params = []
if search:
    query += " AND s.name LIKE ?"
    params.append(f"%{search}%")
query += " GROUP BY s.id ORDER BY s.name"

students = conn.execute(query, params).fetchall()

# Compute outstanding per student in INR (handles multi-currency)
def _student_outstanding_inr(sid):
    rows = conn.execute(
        "SELECT i.currency, SUM(i.amount_due_paise) as total "
        "FROM installment i JOIN enrollment e ON i.enrollment_id = e.id "
        "WHERE e.student_id = ? AND i.status IN ('open','overdue') "
        "GROUP BY i.currency", (sid,)
    ).fetchall()
    return sum(fx_convert(r["total"], r["currency"], "INR") for r in rows)

student_owed = {s["id"]: _student_outstanding_inr(s["id"]) for s in students}

st.caption(f"{len(students)} students")

# Table view
data = []
for s in students:
    owed = student_owed[s["id"]]
    status = "Paid up" if owed == 0 else "Outstanding"
    data.append({
        "Name": s["name"],
        "City": s["city"] or "",
        "Country": s["country"] or "",
        "Owed": fmt_inr(owed) if owed > 0 else "—",
        "Next due": fmt_date_display(s["next_due"]),
        "Enrollments": s["enrollment_count"],
        "Status": status,
    })
st.dataframe(data, use_container_width=True, hide_index=True)

st.write("")

# Detail view
st.markdown("### Student detail")
student_names = [s["name"] for s in students]
if student_names:
    selected_name = st.selectbox("Select student", student_names)
    selected = next(s for s in students if s["name"] == selected_name)
    sid = selected["id"]

    student = conn.execute("SELECT * FROM student WHERE id=?", (sid,)).fetchone()

    # Compute totals for this student
    outstanding_inr = student_owed[sid]

    # Total paid (all matched/approved payments for this student) in INR
    paid_rows = conn.execute(
        "SELECT p.amount_paid_paise, p.currency "
        "FROM payment_in p "
        "JOIN match_result mr ON mr.payment_id = p.id "
        "JOIN installment i ON json_extract(mr.allocations, '$[0].installment_id') = i.id "
        "JOIN enrollment e ON i.enrollment_id = e.id "
        "WHERE e.student_id = ? AND mr.status IN ('auto','approved')",
        (sid,),
    ).fetchall()
    paid_inr = sum(fx_convert(r["amount_paid_paise"], r["currency"], "INR") for r in paid_rows)

    total_fees_inr = paid_inr + outstanding_inr

    with st.container(border=True):
        col1, col2 = st.columns(2)
        col1.markdown(f"### {student['name']}")
        col1.write(f"**City:** {student['city'] or '—'} · **Country:** {student['country'] or '—'}")
        aliases = json.loads(student['aliases']) if student['aliases'] else []
        if aliases:
            col1.write(f"**Aliases:** {', '.join(aliases)}")
        payer_aliases = json.loads(student['payer_aliases']) if student['payer_aliases'] else []
        if payer_aliases:
            col1.write(f"**Known payers:** {', '.join(payer_aliases)}")

        c2a, c2b = col2.columns(2)
        c2a.metric("Total fees", fmt_inr(total_fees_inr))
        c2b.metric("Outstanding", fmt_inr(outstanding_inr))
        if paid_inr > 0:
            col2.caption(f"Paid so far: {fmt_inr(paid_inr)} (all amounts converted to INR)")

    # Enrollments + installments
    enrollments = conn.execute(
        "SELECT * FROM enrollment WHERE student_id=?", (sid,)
    ).fetchall()

    for e in enrollments:
        with st.container(border=True):
            st.markdown(f"**{e['program']}** ({e['fee_model']}) — Total: {fmt_amount(e['total_fee_paise'], e['currency'])}")

            installments = conn.execute(
                "SELECT * FROM installment WHERE enrollment_id=? ORDER BY due_date", (e['id'],)
            ).fetchall()
            if installments:
                inst_data = []
                for i in installments:
                    inst_data.append({
                        "Due": fmt_date_display(i["due_date"]),
                        "Amount": fmt_amount(i["amount_due_paise"], i["currency"]),
                        "Status": i["status"],
                    })
                st.dataframe(inst_data, use_container_width=True, hide_index=True)
