"""Risk page — view flagged issues in the ledger."""

import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from datetime import date
import streamlit as st
from app.Home import get_db, fmt_inr
from agents.risk import scan_risks

st.set_page_config(page_title="Risk Flags | Educore", layout="wide")
st.title("Risk Flags")

conn = get_db()

as_of = st.date_input("As of date", value=date(2025, 7, 1))
flags = scan_risks(conn, as_of=as_of)

# Summary
high = sum(1 for f in flags if f.severity == "high")
med = sum(1 for f in flags if f.severity == "medium")
low = sum(1 for f in flags if f.severity == "low")

col1, col2, col3, col4 = st.columns(4)
col1.metric("Total Flags", len(flags))
col2.metric("High", high)
col3.metric("Medium", med)
col4.metric("Low", low)

st.divider()

# Filter
severity_filter = st.selectbox("Severity", ["All", "high", "medium", "low"])
filtered = flags if severity_filter == "All" else [f for f in flags if f.severity == severity_filter]

st.caption(f"Showing {len(filtered)} flags")

for f in filtered:
    color = {"high": "🔴", "medium": "🟡", "low": "🟢"}.get(f.severity, "⚪")
    with st.container(border=True):
        c1, c2, c3 = st.columns([1, 2, 4])
        c1.write(f"{color} **{f.severity.upper()}**")
        c2.write(f"**{f.category}**")
        c3.write(f.explanation)
        if f.amount_paise:
            c3.caption(f"{f.entity} — {fmt_inr(f.amount_paise)} {f.currency}")
