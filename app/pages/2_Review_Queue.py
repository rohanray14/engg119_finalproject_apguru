"""Match Review — payments the matching agent wasn't sure about."""

import sys
import re
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

import json
import streamlit as st
from app.Home import get_db
from app.style import apply_theme, badge, fmt_inr, fmt_amount, fmt_date_display, metric_subtitle
from ledger.db import log_audit


def format_match_reason(reason_str: str) -> str:
    """Convert internal reason codes to human-readable text.

    Examples of internal codes:
        "exact_amount+name_match(85)+global(3)"
        "amount+name(100.0)_vs_second(47.6)+fifo+global(11)"
        "blank_payer+3_same_amount"
        "exact_amount+blank_payer+globally_unique"
        "no_amount_match"
        "ambiguous:5_candidates"
        "no_candidates_after_shortlist"
        "api_error:..."
        "json_parse_error: ..."
        "manually_assigned"
        "suspicious_payer_text"
        "invalid_amount"
        "payment_date_too_old"
    """
    if not reason_str:
        return "No reason provided"

    r = reason_str.strip()

    # Simple known tokens
    if r == "manually_assigned":
        return "Manually assigned by a user"
    if r == "no_amount_match":
        return "No installment matches the payment amount"
    if r == "invalid_amount":
        return "Payment amount is invalid"
    if r == "suspicious_payer_text":
        return "Payer name looks suspicious or invalid"
    if r == "payment_date_too_old":
        return "Payment date is too far in the past"
    if r == "no_candidates_after_shortlist":
        return "No viable candidates remained after shortlisting"
    if r == "no_api_key":
        return "AI matching skipped (no API key configured)"
    if r.startswith("api_error:"):
        return "AI matching failed due to an API error"
    if r.startswith("json_parse_error"):
        return "AI matching failed (could not parse response)"
    if r.startswith("no_valid_ids_in_response"):
        return "AI returned installment IDs that don't exist"

    # Ambiguous
    m = re.match(r"ambiguous:(\d+)_candidates", r)
    if m:
        return f"Ambiguous: {m.group(1)} candidates with similar amounts"

    # Composite reasons built with '+' separators
    parts = []

    if "exact_amount" in r or r.startswith("amount"):
        parts.append("Payment amount matches an installment exactly")

    # name_match(score) or name(score)_vs_second(score)
    nm = re.search(r"name(?:_match)?\(([0-9.]+)\)", r)
    if nm:
        score = float(nm.group(1))
        parts.append(f"Payer name similarity: {score:.0f}%")

    vs = re.search(r"vs_second\(([0-9.]+)\)", r)
    if vs:
        second = float(vs.group(1))
        parts.append(f"Next-best name match: {second:.0f}%")

    if "weak_name" in r:
        wn = re.search(r"weak_name\(([0-9.]+)\)", r)
        score_val = float(wn.group(1)) if wn else 0
        parts.append(f"Payer name is a weak match ({score_val:.0f}%)")

    if "blank_payer" in r:
        parts.append("Payer name was blank on the bank statement")

    if "globally_unique" in r:
        parts.append("Only one installment matches this amount globally")

    gm = re.search(r"global\((\d+)\)", r)
    if gm:
        count = int(gm.group(1))
        parts.append(f"{count} installments share this amount across all students")

    bm = re.search(r"(\d+)_same_amount", r)
    if bm and not gm:
        count = int(bm.group(1))
        parts.append(f"{count} installments share this amount")

    if "fifo" in r.lower() or "FIFO" in r:
        parts.append("Earliest due date selected (FIFO)")

    # AI free-text reason (from the LLM) -- if none of the patterns matched
    if not parts:
        return r

    return ". ".join(parts) + "."


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

# ── Bug 5: Bulk approve button for high-confidence items ──
high_conf_items = [r for r in pending if r["confidence"] >= 0.90]
if high_conf_items:
    if st.button(
        f"Bulk approve {len(high_conf_items)} item(s) with confidence >= 90%",
        type="primary",
        key="bulk_approve",
    ):
        for item in high_conf_items:
            mid = item["match_id"]
            allocs_raw = json.loads(item["allocations"]) if item["allocations"] else []
            conn.execute("UPDATE match_result SET status='approved' WHERE id=?", (mid,))
            log_audit(conn, "finance_lead", "bulk_approve_match",
                      f"match:{mid}", "pending_review", "approved")
            for a in allocs_raw:
                conn.execute(
                    "UPDATE installment SET status='paid' WHERE id=?",
                    (a["installment_id"],),
                )
        conn.commit()
        st.session_state.selected_idx = 0
        st.toast(f"Bulk approved {len(high_conf_items)} match(es)!")
        st.rerun()

# ── Layout: left list + right detail ──
left, right = st.columns([2, 3])

# Track selection — clamp to valid range
if "selected_idx" not in st.session_state:
    st.session_state.selected_idx = 0
if st.session_state.selected_idx >= len(pending):
    st.session_state.selected_idx = 0

