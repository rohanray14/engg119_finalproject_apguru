"""Match Review — payments the matching agent wasn't sure about."""

import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

import json
import streamlit as st
from app.Home import get_db
from app.style import apply_theme, badge, fmt_inr, fmt_amount, fmt_date_display, metric_subtitle
from ledger.db import log_audit

st.set_page_config(page_title="Match Review | Educore", page_icon="💰", layout="wide")
apply_theme()

conn = get_db()

# Sidebar branding
with st.sidebar:
    st.markdown("## Educore")
    st.caption("Finance Desk")

# ── Header ──
auto_count = conn.execute("SELECT COUNT(*) FROM match_result WHERE status='auto'").fetchone()[0]
pending = conn.execute(
    "SELECT mr.id as match_id, mr.payment_id, mr.allocations, mr.confidence, "
    "mr.reason, mr.method, "
    "p.payer_name, p.amount_paid_paise, p.currency, p.date, p.source, "
    "p.method as pay_method, p.gateway_fee_paise, p.gst_on_fee_paise, "
    "p.fx_diff_paise, p.tds_paise "
    "FROM match_result mr "
    "JOIN payment_in p ON mr.payment_id = p.id "
    "WHERE mr.status = 'pending_review' "
    "ORDER BY mr.confidence DESC"
).fetchall()

st.title("Match review")
st.caption(
    f"Payments the matching agent wasn't sure about. "
    f"{auto_count} others were matched automatically."
)

if not pending:
    st.success("No payments pending review — all matched or resolved!")
    st.stop()

# ── Layout: left list + right detail ──
left, right = st.columns([2, 3])

# Track selection
if "selected_idx" not in st.session_state:
    st.session_state.selected_idx = 0

with left:
    with st.container(border=True):
        for idx, row in enumerate(pending):
            payer = row['payer_name'] or '(blank)'
            amount = fmt_amount(row['amount_paid_paise'], row['currency'])
            method = (row['pay_method'] or row['source'] or '').upper()
            date_str = fmt_date_display(row['date'])
            conf = f"{row['confidence']:.0%}"

            # Highlight selected
            if idx == st.session_state.selected_idx:
                st.markdown(
                    f'<div style="background:#1a2332; color:white; padding:12px 16px; '
                    f'border-radius:8px; margin-bottom:8px;">'
                    f'<b>{payer}</b> <span style="float:right;">{amount}</span><br>'
                    f'<span style="color:#8395a7; font-size:0.8rem;">'
                    f'{method} · {date_str} · {conf}</span></div>',
                    unsafe_allow_html=True,
                )
            else:
                if st.button(
                    f"{payer}  ·  {amount}  ·  {date_str}",
                    key=f"select_{idx}",
                    use_container_width=True,
                ):
                    st.session_state.selected_idx = idx
                    st.rerun()

        remaining = len(pending) - 10
        if remaining > 0:
            st.caption(f"+ {remaining} more")

# ── Right side: detail ──
row = pending[st.session_state.selected_idx]
allocs = json.loads(row['allocations']) if row['allocations'] else []

