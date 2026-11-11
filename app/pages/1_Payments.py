"""Payments page — every payment with details and filters."""

import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

import streamlit as st
from app.Home import get_db
from app.style import apply_theme, badge, fmt_inr, fmt_amount, fmt_date_display

st.set_page_config(page_title="Payments | Educore", page_icon="💰", layout="wide")
apply_theme()

conn = get_db()

with st.sidebar:
    st.markdown("## Educore")
    st.caption("Finance Desk")

st.title("Payments")
st.caption("Every incoming payment with amount paid, deductions, and confirmation level. Showing all dates.")

# Filters
with st.container(border=True):
    col1, col2, col3, col4 = st.columns(4)
    with col1:
        source_filter = st.selectbox("Source", ["All", "bank", "gateway", "cash", "screenshot"])
    with col2:
        currency_filter = st.selectbox("Currency", ["All", "INR", "USD", "AED", "GBP", "EUR", "SGD"])
    with col3:
        confirmation_filter = st.selectbox("Confirmation", ["All", "in_bank", "seen_by_gateway", "screenshot_only"])
    with col4:
        match_filter = st.selectbox("Match status", ["All", "Matched", "Unmatched", "Pending review"])

query = """
    SELECT p.id, p.source, p.method, p.payer_name, p.date, p.amount_paid_paise,
           p.currency, p.gateway_fee_paise, p.gst_on_fee_paise, p.fx_diff_paise,
           p.tds_paise, p.amount_in_bank_paise, p.confirmation,
           mr.status as match_status
    FROM payment_in p
    LEFT JOIN match_result mr ON mr.payment_id = p.id
    WHERE 1=1
"""
params = []

if source_filter != "All":
    query += " AND p.source = ?"
    params.append(source_filter)
if currency_filter != "All":
    query += " AND p.currency = ?"
    params.append(currency_filter)
if confirmation_filter != "All":
    query += " AND p.confirmation = ?"
    params.append(confirmation_filter)
if match_filter == "Matched":
    query += " AND mr.status IN ('auto','approved')"
elif match_filter == "Unmatched":
    query += " AND mr.id IS NULL"
elif match_filter == "Pending review":
    query += " AND mr.status = 'pending_review'"

query += " ORDER BY p.date DESC, p.id DESC"
rows = conn.execute(query, params).fetchall()

st.caption(f"{len(rows)} payments")

if rows:
    data = []
    for r in rows:
        deductions = r["gateway_fee_paise"] + r["gst_on_fee_paise"] + r["fx_diff_paise"] + r["tds_paise"]
        match_status = r["match_status"] or "unmatched"

        data.append({
            "ID": r["id"],
            "Date": fmt_date_display(r["date"]),
            "Payer": r["payer_name"] or "(blank)",
            "Amount": fmt_amount(r["amount_paid_paise"], r["currency"]),
            "Deductions": fmt_inr(deductions) if deductions else "—",
            "In Bank": fmt_inr(r["amount_in_bank_paise"]) if r["amount_in_bank_paise"] else "—",
            "Source": r["source"],
            "Method": (r["method"] or "").upper(),
            "Confirmation": r["confirmation"],
            "Match": match_status,
        })
    st.dataframe(data, use_container_width=True, hide_index=True)

    # Count blank payers
    blank_count = sum(1 for d in data if d["Payer"] == "(blank)")
    if blank_count > 0:
        st.caption(
            f'{blank_count} payment(s) show "(blank)" as the payer name. '
            f"This happens when the bank statement or gateway report does not include "
            f"the sender's name — common with UPI, NEFT batch transfers, and some "
            f"international gateways. These payments need manual review to match them "
            f"to a student."
        )
else:
    st.info("No payments match the filters.")
