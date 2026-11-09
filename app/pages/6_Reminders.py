"""Reminders page — view and manage payment reminders."""

import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from datetime import date
import streamlit as st
from app.Home import get_db
from app.style import apply_theme, badge, fmt_inr, fmt_amount, fmt_date_display
from agents.reminders import generate_reminders

st.set_page_config(page_title="Reminders | Educore", page_icon="💰", layout="wide")
apply_theme()

conn = get_db()

# Use same default date as Home page (midpoint of data range)
min_date_row = conn.execute("SELECT MIN(due_date) FROM installment WHERE due_date IS NOT NULL").fetchone()
max_date_row = conn.execute("SELECT MAX(due_date) FROM installment WHERE due_date IS NOT NULL").fetchone()
min_date = date.fromisoformat(min_date_row[0]) if min_date_row and min_date_row[0] else date(2025, 4, 1)
max_date = date.fromisoformat(max_date_row[0]) if max_date_row and max_date_row[0] else date(2026, 9, 30)
default_as_of = min_date + (max_date - min_date) // 2

with st.sidebar:
    st.markdown("## Educore")
    st.caption("Finance Desk")

st.title("Reminders")
st.caption("Auto-drafted messages for upcoming and overdue installments.")

as_of = st.date_input("As of date", value=default_as_of, min_value=min_date, max_value=max_date)
reminders = generate_reminders(conn, as_of=as_of)

# Summary metrics
pre_due = [r for r in reminders if r.reminder_type == "pre_due"]
on_due = [r for r in reminders if r.reminder_type == "on_due"]
overdue = [r for r in reminders if r.reminder_type == "overdue"]
needs_approval = [r for r in reminders if r.needs_approval]

col1, col2, col3, col4 = st.columns(4)
col1.metric("Pre-due", len(pre_due))
col2.metric("Due today", len(on_due))
col3.metric("Overdue", len(overdue))
col4.metric("Needs approval", len(needs_approval))

st.write("")

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
    type_colors = {"pre_due": "blue", "on_due": "teal", "overdue": "red"}
    type_labels = {"pre_due": "Pre-due", "on_due": "Due today", "overdue": "Overdue"}
    color = type_colors.get(r.reminder_type, "gray")
    label = type_labels.get(r.reminder_type, r.reminder_type)

    with st.container(border=True):
        cols = st.columns([1, 3, 2, 1])
        cols[0].markdown(badge(label, color), unsafe_allow_html=True)
        cols[1].markdown(
            f"**{r.student_name}** — {r.enrollment_program}<br>"
            f'<span style="color:#636e72; font-size:0.85rem;">'
            f'{fmt_amount(r.amount_due_paise, r.currency)} · due {fmt_date_display(str(r.due_date))}'
            f'</span>',
            unsafe_allow_html=True,
        )
        cols[2].caption(f"Send on {fmt_date_display(str(r.scheduled_for))}")
        if r.needs_approval:
            if cols[3].button("Approve", key=f"approve_rem_{r.installment_id}_{r.reminder_type}"):
                from ledger.db import log_audit
                log_audit(conn, "finance_lead", "approve_reminder",
                          f"installment:{r.installment_id}", None, r.reminder_type)
                st.toast(f"Reminder for {r.student_name} approved for sending!")
        else:
            cols[3].markdown(badge("Auto", "green"), unsafe_allow_html=True)

        with st.expander("Preview message"):
            st.text(r.message)
            if st.button("Copy to clipboard", key=f"copy_{r.installment_id}_{r.reminder_type}"):
                st.code(r.message, language=None)
                st.toast("Message ready to copy!")
