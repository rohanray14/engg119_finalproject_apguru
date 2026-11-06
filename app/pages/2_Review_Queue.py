"""Review Queue — one payment at a time for human approval."""

import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

import json
import streamlit as st
from app.Home import get_db, fmt_inr
from ledger.db import log_audit

st.set_page_config(page_title="Review Queue | Educore", layout="wide")
st.title("Review Queue")

conn = get_db()

# Run matcher if no match results exist
match_count = conn.execute("SELECT COUNT(*) FROM match_result").fetchone()[0]
if match_count == 0:
    if st.button("Run Rules Matcher"):
        from agents.matching_rules import match_all
        predictions = match_all(conn)
        for pred in predictions:
            if pred.confidence > 0 and pred.installment_ids:
                status = "auto" if pred.confidence >= 0.8 else "pending_review"
                allocs = json.dumps([{"installment_id": iid, "allocated_paise": 0}
                                     for iid in pred.installment_ids])
                conn.execute(
                    "INSERT INTO match_result (payment_id, allocations, method, confidence, reason, status) "
                    "VALUES (?, ?, ?, ?, ?, ?)",
                    (pred.payment_id, allocs, pred.method, pred.confidence, pred.reason or "", status),
                )
            elif pred.confidence > 0:
                conn.execute(
                    "INSERT INTO match_result (payment_id, allocations, method, confidence, reason, status) "
                    "VALUES (?, ?, ?, ?, ?, ?)",
                    (pred.payment_id, "[]", pred.method, pred.confidence, pred.reason or "", "pending_review"),
                )
        conn.commit()
        st.rerun()

# Get pending reviews
pending = conn.execute(
    "SELECT mr.id as match_id, mr.payment_id, mr.allocations, mr.confidence, "
    "mr.reason, mr.method, "
    "p.payer_name, p.amount_paid_paise, p.currency, p.date, p.source, "
    "p.gateway_fee_paise, p.gst_on_fee_paise, p.fx_diff_paise, p.tds_paise "
    "FROM match_result mr "
    "JOIN payment_in p ON mr.payment_id = p.id "
    "WHERE mr.status = 'pending_review' "
    "ORDER BY mr.confidence DESC"
).fetchall()

if not pending:
    st.success("No payments pending review!")
    st.stop()

st.caption(f"{len(pending)} payments awaiting review")

# Show one at a time
idx = st.number_input("Review #", min_value=1, max_value=len(pending), value=1, step=1) - 1
row = pending[idx]

st.divider()

# Payment details
col1, col2 = st.columns(2)
with col1:
    st.subheader(f"Payment #{row['payment_id']}")
    st.write(f"**Payer:** {row['payer_name'] or '(blank)'}")
    st.write(f"**Amount:** {fmt_inr(row['amount_paid_paise'])} {row['currency']}")
    st.write(f"**Date:** {row['date'] or 'unknown'}")
    st.write(f"**Source:** {row['source']}")
    deductions = row['gateway_fee_paise'] + row['gst_on_fee_paise'] + row['fx_diff_paise'] + row['tds_paise']
    if deductions:
        st.write(f"**Deductions:** {fmt_inr(deductions)}")

with col2:
    st.subheader("AI Suggestion")
    st.write(f"**Method:** {row['method']}")
    st.write(f"**Confidence:** {row['confidence']:.0%}")
    st.write(f"**Reason:** {row['reason']}")

    # Show suggested installment(s)
    allocs = json.loads(row['allocations']) if row['allocations'] else []
    if allocs:
        inst_ids = [a["installment_id"] for a in allocs]
        placeholders = ",".join("?" * len(inst_ids))
        insts = conn.execute(
            f"SELECT i.id, i.due_date, i.amount_due_paise, i.currency, i.status, "
            f"e.student_id, s.name as student_name "
            f"FROM installment i "
            f"JOIN enrollment e ON i.enrollment_id = e.id "
            f"JOIN student s ON e.student_id = s.id "
            f"WHERE i.id IN ({placeholders})",
            inst_ids,
        ).fetchall()
        for inst in insts:
            st.write(f"  → Installment #{inst['id']}: {inst['student_name']} — "
                     f"{fmt_inr(inst['amount_due_paise'])} {inst['currency']} "
                     f"due {inst['due_date'] or 'unknown'} ({inst['status']})")
    else:
        st.write("No installment suggested.")

st.divider()

# Other candidates (same amount, different from suggestion)
st.subheader("Other Candidates")
other = conn.execute(
    "SELECT i.id, i.due_date, i.amount_due_paise, i.currency, i.status, "
    "e.student_id, s.name as student_name "
    "FROM installment i "
    "JOIN enrollment e ON i.enrollment_id = e.id "
    "JOIN student s ON e.student_id = s.id "
    "WHERE i.amount_due_paise = ? AND i.currency = ? "
    "ORDER BY i.due_date",
    (row['amount_paid_paise'], row['currency']),
).fetchall()

suggested_ids = {a["installment_id"] for a in allocs} if allocs else set()
others = [o for o in other if o["id"] not in suggested_ids]

if others:
    for o in others[:10]:
        st.write(f"  Installment #{o['id']}: {o['student_name']} — "
                 f"{fmt_inr(o['amount_due_paise'])} {o['currency']} "
                 f"due {o['due_date'] or 'unknown'} ({o['status']})")
else:
    st.write("No other candidates with matching amount.")

st.divider()

# Action buttons
col1, col2, col3 = st.columns(3)
with col1:
    if st.button("Approve", type="primary", key=f"approve_{row['match_id']}"):
        conn.execute(
            "UPDATE match_result SET status='approved' WHERE id=?",
            (row['match_id'],),
        )
        conn.commit()
        log_audit(conn, "finance_lead", "approve_match",
                  f"match:{row['match_id']}", "pending_review", "approved")
        st.success(f"Match #{row['match_id']} approved!")
        st.rerun()

with col2:
    if st.button("Reject", key=f"reject_{row['match_id']}"):
        conn.execute(
            "UPDATE match_result SET status='rejected' WHERE id=?",
            (row['match_id'],),
        )
        conn.commit()
        log_audit(conn, "finance_lead", "reject_match",
                  f"match:{row['match_id']}", "pending_review", "rejected")
        st.warning(f"Match #{row['match_id']} rejected.")
        st.rerun()

with col3:
    if st.button("Not a Fee", key=f"notfee_{row['match_id']}"):
        conn.execute(
            "UPDATE match_result SET status='rejected', reason='not_a_fee' WHERE id=?",
            (row['match_id'],),
        )
        conn.commit()
        log_audit(conn, "finance_lead", "mark_not_fee",
                  f"match:{row['match_id']}", "pending_review", "rejected:not_a_fee")
        st.info(f"Payment #{row['payment_id']} marked as not a fee.")
        st.rerun()