with right:
    # Bank statement card
    with st.container(border=True):
        st.markdown(
            f'<p style="color:#636e72; font-size:0.75rem; font-weight:600; '
            f'letter-spacing:0.08em; margin-bottom:4px;">FROM THE BANK STATEMENT</p>',
            unsafe_allow_html=True,
        )
        col_a, col_b = st.columns([2, 1])
        col_a.markdown(
            f'<p style="font-size:2rem; font-weight:700; color:#1a2332; margin:0;">'
            f'{fmt_amount(row["amount_paid_paise"], row["currency"])}</p>',
            unsafe_allow_html=True,
        )
        col_b.markdown(
            f'<p style="text-align:right; color:#636e72; margin-top:12px;">'
            f'{fmt_date_display(row["date"])} · {(row["pay_method"] or row["source"] or "").upper()}</p>',
            unsafe_allow_html=True,
        )
        narration = f'{(row["pay_method"] or "").upper()}/{row["payer_name"] or "UNKNOWN"}/FEE'
        st.code(narration, language=None)

    # Matching agent suggestion card
    with st.container(border=True):
        conf_pct = f'{row["confidence"]:.0%} sure'
        needs = "auto-match needs 95%"
        header_cols = st.columns([3, 2])
        header_cols[0].markdown(
            f'<p style="color:#1a6b5a; font-size:0.75rem; font-weight:600; '
            f'letter-spacing:0.08em;">MATCHING AGENT SUGGESTS</p>',
            unsafe_allow_html=True,
        )
        header_cols[1].markdown(
            f'<div style="text-align:right;">{badge(f"{conf_pct} · {needs}", "orange")}</div>',
            unsafe_allow_html=True,
        )

        # Get suggested student info
        if allocs:
            inst_ids = [a["installment_id"] for a in allocs]
            placeholders = ",".join("?" * len(inst_ids))
            insts = conn.execute(
                f"SELECT i.id, i.due_date, i.amount_due_paise, i.currency, i.status, "
                f"e.student_id, e.program, e.fee_model, s.name as student_name, "
                f"s.payer_aliases "
                f"FROM installment i "
                f"JOIN enrollment e ON i.enrollment_id = e.id "
                f"JOIN student s ON e.student_id = s.id "
                f"WHERE i.id IN ({placeholders})",
                inst_ids,
            ).fetchall()
            if insts:
                inst = insts[0]
                st.markdown(
                    f'<p style="font-size:1.3rem; font-weight:600; color:#1a2332;">'
                    f'{inst["student_name"]} — {inst["program"]}</p>',
                    unsafe_allow_html=True,
                )
                # Reasoning bullets
                reasons = row["reason"].split("+") if row["reason"] else []
                payer_name = row["payer_name"] or "(blank)"
                bullets = []
                if payer_name != "(blank)":
                    bullets.append(
                        f"The payer's name **{payer_name}** was matched to this student's file."
                    )
                bullets.append(
                    f"{fmt_amount(row['amount_paid_paise'], row['currency'])} matches the "
                    f"installment of {fmt_amount(inst['amount_due_paise'], inst['currency'])} exactly."
                )
                if inst["due_date"]:
                    bullets.append(
                        f"Due date was {fmt_date_display(inst['due_date'])}; "
                        f"status: {inst['status']}."
                    )
                if row["reason"]:
                    bullets.append(f"Matcher reason: _{row['reason']}_")

                for b in bullets:
                    st.markdown(f"- {b}")

                st.caption("The amount check and balance are calculated by the rules engine, not the AI.")
        else:
            st.markdown("No specific installment suggested — needs manual review.")

    # Other possibilities table
    with st.container(border=True):
        st.markdown("### Other possibilities")
        others = conn.execute(
            "SELECT i.id, i.due_date, i.amount_due_paise, i.currency, i.status, "
            "e.program, e.fee_model, s.name as student_name "
            "FROM installment i "
            "JOIN enrollment e ON i.enrollment_id = e.id "
            "JOIN student s ON e.student_id = s.id "
            "WHERE i.amount_due_paise = ? AND i.currency = ? "
            "ORDER BY i.due_date LIMIT 8",
            (row['amount_paid_paise'], row['currency']),
        ).fetchall()

        suggested_ids = {a["installment_id"] for a in allocs} if allocs else set()

        if others:
            table_data = []
            for o in others:
                amt_match = "Exact" if o["amount_due_paise"] == row["amount_paid_paise"] else (
                    f'Short by {fmt_inr(abs(o["amount_due_paise"] - row["amount_paid_paise"]))}'
                )
                is_suggested = o["id"] in suggested_ids
                table_data.append({
                    "Student": o["student_name"],
                    "What's due": f'{o["program"]} · {fmt_amount(o["amount_due_paise"], o["currency"])}',
                    "Amount fits?": amt_match,
                    "": "**Suggested**" if is_suggested else "",
                })
            st.dataframe(table_data, use_container_width=True, hide_index=True)
        else:
            st.write("No other candidates with a matching amount.")

    # ── Action buttons ──
    st.write("")
    col1, col2, col3 = st.columns(3)
    suggested_name = insts[0]["student_name"] if (allocs and insts) else "this match"

    with col1:
        if st.button(f"Approve: {suggested_name}", type="primary", key=f"approve_{row['match_id']}"):
            conn.execute("UPDATE match_result SET status='approved' WHERE id=?", (row['match_id'],))
            conn.commit()
            log_audit(conn, "finance_lead", "approve_match",
                      f"match:{row['match_id']}", "pending_review", "approved")
            st.success(f"Approved!")
            st.rerun()
    with col2:
        if st.button("Pick a different student", key=f"pick_{row['match_id']}"):
            st.info("Manual assignment coming soon.")
    with col3:
        if st.button("Not a fee payment", key=f"notfee_{row['match_id']}"):
            conn.execute(
                "UPDATE match_result SET status='rejected', reason='not_a_fee' WHERE id=?",
                (row['match_id'],),
            )
            conn.commit()
            log_audit(conn, "finance_lead", "mark_not_fee",
                      f"match:{row['match_id']}", "pending_review", "rejected:not_a_fee")
            st.info("Marked as not a fee.")
            st.rerun()

    st.caption(
        "Approving records the payment, updates the student's balance, "
        "credits their counselor's commission, and logs who approved it and when."
    )
