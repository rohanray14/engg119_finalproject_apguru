"""Money Out page — outgoing payments by category."""

import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

import streamlit as st
from app.Home import get_db, fmt_inr

st.set_page_config(page_title="Money Out | Educore", layout="wide")
st.title("Money Out")

conn = get_db()

# Summary by category
st.subheader("By Category")
categories = conn.execute(
    "SELECT category, COUNT(*) as count, SUM(amount_paise) as total "
    "FROM payment_out GROUP BY category ORDER BY total DESC"
).fetchall()

if categories:
    cat_data = []
    for c in categories:
        cat_data.append({
            "Category": c['category'],
            "Count": c['count'],
            "Total": fmt_inr(c['total']),
        })
    st.dataframe(cat_data, use_container_width=True, hide_index=True)

st.divider()

# Filters
col1, col2 = st.columns(2)
with col1:
    cat_filter = st.selectbox(
        "Category",
        ["All", "faculty", "commission", "refund", "rent", "ads", "tax", "software", "other"],
    )
with col2:
    curr_filter = st.selectbox("Currency", ["All", "INR", "USD", "AED", "GBP"])

query = "SELECT * FROM payment_out WHERE 1=1"
params = []
if cat_filter != "All":
    query += " AND category = ?"
    params.append(cat_filter)
if curr_filter != "All":
    query += " AND currency = ?"
    params.append(curr_filter)
query += " ORDER BY date DESC, id DESC"

rows = conn.execute(query, params).fetchall()
st.caption(f"{len(rows)} payments")

if rows:
    data = []
    for r in rows:
        data.append({
            "ID": r['id'],
            "Date": r['date'] or "",
            "Payee": r['payee'],
            "Category": r['category'],
            "Amount": fmt_inr(r['amount_paise']),
            "Currency": r['currency'],
        })
    st.dataframe(data, use_container_width=True, hide_index=True)
