"""Money Out page — outgoing payments by category."""

import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

import streamlit as st
from app.Home import get_db
from app.style import apply_theme, fmt_inr, fmt_date_display

st.set_page_config(page_title="Money Out | Educore", page_icon="💰", layout="wide")
apply_theme()

conn = get_db()

with st.sidebar:
    st.markdown("## Educore")
    st.caption("Finance Desk")

st.title("Money out")
st.caption("All debits by category.")

# Summary by category
categories = conn.execute(
    "SELECT category, COUNT(*) as count, SUM(amount_paise) as total "
    "FROM payment_out GROUP BY category ORDER BY total DESC"
).fetchall()

if categories:
    cols = st.columns(len(categories))
    for i, c in enumerate(categories):
        with cols[i]:
            st.metric(c["category"].title(), fmt_inr(c["total"]))
            st.caption(f"{c['count']} payments")

st.write("")

# Filters
with st.container(border=True):
    col1, col2 = st.columns(2)
    with col1:
        cat_filter = st.selectbox(
            "Category",
            ["All"] + [c["category"] for c in categories],
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
            "Date": fmt_date_display(r["date"]),
            "Payee": r["payee"],
            "Category": r["category"].title(),
            "Amount": fmt_inr(r["amount_paise"]),
            "Currency": r["currency"],
        })
    st.dataframe(data, use_container_width=True, hide_index=True)
