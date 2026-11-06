"""Students page — searchable list + click for detail."""

import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

import json
import streamlit as st
from app.Home import get_db, fmt_inr

st.set_page_config(page_title="Students | Educore", layout="wide")
st.title("Students")

conn = get_db()

# Search
search = st.text_input("Search by name", "")

query = """
    SELECT s.id, s.name, s.city, s.country,
           COALESCE(SUM(i.amount_due_paise), 0) as total_due,
           COUNT(DISTINCT e.id) as enrollment_count
    FROM student s
    LEFT JOIN enrollment e ON e.student_id = s.id
    LEFT JOIN installment i ON i.enrollment_id = e.id AND i.status IN ('open','overdue')
    WHERE 1=1
"""
params = []
if search:
    query += " AND s.name LIKE ?"
    params.append(f"%{search}%")
query += " GROUP BY s.id ORDER BY s.name"

students = conn.execute(query, params).fetchall()
st.caption(f"{len(students)} students")

# List view
selected_id = None
for s in students:
    with st.container(border=True):
        c1, c2, c3, c4 = st.columns([3, 1, 1, 1])
        c1.write(f"**{s['name']}**")
        c2.write(f"{s['city'] or ''}, {s['country'] or ''}")
        c3.write(f"Owed: {fmt_inr(s['total_due'])}" if s['total_due'] else "Paid up")
        if c4.button("Detail", key=f"student_{s['id']}"):
            selected_id = s['id']

# Detail view
if selected_id:
    st.divider()
    student = conn.execute("SELECT * FROM student WHERE id=?", (selected_id,)).fetchone()
    st.subheader(f"Student: {student['name']}")
    st.write(f"**City:** {student['city']} | **Country:** {student['country']}")

    aliases = json.loads(student['aliases']) if student['aliases'] else []
    if aliases:
        st.write(f"**Aliases:** {', '.join(aliases)}")

    # Enrollments
    st.markdown("### Enrollments")
    enrollments = conn.execute(
        "SELECT * FROM enrollment WHERE student_id=?", (selected_id,)
    ).fetchall()
    for e in enrollments:
        st.write(f"- **{e['program']}** ({e['fee_model']}) — "
                 f"Total: {fmt_inr(e['total_fee_paise'])} {e['currency']}")

        # Installments for this enrollment
        installments = conn.execute(
            "SELECT * FROM installment WHERE enrollment_id=? ORDER BY due_date",
            (e['id'],),
        ).fetchall()
        if installments:
            inst_data = []
            for i in installments:
                inst_data.append({
                    "ID": i['id'],
                    "Due": i['due_date'] or "",
                    "Amount": fmt_inr(i['amount_due_paise']),
                    "Currency": i['currency'],
                    "Status": i['status'],
                })
            st.dataframe(inst_data, use_container_width=True, hide_index=True)

    # Payments linked to this student (via match results)
    st.markdown("### Matched Payments")
    matched = conn.execute(
        "SELECT p.id, p.date, p.payer_name, p.amount_paid_paise, p.currency, "
        "mr.confidence, mr.status as match_status "
        "FROM match_result mr "
        "JOIN payment_in p ON mr.payment_id = p.id "
        "WHERE mr.allocations LIKE '%installment_id%' "
        "AND mr.status IN ('auto','approved') "
        "AND EXISTS ("
        "  SELECT 1 FROM installment i "
        "  JOIN enrollment e ON i.enrollment_id = e.id "
        "  WHERE e.student_id = ? "
        "  AND mr.allocations LIKE '%' || i.id || '%'"
        ")",
        (selected_id,),
    ).fetchall()
    if matched:
        pay_data = []
        for m in matched:
            pay_data.append({
                "Payment ID": m['id'],
                "Date": m['date'] or "",
                "Payer": m['payer_name'] or "(blank)",
                "Amount": fmt_inr(m['amount_paid_paise']),
                "Currency": m['currency'],
                "Match Status": m['match_status'],
            })
        st.dataframe(pay_data, use_container_width=True, hide_index=True)
    else:
        st.info("No matched payments for this student yet.")
