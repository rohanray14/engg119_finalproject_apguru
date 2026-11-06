"""Commissions page — counselors with terms, earned, TDS, net."""

import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

import streamlit as st
from app.Home import get_db, fmt_inr

st.set_page_config(page_title="Commissions | Educore", layout="wide")
st.title("Commissions")

conn = get_db()

counselors = conn.execute(
    "SELECT c.id, c.name, c.terms_text, c.parsed_rule, "
    "COALESCE(SUM(cl.commission_paise), 0) as total_earned, "
    "COALESCE(SUM(cl.tds_paise), 0) as total_tds, "
    "COALESCE(SUM(cl.net_paise), 0) as total_net "
    "FROM counselor c "
    "LEFT JOIN commission_line cl ON cl.counselor_id = c.id "
    "GROUP BY c.id ORDER BY c.name"
).fetchall()

st.caption(f"{len(counselors)} counselors")

for c in counselors:
    with st.expander(f"**{c['name']}** — Earned: {fmt_inr(c['total_earned'])} | "
                     f"TDS: {fmt_inr(c['total_tds'])} | Net: {fmt_inr(c['total_net'])}"):
        st.write(f"**Terms:** {c['terms_text'] or '(none)'}")
        if c['parsed_rule']:
            st.code(c['parsed_rule'], language="json")

        # Commission lines
        lines = conn.execute(
            "SELECT cl.*, p.payer_name, p.date "
            "FROM commission_line cl "
            "JOIN payment_in p ON cl.payment_id = p.id "
            "WHERE cl.counselor_id = ? "
            "ORDER BY p.date DESC",
            (c['id'],),
        ).fetchall()

        if lines:
            data = []
            for l in lines:
                data.append({
                    "Payment": l['payment_id'],
                    "Date": l['date'] or "",
                    "Payer": l['payer_name'] or "",
                    "Base": fmt_inr(l['base_paise']),
                    "Rate": f"{l['rate']:.1%}",
                    "Commission": fmt_inr(l['commission_paise']),
                    "TDS": fmt_inr(l['tds_paise']),
                    "Net": fmt_inr(l['net_paise']),
                })
            st.dataframe(data, use_container_width=True, hide_index=True)
        else:
            st.info("No commission lines yet.")
