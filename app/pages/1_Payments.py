"""Payments page — every payment with details, filters."""

import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

import json
import streamlit as st
from app.Home import get_db, fmt_inr

st.set_page_config(page_title="Payments | Educore", layout="wide")
st.title("Payments")

conn = get_db()

# Filters
col1, col2, col3 = st.columns(3)
with col1:
    source_filter = st.selectbox("Source", ["All", "bank", "gateway", "cash", "screenshot"])
with col2:
    currency_filter = st.selectbox("Currency", ["All", "INR", "USD", "AED", "GBP", "EUR", "SGD"])
with col3:
    confirmation_filter = st.selectbox("Confirmation", ["All", "in_bank", "seen_by_gateway", "screenshot_only"])

query = """
    SELECT id, source, method, payer_name, date, amount_paid_paise, currency,
           gateway_fee_paise, gst_on_fee_paise, fx_diff_paise, tds_paise,
           amount_in_bank_paise, confirmation
    FROM payment_in WHERE 1=1
"""
params = []

if source_filter != "All":
    query += " AND source = ?"
    params.append(source_filter)
if currency_filter != "All":
    query += " AND currency = ?"
    params.append(currency_filter)
if confirmation_filter != "All":
    query += " AND confirmation = ?"
    params.append(confirmation_filter)

query += " ORDER BY date DESC, id DESC"
rows = conn.execute(query, params).fetchall()

st.caption(f"{len(rows)} payments")

if rows:
    data = []
    for r in rows:
        deductions = r["gateway_fee_paise"] + r["gst_on_fee_paise"] + r["fx_diff_paise"] + r["tds_paise"]
        data.append({
            "ID": r["id"],
            "Date": r["date"] or "",
            "Payer": r["payer_name"] or "(blank)",
            "Paid": fmt_inr(r["amount_paid_paise"]),
            "Currency": r["currency"],
            "Deductions": fmt_inr(deductions) if deductions else "—",
            "In Bank": fmt_inr(r["amount_in_bank_paise"]) if r["amount_in_bank_paise"] else "—",
            "Source": r["source"],
            "Method": r["method"] or "",
            "Confirmation": r["confirmation"],
        })
    st.dataframe(data, use_container_width=True, hide_index=True)
else:
    st.info("No payments match the filters.")
