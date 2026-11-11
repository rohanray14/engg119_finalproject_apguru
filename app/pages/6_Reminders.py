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

# Use shared as-of date from Home page (or midpoint fallback)
min_date_row = conn.execute("SELECT MIN(due_date) FROM installment WHERE due_date IS NOT NULL").fetchone()
max_date_row = conn.execute("SELECT MAX(due_date) FROM installment WHERE due_date IS NOT NULL").fetchone()
min_date = date.fromisoformat(min_date_row[0]) if min_date_row and min_date_row[0] else date(2025, 4, 1)
max_date = date.fromisoformat(max_date_row[0]) if max_date_row and max_date_row[0] else date(2026, 9, 30)
default_as_of = st.session_state.get("global_as_of", min_date + (max_date - min_date) // 2)

with st.sidebar:
    st.markdown("## Educore")
    st.caption("Finance Desk")

st.title("Reminders")
st.caption("Auto-drafted messages for upcoming and overdue installments.")

as_of = st.date_input("As of date", value=default_as_of, min_value=min_date, max_value=max_date)
reminders = generate_reminders(conn, as_of=as_of)

# Deduplicate: each installment should only appear in ONE category
# Priority: overdue > on_due > pre_due (most urgent wins)
seen_installments: dict[int, str] = {}
for r in reminders:
    existing = seen_installments.get(r.installment_id)
    priority = {"overdue": 0, "on_due": 1, "pre_due": 2}
    if existing is None or priority.get(r.reminder_type, 3) < priority.get(existing, 3):
        seen_installments[r.installment_id] = r.reminder_type

deduped = []
seen_ids_by_type: dict[tuple, bool] = {}
for r in reminders:
    key = (r.installment_id, r.reminder_type)
    if seen_installments.get(r.installment_id) == r.reminder_type and key not in seen_ids_by_type:
        deduped.append(r)
        seen_ids_by_type[key] = True
reminders = deduped

pre_due = [r for r in reminders if r.reminder_type == "pre_due"]
on_due = [r for r in reminders if r.reminder_type == "on_due"]
overdue = [r for r in reminders if r.reminder_type == "overdue"]
needs_approval = [r for r in reminders if r.needs_approval]

# Tabs that actually filter
tab_all, tab_pre, tab_on, tab_over = st.tabs([
    f"All ({len(reminders)})",
    f"Pre-due ({len(pre_due)})",
    f"Due today ({len(on_due)})",
    f"Overdue ({len(overdue)})",
])

tab_map = {
    "all": (tab_all, reminders),
    "pre_due": (tab_pre, pre_due),
    "on_due": (tab_on, on_due),
    "overdue": (tab_over, overdue),
}

def _render_reminders(reminder_list, tab_key):
    type_colors = {"pre_due": "blue", "on_due": "teal", "overdue": "red"}
    type_labels = {"pre_due": "Pre-due", "on_due": "Due today", "overdue": "Overdue"}
    if not reminder_list:
        st.info("No reminders in this category.")
        return
    for r in reminder_list:
        color = type_colors.get(r.reminder_type, "gray")
        label = type_labels.get(r.reminder_type, r.reminder_type)

        with st.container(border=True):
            cols = st.columns([1, 3, 2, 1])
            cols[0].markdown(badge(label, color), unsafe_allow_html=True)
            cols[1].markdown(
                f"**{r.student_name}** — {r.enrollment_program}<br>"
                f'<span style="color:#8A8A9A; font-size:0.85rem;">'
                f'{fmt_amount(r.amount_due_paise, r.currency)} · due {fmt_date_display(str(r.due_date))}'
                f'</span>',
                unsafe_allow_html=True,
            )
            cols[2].caption(f"Send on {fmt_date_display(str(r.scheduled_for))}")
            if r.needs_approval:
                if cols[3].button("Approve", key=f"approve_rem_{tab_key}_{r.installment_id}_{r.reminder_type}"):
                    from ledger.db import log_audit
                    log_audit(conn, "finance_lead", "approve_reminder",
                              f"installment:{r.installment_id}", None, r.reminder_type)
                    st.toast(f"Reminder for {r.student_name} approved for sending!")
            else:
                cols[3].markdown(badge("Auto", "green"), unsafe_allow_html=True)

            with st.expander("Preview message", expanded=False):
                st.text(r.message)
                if st.button("Copy to clipboard", key=f"copy_{tab_key}_{r.installment_id}_{r.reminder_type}"):
                    st.code(r.message, language=None)
                    st.toast("Message ready to copy!")

for key, (tab, data) in tab_map.items():
    with tab:
        _render_reminders(data, key)
