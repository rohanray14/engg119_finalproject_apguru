"""Educore Finance Desk — Today page."""

import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

import json
from datetime import date, timedelta
import streamlit as st
from ledger.load import load_all

DATA_DIR = PROJECT_ROOT / "data"
_DB_FILE = PROJECT_ROOT / "data" / "_app_ledger.db"


def compute_dashboard_stats(conn, as_of: date) -> dict:
    """Compute all dashboard numbers from one source of truth.

    Returns a dict with keys:
        total_payments, total_received, confirmed,
        overdue_count, overdue_amount,
        unmatched_count, unmatched_amount,
        suggested_count, needs_review_count, matched_count,
        forecast_weeks (list of dicts with Week / Scheduled / Less certain)
    """
    as_of_iso = as_of.isoformat()

    total_payments = conn.execute("SELECT COUNT(*) FROM payment_in").fetchone()[0]
    total_received = conn.execute(
        "SELECT COALESCE(SUM(amount_paid_paise), 0) FROM payment_in"
    ).fetchone()[0]
    confirmed = conn.execute(
        "SELECT COALESCE(SUM(amount_paid_paise), 0) FROM payment_in WHERE confirmation='in_bank'"
    ).fetchone()[0]

    # Overdue: open installments whose due_date is before as_of
    overdue_count = conn.execute(
        "SELECT COUNT(*) FROM installment WHERE status='open' AND due_date < ?",
        (as_of_iso,),
    ).fetchone()[0]
    overdue_amount = conn.execute(
        "SELECT COALESCE(SUM(amount_due_paise), 0) FROM installment "
        "WHERE status='open' AND due_date < ?",
        (as_of_iso,),
    ).fetchone()[0]

    # Payment match states --------------------------------------------------
    # unmatched: no match_result row at all
    unmatched_count = conn.execute(
        "SELECT COUNT(*) FROM payment_in p "
        "LEFT JOIN match_result mr ON mr.payment_id = p.id "
        "WHERE mr.id IS NULL"
    ).fetchone()[0]
    unmatched_amount = conn.execute(
        "SELECT COALESCE(SUM(p.amount_paid_paise), 0) FROM payment_in p "
        "LEFT JOIN match_result mr ON mr.payment_id = p.id "
        "WHERE mr.id IS NULL"
    ).fetchone()[0]
    # suggested: pending_review WITH allocations (non-empty)
    suggested_count = conn.execute(
        "SELECT COUNT(*) FROM match_result "
        "WHERE status='pending_review' AND allocations != '[]'"
    ).fetchone()[0]
    # needs_review: pending_review with empty allocations
    needs_review_count = conn.execute(
        "SELECT COUNT(*) FROM match_result "
        "WHERE status='pending_review' AND allocations = '[]'"
    ).fetchone()[0]
    # matched: auto or approved
    matched_count = conn.execute(
        "SELECT COUNT(*) FROM match_result WHERE status IN ('auto','approved')"
    ).fetchone()[0]

    # Cash forecast: actual installment amounts in the next 6 weeks ---------
    forecast_weeks = []
    for i in range(6):
        week_start = as_of + timedelta(weeks=i)
        week_end = week_start + timedelta(days=6)
        label = week_start.strftime("%-d %b")
        scheduled = conn.execute(
            "SELECT COALESCE(SUM(amount_due_paise), 0) FROM installment "
            "WHERE status IN ('open','partial') AND due_date BETWEEN ? AND ?",
            (week_start.isoformat(), week_end.isoformat()),
        ).fetchone()[0]
        # "Less certain" = apply a haircut for late-paying families
        likely = int(scheduled * 0.7)
        forecast_weeks.append({
            "Week": label,
            "Scheduled": scheduled / 100,   # convert paise to rupees for display
            "Less certain": likely / 100,
        })

    return {
        "total_payments": total_payments,
        "total_received": total_received,
        "confirmed": confirmed,
        "overdue_count": overdue_count,
        "overdue_amount": overdue_amount,
        "unmatched_count": unmatched_count,
        "unmatched_amount": unmatched_amount,
        "suggested_count": suggested_count,
        "needs_review_count": needs_review_count,
        "matched_count": matched_count,
        "forecast_weeks": forecast_weeks,
    }


