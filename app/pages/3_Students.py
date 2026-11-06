"""Students page — searchable list with detail view."""

import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

import json
import streamlit as st
from app.Home import get_db
from app.style import apply_theme, badge, fmt_inr, fmt_amount, fmt_date_display

st.set_page_config(page_title="Students | Educore", page_icon="💰", layout="wide")
apply_theme()

conn = get_db()

with st.sidebar:
    st.markdown("## Educore")
    st.caption("Finance Desk")

st.title("Students")

# Search
search = st.text_input("Search by name", "", placeholder="Type a student name...")

query = """
    SELECT s.id, s.name, s.city, s.country,
           COALESCE(SUM(CASE WHEN i.status IN ('open','overdue') THEN i.amount_due_paise ELSE 0 END), 0) as total_owed,
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
st.caption(f"{len(students)} students")

# Table view
data = []
for s in students:
    status = "Paid up" if s["total_owed"] == 0 else "Outstanding"
    data.append({
        "Name": s["name"],
        "City": s["city"] or "",
        "Country": s["country"] or "",
        "Owed": fmt_inr(s["total_owed"]) if s["total_owed"] > 0 else "—",
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

        col2.metric("Outstanding", fmt_inr(selected["total_owed"]))

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
