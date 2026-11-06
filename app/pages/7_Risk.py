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

with st.sidebar:
    st.markdown("## Educore")
    st.caption("Finance Desk")

st.title("Risk flags")
st.caption("Automatically detected issues that may need attention.")

as_of = st.date_input("As of date", value=date(2025, 7, 1))
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

for f in filtered:
    sev_colors = {"high": "red", "medium": "orange", "low": "green"}
    color = sev_colors.get(f.severity, "gray")

    with st.container(border=True):
        cols = st.columns([1, 2, 5])
        cols[0].markdown(badge(f.severity.upper(), color), unsafe_allow_html=True)
        cols[1].markdown(f"**{f.category.replace('_', ' ').title()}**")
        cols[2].write(f.explanation)
        if f.amount_paise:
            cols[2].caption(f"{f.entity} · {fmt_inr(f.amount_paise)} {f.currency}")