@st.cache_resource
def get_db():
    """Load data and run matcher (cached across reruns)."""
    import sqlite3, os
    if _DB_FILE.exists():
        os.remove(_DB_FILE)
    conn = load_all(data_dir=DATA_DIR, db_path=str(_DB_FILE))

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
    conn.close()

    conn = sqlite3.connect(str(_DB_FILE), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def main():
    st.set_page_config(
        page_title="Educore Finance Desk",
        page_icon="💰",
        layout="wide",
    )

    from app.style import apply_theme, badge, metric_subtitle, fmt_inr, fmt_amount, fmt_date_display
    apply_theme()

    conn = get_db()

    # ── Determine the "as of" date from sidebar ──
    # Read max due_date from installments to set a sensible default
    max_date_row = conn.execute(
        "SELECT MAX(due_date) FROM installment WHERE due_date IS NOT NULL"
    ).fetchone()
    if max_date_row and max_date_row[0]:
        default_as_of = date.fromisoformat(max_date_row[0])
    else:
        default_as_of = date(2026, 9, 30)

    # Sidebar branding + date picker
    with st.sidebar:
        st.markdown("## Educore")
        st.caption("Finance Desk")
        st.markdown("---")
        as_of = st.date_input(
            "As-of date",
            value=default_as_of,
            min_value=date(2025, 4, 1),
            max_value=date(2026, 9, 30),
            help="All overdue / forecast calculations use this date.",
        )
        st.markdown("---")
        st.markdown(
            '<p style="color:#8395a7; font-size:0.75rem; margin-top:2rem;">'
            '<b>Data sources</b><br>'
            'Bank statement · synced on load<br>'
            'PayGlocal, Stripe, Razorpay · synced on load<br>'
            'Fee tracker · synced on load</p>',
            unsafe_allow_html=True,
        )

    # ── Compute all stats from one helper ──
    stats = compute_dashboard_stats(conn, as_of)

    # ── Header ──
    st.caption(as_of.strftime("%A, %-d %B %Y"))
    st.title("Today")

    # ── Briefing card ──
    auto_matched = stats["matched_count"]
    pending_review = stats["suggested_count"] + stats["needs_review_count"]
    overdue_count = stats["overdue_count"]

    from agents.risk import scan_risks
    risk_flags = scan_risks(conn, as_of=as_of)
    high_risk = [f for f in risk_flags if f.severity == "high"]

    from agents.reminders import generate_reminders
    reminders = generate_reminders(conn, as_of=as_of)
    overdue_reminders = [r for r in reminders if r.reminder_type == "overdue"]

    with st.container(border=True):
        st.markdown(
            f'{badge("BRIEFING", "teal")} &nbsp; '
            f'<span style="color:#636e72;">Written by the copilot from today\'s ledger</span>',
            unsafe_allow_html=True,
        )
        st.markdown(
            f"**{auto_matched} payments** were matched automatically; "
            f"**{pending_review}** need you. "
            f"{'Two things are urgent: ' if (high_risk or overdue_reminders) else ''}"
            f"{'a risk flag needs checking, and ' if high_risk else ''}"
            f"**{overdue_count} installments** are past due."
        )
        col_a, col_b, _ = st.columns([1, 1, 3])
        with col_a:
            if st.button(f"Review {pending_review} payments", type="primary"):
                st.switch_page("pages/2_Review_Queue.py")
        with col_b:
            if st.button("Ask a follow-up"):
                st.switch_page("pages/8_Ask.py")

    st.write("")

    # ── Metric cards ──
    col1, col2, col3, col4 = st.columns(4)
    with col1:
        st.metric("Received (total)", fmt_inr(stats["total_received"]))
        st.markdown(metric_subtitle(f"{fmt_inr(stats['confirmed'])} confirmed in bank"), unsafe_allow_html=True)
    with col2:
        st.metric("Unmatched", str(stats["unmatched_count"]))
        st.markdown(metric_subtitle(f"{fmt_inr(stats['unmatched_amount'])} with no match"), unsafe_allow_html=True)
    with col3:
        st.metric("Installments overdue", str(overdue_count))
        st.markdown(
            f'<p style="color:#e74c3c; font-size:0.8rem; margin-top:-8px;">'
            f'{fmt_inr(stats["overdue_amount"])} outstanding</p>',
            unsafe_allow_html=True,
        )
    with col4:
        counselor_count = conn.execute("SELECT COUNT(DISTINCT id) FROM counselor").fetchone()[0]
        st.metric("Commissions ready", "—")
        st.markdown(metric_subtitle(f"{counselor_count} counselors · after 2% TDS"), unsafe_allow_html=True)

    st.write("")

    # ── Match-state summary ──
    with st.container(border=True):
        st.markdown("### Payment match states")
        s1, s2, s3, s4 = st.columns(4)
        s1.metric("Unmatched", stats["unmatched_count"])
        s1.caption("No match attempted yet")
        s2.metric("Suggested", stats["suggested_count"])
        s2.caption("AI/rules suggested allocations — review needed")
        s3.metric("Needs review", stats["needs_review_count"])
        s3.caption("Low-confidence or no allocations — manual review")
        s4.metric("Matched", stats["matched_count"])
        s4.caption("Auto-matched or human-approved")

    st.write("")

    # ── Needs your decision + Cash forecast ──
    left, right = st.columns([3, 2])

    with left:
        with st.container(border=True):
            st.markdown("### Needs your decision")

            # Risk items
            for f in high_risk[:2]:
                cols = st.columns([1, 5, 1])
                cols[0].markdown(badge("Risk", "red"), unsafe_allow_html=True)
                cols[1].markdown(f"**{f.explanation[:80]}**<br>"
                                 f'<span style="color:#636e72; font-size:0.85rem;">{f.category}</span>',
                                 unsafe_allow_html=True)
                if cols[2].button("Check", key=f"risk_{f.entity}"):
                    st.switch_page("pages/7_Risk.py")
                st.markdown("---")

            # Match review items
            pending_rows = conn.execute(
                "SELECT mr.id, mr.payment_id, mr.confidence, mr.reason, "
                "p.payer_name, p.amount_paid_paise, p.currency, p.method, p.date "
                "FROM match_result mr "
                "JOIN payment_in p ON mr.payment_id = p.id "
                "WHERE mr.status = 'pending_review' AND mr.allocations != '[]' "
                "ORDER BY mr.confidence DESC LIMIT 2"
            ).fetchall()
            for row in pending_rows:
                cols = st.columns([1, 5, 1])
                cols[0].markdown(badge("Match", "teal"), unsafe_allow_html=True)
                cols[1].markdown(
                    f"**{fmt_amount(row['amount_paid_paise'], row['currency'])} from "
                    f"{row['payer_name'] or '(blank)'}**<br>"
                    f'<span style="color:#636e72; font-size:0.85rem;">'
                    f"{row['confidence']:.0%} sure. "
                    f"{'Below 95% auto-match, so it waits for you.' if row['confidence'] < 0.95 else ''}"
                    f"</span>",
                    unsafe_allow_html=True,
                )
                if cols[2].button("Review", key=f"match_{row['id']}"):
                    st.switch_page("pages/2_Review_Queue.py")
                st.markdown("---")

            # Overdue reminders
            if overdue_reminders:
                cols = st.columns([1, 5, 1])
                cols[0].markdown(badge("Overdue", "orange"), unsafe_allow_html=True)
                cols[1].markdown(
                    f"**{len(overdue_reminders)} installments are past due — reminders drafted**<br>"
                    f'<span style="color:#636e72; font-size:0.85rem;">'
                    f"One message per family, with the exact amount.</span>",
                    unsafe_allow_html=True,
                )
                if cols[2].button("Read drafts", key="overdue_drafts"):
                    st.switch_page("pages/6_Reminders.py")

    with right:
        with st.container(border=True):
            st.markdown("### Expected cash, next 6 weeks")
            st.caption("From installments already scheduled, adjusted for how late families usually pay")

            import pandas as pd
            df = pd.DataFrame(stats["forecast_weeks"])
            df = df.set_index("Week")
            st.bar_chart(df, color=["#1a6b5a", "#b2dfdb"])

    st.write("")

    # ── Ask box at bottom ──
    with st.container(border=True):
        cols = st.columns([1, 8, 1])
        cols[0].markdown(
            '<p style="font-weight:600; color:#1a2332; margin-top:8px;">Ask</p>',
            unsafe_allow_html=True,
        )
        question = cols[1].text_input(
            "Ask",
            placeholder="e.g. Which families still owe us for November?",
            label_visibility="collapsed",
        )
        if cols[2].button("Ask", type="primary", key="ask_home"):
            if question:
                st.session_state["home_question"] = question
                st.rerun()

    if st.session_state.get("home_question"):
        from agents.copilot import ask as copilot_ask
        answer = copilot_ask(conn, st.session_state["home_question"])
        with st.container(border=True):
            st.markdown(f'**Q: {st.session_state["home_question"]}**')
            st.write(answer.answer)
            if answer.transactions:
                st.dataframe(answer.transactions, use_container_width=True, hide_index=True)
            if answer.query_used:
                with st.expander("How this was worked out"):
                    st.caption(answer.query_used)
            if st.button("Clear", key="clear_ask"):
                del st.session_state["home_question"]
                st.rerun()


if __name__ == "__main__":
    main()
