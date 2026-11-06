"""Educore Finance Desk — Home (Today) page."""

import sys
from pathlib import Path

# Ensure project root is importable
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

import json
import streamlit as st
from ledger.db import get_connection
from ledger.load import load_all

DATA_DIR = PROJECT_ROOT / "data"
DB_PATH = ":memory:"


@st.cache_resource
def get_db():
    """Load data into an in-memory SQLite DB (cached across reruns)."""
    return load_all(data_dir=DATA_DIR, db_path=DB_PATH)


def fmt_inr(paise: int) -> str:
    """Format paise as ₹X,XX,XXX."""
    rupees = paise / 100
    if rupees >= 100_000:
        return f"₹{rupees:,.0f}"
    return f"₹{rupees:,.2f}" if rupees != int(rupees) else f"₹{int(rupees):,}"


def main():
    st.set_page_config(page_title="Educore Finance Desk", layout="wide")
    st.title("Educore Finance Desk")
    st.caption("Today's dashboard")

    conn = get_db()

    # Key totals
    total_received = conn.execute(
        "SELECT COALESCE(SUM(amount_paid_paise), 0) FROM payment_in WHERE currency='INR'"
    ).fetchone()[0]

    total_out = conn.execute(
        "SELECT COALESCE(SUM(amount_paise), 0) FROM payment_out WHERE currency='INR'"
    ).fetchone()[0]

    total_installments_due = conn.execute(
        "SELECT COALESCE(SUM(amount_due_paise), 0) FROM installment "
        "WHERE status IN ('open','overdue') AND currency='INR'"
    ).fetchone()[0]

    overdue_count = conn.execute(
        "SELECT COUNT(*) FROM installment WHERE status='overdue'"
    ).fetchone()[0]

    # Match stats
    matched_count = conn.execute(
        "SELECT COUNT(*) FROM match_result WHERE status IN ('auto','approved')"
    ).fetchone()[0]
    unmatched_count = conn.execute(
        "SELECT COUNT(*) FROM payment_in"
    ).fetchone()[0] - matched_count

    pending_review = conn.execute(
        "SELECT COUNT(*) FROM match_result WHERE status='pending_review'"
    ).fetchone()[0]

    # Display metrics
    col1, col2, col3, col4 = st.columns(4)
    col1.metric("Total Received (INR)", fmt_inr(total_received))
    col2.metric("Unmatched Payments", unmatched_count)
    col3.metric("Overdue Installments", overdue_count)
    col4.metric("Pending Review", pending_review)

    col5, col6, col7, col8 = st.columns(4)
    col5.metric("Total Paid Out (INR)", fmt_inr(total_out))
    col6.metric("Outstanding Fees (INR)", fmt_inr(total_installments_due))
    col7.metric("Matched Payments", matched_count)
    col8.metric("Net Cash (INR)", fmt_inr(total_received - total_out))

    st.divider()

    # Needs your decision
    st.subheader("Needs Your Decision")
    pending = conn.execute(
        "SELECT mr.id, mr.payment_id, mr.confidence, mr.reason, mr.method, "
        "p.payer_name, p.amount_paid_paise, p.currency "
        "FROM match_result mr "
        "JOIN payment_in p ON mr.payment_id = p.id "
        "WHERE mr.status = 'pending_review' "
        "ORDER BY mr.confidence DESC LIMIT 10"
    ).fetchall()

    if pending:
        for row in pending:
            with st.container(border=True):
                c1, c2, c3 = st.columns([2, 2, 1])
                c1.write(f"**Payment #{row['payment_id']}** — {row['payer_name'] or '(blank)'}")
                c2.write(f"{fmt_inr(row['amount_paid_paise'])} {row['currency']} | "
                         f"Confidence: {row['confidence']:.0%}")
                c3.write(f"_{row['method']}_ — {row['reason'][:50]}")
    else:
        st.info("No payments pending review. Run the matcher first, or all payments are resolved.")

    st.divider()

    # Recent payments
    st.subheader("Recent Payments")
    recent = conn.execute(
        "SELECT id, date, payer_name, amount_paid_paise, currency, source, confirmation "
        "FROM payment_in ORDER BY date DESC LIMIT 15"
    ).fetchall()

    if recent:
        rows = []
        for r in recent:
            rows.append({
                "ID": r["id"],
                "Date": r["date"] or "",
                "Payer": r["payer_name"] or "(blank)",
                "Amount": fmt_inr(r["amount_paid_paise"]),
                "Currency": r["currency"],
                "Source": r["source"],
                "Confirmation": r["confirmation"],
            })
        st.dataframe(rows, use_container_width=True, hide_index=True)


if __name__ == "__main__":
    main()
