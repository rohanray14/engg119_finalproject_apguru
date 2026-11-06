"""Reminders page — view and manage payment reminders."""

import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from datetime import date
import streamlit as st
from app.Home import get_db, fmt_inr
from agents.reminders import generate_reminders

st.set_page_config(page_title="Reminders | Educore", layout="wide")
st.title("Reminders")

conn = get_db()

as_of = st.date_input("As of date", value=date(2025, 6, 1))
reminders = generate_reminders(conn, as_of=as_of)

st.caption(f"{len(reminders)} reminders to send")

# Filters
col1, col2 = st.columns(2)
with col1:
    type_filter = st.selectbox("Type", ["All", "pre_due", "on_due", "overdue"])
with col2:
    approval_filter = st.selectbox("Approval", ["All", "Auto-send", "Needs approval"])

filtered = reminders
if type_filter != "All":
    filtered = [r for r in filtered if r.reminder_type == type_filter]
if approval_filter == "Needs approval":
    filtered = [r for r in filtered if r.needs_approval]
elif approval_filter == "Auto-send":
    filtered = [r for r in filtered if not r.needs_approval]

st.caption(f"Showing {len(filtered)} reminders")

for r in filtered:
    icon = {"pre_due": "📅", "on_due": "⏰", "overdue": "🚨"}.get(r.reminder_type, "")
    label = f"{icon} {r.student_name} — {fmt_inr(r.amount_due_paise)} {r.currency} ({r.reminder_type})"
    if r.needs_approval:
        label += " [NEEDS APPROVAL]"

    with st.expander(label):
        st.write(f"**Student:** {r.student_name} (ID: {r.student_id})")
        st.write(f"**Program:** {r.enrollment_program}")
        st.write(f"**Due:** {r.due_date}")
        st.write(f"**Send on:** {r.scheduled_for}")
        st.divider()
        st.text(r.message)
