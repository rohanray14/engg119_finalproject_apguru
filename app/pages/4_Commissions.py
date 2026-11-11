"""Commissions page — counselors with terms, parsed rules, payouts."""

import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

import json
import streamlit as st
from app.Home import get_db
from app.style import apply_theme, badge, fmt_inr, metric_subtitle
from agents.commissions import parse_terms

st.set_page_config(page_title="Commissions | Educore", page_icon="💰", layout="wide")
apply_theme()

conn = get_db()

with st.sidebar:
    st.markdown("## Educore")
    st.caption("Finance Desk")

# ── Header ──
st.title("Commissions")
st.caption("Cumulative totals from all matched fees to date. Not filtered by month — this is the all-time position.")

# ── Parse terms for all counselors ──
counselors = conn.execute("SELECT * FROM counselor ORDER BY name").fetchall()
parsed_rules = {}
total_earned = 0
total_tds = 0
total_net = 0

counselor_data = []
for c in counselors:
    rule = parse_terms(c["terms_text"] or "")
    parsed_rules[c["id"]] = rule

    # For demo: simulate some commission calculations
    cl = conn.execute(
        "SELECT COALESCE(SUM(commission_paise), 0) as earned, "
        "COALESCE(SUM(tds_paise), 0) as tds, "
        "COALESCE(SUM(net_paise), 0) as net "
        "FROM commission_line WHERE counselor_id = ?",
        (c["id"],),
    ).fetchone()

    earned = cl["earned"]
    tds = cl["tds"]
    net = cl["net"]
    total_earned += earned
    total_tds += tds
    total_net += net

    # Determine status
    if rule.rate <= 0:
        status = "needs_rate"
    elif earned > 0:
        status = "ready"
    else:
        status = "no_fees"

    rule_text = ""
    if rule.rate > 0:
        rule_text = f"{rule.rate:.0%} x fees"
        if rule.scope == "city" and rule.city:
            rule_text += f" from students in {rule.city}"
        elif rule.scope == "own_referrals":
            rule_text += " from students they referred"
        if rule.split:
            rule_text += f", split {rule.split:.0%}/{1 - rule.split:.0%}"
    else:
        rule_text = "Rate not stated" if c["terms_text"] else "No terms provided"

    counselor_data.append({
        "id": c["id"],
        "name": c["name"],
        "terms": c["terms_text"] or "",
        "rule_text": rule_text,
        "earned": earned,
        "tds": tds,
        "net": net,
        "status": status,
    })

# ── Approve payout button ──
header_cols = st.columns([4, 1])
if total_net > 0:
    if header_cols[1].button(f"Approve payout · {fmt_inr(total_net)}", type="primary"):
        from ledger.db import log_audit
        log_audit(conn, "finance_lead", "approve_commission_payout",
                  "commissions", None, f"total_net={total_net}")
        st.toast(f"Payout of {fmt_inr(total_net)} approved and logged!")
        st.success(
            f"Payout of {fmt_inr(total_net)} has been approved and recorded in the audit log. "
            f"(Prototype: no actual transfer is made.)"
        )

st.write("")

# ── Metric cards ──
col1, col2, col3, col4 = st.columns(4)
with col1:
    st.metric("Commission earned", fmt_inr(total_earned) if total_earned else "—")
with col2:
    st.metric("TDS withheld (2%)", fmt_inr(total_tds) if total_tds else "—")
with col3:
    st.metric("Net to pay", fmt_inr(total_net) if total_net else "—")
with col4:
    held_count = sum(1 for c in counselor_data if c["status"] == "needs_rate")
    st.metric("Needs rate set", str(held_count))
    st.markdown(
        metric_subtitle("counselors without a parsed rate"),
        unsafe_allow_html=True,
    )

st.write("")