with left:
    with st.container(border=True):
        for idx, row in enumerate(pending):
            payer = row['payer_name'] or '(blank)'
            amount = fmt_amount(row['amount_paid_paise'], row['currency'])
            method = (row['pay_method'] or row['source'] or '').upper()
            date_str = fmt_date_display(row['date'])
            # Bug 2: show actual confidence percentage
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
insts = []  # populated below if allocs exist

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
        # Bug 2: show actual confidence percentage from the match result
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
                # Bug 1: show human-readable reason text instead of raw debug strings
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
                    bullets.append(f"Matcher reasoning: {format_match_reason(row['reason'])}")

                for b in bullets:
                    st.markdown(f"- {b}")

                st.caption("The amount check and balance are calculated by the rules engine, not the AI.")
        else:
            st.markdown("No specific installment suggested — needs manual review.")

    # Other possibilities table
    with st.container(border=True):
        st.markdown("### Other possibilities")
        # Bug 3: filter out installments with status='paid'
        others = conn.execute(
            "SELECT i.id, i.due_date, i.amount_due_paise, i.currency, i.status, "
            "e.program, e.fee_model, s.name as student_name "
            "FROM installment i "
            "JOIN enrollment e ON i.enrollment_id = e.id "
            "JOIN student s ON e.student_id = s.id "
            "WHERE i.amount_due_paise = ? AND i.currency = ? AND i.status != 'paid' "
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
    match_id = row['match_id']

    with col1:
        if st.button(f"Approve: {suggested_name}", type="primary", key=f"approve_{match_id}"):
            conn.execute("UPDATE match_result SET status='approved' WHERE id=?", (match_id,))
            conn.commit()
            log_audit(conn, "finance_lead", "approve_match",
                      f"match:{match_id}", "pending_review", "approved")
            # Update installment status to paid
            for a in allocs:
                conn.execute(
                    "UPDATE installment SET status='paid' WHERE id=?",
                    (a["installment_id"],),
                )
            conn.commit()
            st.session_state.selected_idx = 0
            st.toast(f"Approved match for {suggested_name}!")
            st.rerun()

    with col2:
        if st.button("Pick a different student", key=f"pick_{match_id}"):
            st.session_state[f"picking_{match_id}"] = True
            st.rerun()

    with col3:
        if st.button("Not a fee payment", key=f"notfee_{match_id}"):
            conn.execute(
                "UPDATE match_result SET status='rejected', reason='not_a_fee' WHERE id=?",
                (match_id,),
            )
            conn.commit()
            log_audit(conn, "finance_lead", "mark_not_fee",
                      f"match:{match_id}", "pending_review", "rejected:not_a_fee")
            st.session_state.selected_idx = 0
            st.toast("Marked as not a fee.")
            st.rerun()

    # "Pick a different student" panel
    if st.session_state.get(f"picking_{match_id}"):
        with st.container(border=True):
            st.markdown("#### Pick the correct student")
            # Show all candidates for this amount
            pick_candidates = conn.execute(
                "SELECT i.id as inst_id, i.due_date, i.amount_due_paise, i.currency, "
                "e.program, s.name as student_name, s.id as student_id "
                "FROM installment i "
                "JOIN enrollment e ON i.enrollment_id = e.id "
                "JOIN student s ON e.student_id = s.id "
                "WHERE i.amount_due_paise = ? AND i.currency = ? AND i.status != 'paid' "
                "ORDER BY s.name, i.due_date",
                (row['amount_paid_paise'], row['currency']),
            ).fetchall()

            if pick_candidates:
                options = {
                    f"{c['student_name']} — {c['program']} (due {fmt_date_display(c['due_date'])})": c['inst_id']
                    for c in pick_candidates
                }
                chosen = st.selectbox("Select installment", list(options.keys()), key=f"pick_select_{match_id}")
                pick_col1, pick_col2 = st.columns(2)
                if pick_col1.button("Confirm selection", type="primary", key=f"confirm_pick_{match_id}"):
                    chosen_id = options[chosen]
                    new_allocs = json.dumps([{"installment_id": chosen_id, "allocated_paise": row['amount_paid_paise']}])
                    conn.execute(
                        "UPDATE match_result SET allocations=?, status='approved', "
                        "method='human', reason='manually_assigned' WHERE id=?",
                        (new_allocs, match_id),
                    )
                    conn.execute("UPDATE installment SET status='paid' WHERE id=?", (chosen_id,))
                    conn.commit()
                    log_audit(conn, "finance_lead", "manual_match",
                              f"match:{match_id}", str(allocs), new_allocs)
                    del st.session_state[f"picking_{match_id}"]
                    st.session_state.selected_idx = 0
                    st.toast("Manually assigned and approved!")
                    st.rerun()
                if pick_col2.button("Cancel", key=f"cancel_pick_{match_id}"):
                    del st.session_state[f"picking_{match_id}"]
                    st.rerun()
            else:
                st.write("No open installments match this amount.")
                if st.button("Cancel", key=f"cancel_pick2_{match_id}"):
                    del st.session_state[f"picking_{match_id}"]
                    st.rerun()

    st.caption(
        "Approving records the payment, updates the student's balance, "
        "credits their counselor's commission, and logs who approved it and when."
    )

    # Bug 4: keyboard shortcuts hint
    st.markdown(
        '<p style="color:#8395a7; font-size:0.8rem; margin-top:16px;">'
        'Keyboard: A=approve, N=next, R=reject</p>',
        unsafe_allow_html=True,
    )
