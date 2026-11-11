"""Risk — flagged issues in the ledger."""

import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from datetime import date
import streamlit as st
from app.Home import get_db
from app.style import apply_theme, badge, fmt_inr
from agents.risk import scan_risks

st.set_page_config(page_title="Risk Flags | Educore", page_icon="💰", layout="wide")
apply_theme()

conn = get_db()

# Use shared as-of date from Home page (or midpoint fallback)
min_date_row = conn.execute("SELECT MIN(due_date) FROM installment WHERE due_date IS NOT NULL").fetchone()
max_date_row = conn.execute("SELECT MAX(due_date) FROM installment WHERE due_date IS NOT NULL").fetchone()
min_date = date.fromisoformat(min_date_row[0]) if min_date_row and min_date_row[0] else date(2025, 4, 1)
max_date = date.fromisoformat(max_date_row[0]) if max_date_row and max_date_row[0] else date(2026, 9, 30)
default_as_of = st.session_state.get("global_as_of", min_date + (max_date - min_date) // 2)

with st.sidebar:
    st.markdown("## Educore")
    st.caption("Finance Desk")

st.title("Risk flags")
st.caption("Automatically detected issues that may need attention.")

as_of = st.date_input("As of date", value=default_as_of, min_value=min_date, max_value=max_date)
flags = scan_risks(conn, as_of=as_of)

high = [f for f in flags if f.severity == "high"]
med = [f for f in flags if f.severity == "medium"]
low = [f for f in flags if f.severity == "low"]

col1, col2, col3, col4 = st.columns(4)
col1.metric("Total flags", len(flags))
col2.metric("High severity", len(high))
col3.metric("Medium", len(med))
col4.metric("Low", len(low))

st.write("")

severity_filter = st.selectbox("Severity", ["All", "high", "medium", "low"])
filtered = flags if severity_filter == "All" else [f for f in flags if f.severity == severity_filter]

st.caption(f"Showing {len(filtered)} flags")

def _extract_student_name(flag):
    """Try to extract student name from a risk flag for navigation."""
    # Overdue installment flags include student name in explanation
    if flag.category == "overdue_installment" and flag.entity.startswith("installment:"):
        inst_id = flag.entity.split(":")[1]
        row = conn.execute(
            "SELECT s.name FROM student s "
            "JOIN enrollment e ON e.student_id = s.id "
            "JOIN installment i ON i.enrollment_id = e.id "
            "WHERE i.id = ?", (inst_id,)
        ).fetchone()
        return row["name"] if row else None
    # Payment-based flags: try to find matched student
    if flag.entity.startswith("payment:"):
        pid = flag.entity.split(":")[1]
        row = conn.execute(
            "SELECT s.name FROM student s "
            "JOIN enrollment e ON e.student_id = s.id "
            "JOIN installment i ON i.enrollment_id = e.id "
            "JOIN match_result mr ON json_extract(mr.allocations, '$[0].installment_id') = i.id "
            "WHERE mr.payment_id = ?", (pid,)
        ).fetchone()
        return row["name"] if row else None
    return None

for f in filtered:
    sev_colors = {"high": "red", "medium": "orange", "low": "green"}
    color = sev_colors.get(f.severity, "gray")

    with st.container(border=True):
        cols = st.columns([1, 2, 4, 1])
        cols[0].markdown(badge(f.severity.upper(), color), unsafe_allow_html=True)
        cols[1].markdown(f"**{f.category.replace('_', ' ').title()}**")
        cols[2].write(f.explanation)
        if f.amount_paise:
            cols[2].caption(f"{f.entity} · {fmt_inr(f.amount_paise)} {f.currency}")
        student_name = _extract_student_name(f)
        if student_name:
            if cols[3].button("View student", key=f"view_{f.entity}"):
                st.session_state["risk_nav_student"] = student_name
                st.switch_page("pages/3_Students.py")