# ── Counselors table ──
with st.container(border=True):
    st.markdown("### Counselors")

    # Table header
    cols = st.columns([2, 4, 2, 1.5, 1.5, 1.5, 1])
    cols[0].markdown("**Counselor**")
    cols[1].markdown("**Terms as written**")
    cols[2].markdown("**Rule**")
    cols[3].markdown("**Commission**")
    cols[4].markdown("**Net after TDS**")
    cols[5].markdown("**Status**")

    st.markdown("---")

    # Only show counselors with earned commission (remove blank rows)
    display_data = [c for c in counselor_data if c["earned"] > 0 or c["status"] == "needs_rate"]

    for c in display_data:
        cols = st.columns([2, 4, 2, 1.5, 1.5, 1.5, 1])
        cols[0].write(c["name"])

        # Terms in italics/quotes
        terms_display = f'"{c["terms"]}"' if c["terms"] else "—"
        if c["status"] == "needs_rate":
            cols[1].markdown(
                f'<span style="color:#e67e22;">{terms_display}</span>',
                unsafe_allow_html=True,
            )
        else:
            cols[1].write(terms_display)

        cols[2].write(c["rule_text"])
        cols[3].write(fmt_inr(c["earned"]) if c["earned"] else "—")
        cols[4].markdown(f"**{fmt_inr(c['net'])}**" if c["net"] else "—")

        if c["status"] == "ready":
            cols[5].markdown(badge("Ready", "green"), unsafe_allow_html=True)
        elif c["status"] == "needs_rate":
            if cols[5].button("Set the rate", key=f"rate_{c['id']}"):
                st.session_state[f"setting_rate_{c['id']}"] = True
                st.rerun()
        else:
            cols[5].write("—")

        # Rate-setting panel
        if st.session_state.get(f"setting_rate_{c['id']}"):
            with st.container(border=True):
                st.markdown(f"**Set commission rate for {c['name']}**")
                st.caption(f'Terms: "{c["terms"]}"')
                new_rate = st.number_input(
                    "Rate (%)", min_value=0.0, max_value=50.0, value=10.0,
                    step=1.0, key=f"rate_input_{c['id']}",
                )
                scope = st.selectbox(
                    "Scope", ["own_referrals", "city"],
                    key=f"scope_{c['id']}",
                )
                rc1, rc2 = st.columns(2)
                if rc1.button("Save rule", type="primary", key=f"save_rate_{c['id']}"):
                    import json as _json
                    rule_json = _json.dumps({"rate": new_rate / 100, "scope": scope})
                    conn.execute(
                        "UPDATE counselor SET parsed_rule = ? WHERE id = ?",
                        (rule_json, c["id"]),
                    )
                    conn.commit()
                    from ledger.db import log_audit
                    log_audit(conn, "finance_lead", "set_commission_rule",
                              f"counselor:{c['id']}", None, rule_json)
                    del st.session_state[f"setting_rate_{c['id']}"]
                    st.toast(f"Rate set for {c['name']}!")
                    st.rerun()
                if rc2.button("Cancel", key=f"cancel_rate_{c['id']}"):
                    del st.session_state[f"setting_rate_{c['id']}"]
                    st.rerun()

    st.write("")
    st.caption(
        "The agent only turns written terms into a rule. The amounts, the 2% TDS and "
        "refund deductions are calculated by code, and each rule is saved once you confirm it."
    )

st.write("")

# ── Counselor statements ──
with st.container(border=True):
    cols = st.columns([4, 1])
    cols[0].markdown("### Counselor statements")
    cols[0].caption("Each counselor gets a statement listing every student, the fee received and their share.")
    if cols[1].button("Preview statements", key="preview_statements"):
        st.session_state["show_statements"] = True
        st.rerun()

if st.session_state.get("show_statements"):
    with st.container(border=True):
        st.markdown("### Statement Preview")
        for c in counselor_data:
            if c["earned"] > 0:
                st.markdown(f"**{c['name']}**")
                st.write(f"Commission earned: {fmt_inr(c['earned'])} · "
                         f"TDS (2%): {fmt_inr(c['tds'])} · "
                         f"Net payable: **{fmt_inr(c['net'])}**")
                st.markdown("---")
        if st.button("Close", key="close_statements"):
            del st.session_state["show_statements"]
            st.rerun()
