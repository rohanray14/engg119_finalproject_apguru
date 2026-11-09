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
    """Compute all dashboard numbers from one source of truth."""
    as_of_iso = as_of.isoformat()

    total_payments = conn.execute("SELECT COUNT(*) FROM payment_in").fetchone()[0]
    total_received = conn.execute(
        "SELECT COALESCE(SUM(amount_paid_paise), 0) FROM payment_in"
    ).fetchone()[0]
    confirmed = conn.execute(
        "SELECT COALESCE(SUM(amount_paid_paise), 0) FROM payment_in WHERE confirmation='in_bank'"
    ).fetchone()[0]

    # Total expected (all installments)
    total_expected = conn.execute(
        "SELECT COALESCE(SUM(amount_due_paise), 0) FROM installment"
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

    # Oldest overdue installment
    oldest_overdue_row = conn.execute(
        "SELECT MIN(due_date) FROM installment WHERE status='open' AND due_date < ?",
        (as_of_iso,),
    ).fetchone()
    oldest_overdue_date = oldest_overdue_row[0] if oldest_overdue_row else None
    if oldest_overdue_date:
        oldest_overdue_days = (as_of - date.fromisoformat(oldest_overdue_date)).days
    else:
        oldest_overdue_days = 0

    # Payment match states
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
    suggested_count = conn.execute(
        "SELECT COUNT(*) FROM match_result "
        "WHERE status='pending_review' AND allocations != '[]'"
    ).fetchone()[0]
    needs_review_count = conn.execute(
        "SELECT COUNT(*) FROM match_result "
        "WHERE status='pending_review' AND allocations = '[]'"
    ).fetchone()[0]
    matched_count = conn.execute(
        "SELECT COUNT(*) FROM match_result WHERE status IN ('auto','approved')"
    ).fetchone()[0]

    # Confirmation breakdown
    confirmation_counts = {}
    for r in conn.execute("SELECT confirmation, COUNT(*) FROM payment_in GROUP BY confirmation"):
        confirmation_counts[r[0]] = r[1]

    # Money out
    total_out = conn.execute(
        "SELECT COALESCE(SUM(amount_paise), 0) FROM payment_out"
    ).fetchone()[0]

    # Collections vs Expected by month (last 12 months from as_of)
    months_data = []
    for i in range(12):
        # Go backwards from as_of
        month_offset = 11 - i
        m_start = date(as_of.year, as_of.month, 1) - timedelta(days=30 * month_offset)
        m_start = m_start.replace(day=1)
        if m_start.month == 12:
            m_end = m_start.replace(year=m_start.year + 1, month=1, day=1) - timedelta(days=1)
        else:
            m_end = m_start.replace(month=m_start.month + 1, day=1) - timedelta(days=1)

        expected = conn.execute(
            "SELECT COALESCE(SUM(amount_due_paise), 0) FROM installment "
            "WHERE due_date BETWEEN ? AND ?",
            (m_start.isoformat(), m_end.isoformat()),
        ).fetchone()[0]

        collected = conn.execute(
            "SELECT COALESCE(SUM(amount_paid_paise), 0) FROM payment_in "
            "WHERE date BETWEEN ? AND ?",
            (m_start.isoformat(), m_end.isoformat()),
        ).fetchone()[0]

        months_data.append({
            "Month": m_start.strftime("%b %y"),
            "Expected": expected / 100,
            "Collected": collected / 100,
        })

    # Cash forecast: upcoming installments in the next 6 weeks
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
        likely = int(scheduled * 0.7)
        forecast_weeks.append({
            "Week": label,
            "Scheduled": scheduled / 100,
            "Likely (70%)": likely / 100,
        })

    # Commission totals
    total_commission = conn.execute(
        "SELECT COALESCE(SUM(commission_paise), 0) FROM commission_line"
    ).fetchone()[0]
    total_tds = conn.execute(
        "SELECT COALESCE(SUM(tds_paise), 0) FROM commission_line"
    ).fetchone()[0]
    total_commission_net = conn.execute(
        "SELECT COALESCE(SUM(net_paise), 0) FROM commission_line"
    ).fetchone()[0]
    counselors_with_commission = conn.execute(
        "SELECT COUNT(DISTINCT counselor_id) FROM commission_line WHERE net_paise > 0"
    ).fetchone()[0]

    return {
        "total_payments": total_payments,
        "total_received": total_received,
        "total_expected": total_expected,
        "confirmed": confirmed,
        "overdue_count": overdue_count,
        "overdue_amount": overdue_amount,
        "oldest_overdue_days": oldest_overdue_days,
        "unmatched_count": unmatched_count,
        "unmatched_amount": unmatched_amount,
        "suggested_count": suggested_count,
        "needs_review_count": needs_review_count,
        "matched_count": matched_count,
        "confirmation_counts": confirmation_counts,
        "total_out": total_out,
        "months_data": months_data,
        "forecast_weeks": forecast_weeks,
        "total_commission": total_commission,
        "total_tds": total_tds,
        "total_commission_net": total_commission_net,
        "counselors_with_commission": counselors_with_commission,
    }


@st.cache_resource
def get_db():
    """Load data, run matcher, and compute commissions (cached across reruns)."""
    import sqlite3, os
    if _DB_FILE.exists():
        os.remove(_DB_FILE)
    conn = load_all(data_dir=DATA_DIR, db_path=str(_DB_FILE))

    # Run matching
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

    # Compute commissions from matched payments and insert into commission_line
    from agents.commissions import compute_commissions
    calcs = compute_commissions(conn)
    for c in calcs:
        conn.execute(
            "INSERT INTO commission_line "
            "(counselor_id, payment_id, base_paise, rate, commission_paise, "
            "refund_deduction_paise, tds_paise, net_paise) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (c.counselor_id, c.payment_id, c.base_paise, c.rate,
             c.commission_paise, c.refund_deduction_paise, c.tds_paise, c.net_paise),
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

    from app.auth import check_auth
    if not check_auth():
        st.stop()

    from app.style import apply_theme, badge, metric_subtitle, fmt_inr, fmt_amount, fmt_date_display
    apply_theme()

    conn = get_db()

    # ── Sidebar: as-of date ──
    min_date_row = conn.execute("SELECT MIN(due_date) FROM installment WHERE due_date IS NOT NULL").fetchone()
    max_date_row = conn.execute("SELECT MAX(due_date) FROM installment WHERE due_date IS NOT NULL").fetchone()
    min_date = date.fromisoformat(min_date_row[0]) if min_date_row and min_date_row[0] else date(2025, 4, 1)
    max_date = date.fromisoformat(max_date_row[0]) if max_date_row and max_date_row[0] else date(2026, 9, 30)
    # Default to midpoint of the data range for a useful view
    default_as_of = min_date + (max_date - min_date) // 2

    with st.sidebar:
        st.markdown("## Educore")
        st.caption("Finance Desk")
        st.markdown("---")
        as_of = st.date_input(
            "As-of date",
            value=default_as_of,
            min_value=min_date,
            max_value=max_date,
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

    # ── Compute all stats ──
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

    collection_rate = (stats["total_received"] / stats["total_expected"] * 100) if stats["total_expected"] > 0 else 0
    confirm_rate = (stats["confirmed"] / stats["total_received"] * 100) if stats["total_received"] > 0 else 0

    with st.container(border=True):
        st.markdown(
            f'{badge("BRIEFING", "teal")} &nbsp; '
            f'<span style="color:#636e72;">Written by the copilot from today\'s ledger</span>',
            unsafe_allow_html=True,
        )
        oldest_note = f" (oldest: {stats['oldest_overdue_days']} days)" if stats['oldest_overdue_days'] > 0 else ""
        risk_note = f" {len(high_risk)} high-severity risk flag(s)." if high_risk else ""
        st.markdown(
            f"**{auto_matched} payments** matched automatically; "
            f"**{pending_review}** need review. "
            f"Collection rate is **{collection_rate:.0f}%** of expected fees. "
            f"**{overdue_count} installments** are past due{oldest_note}.{risk_note}"
        )
        col_a, col_b, _ = st.columns([1, 1, 3])
        with col_a:
            if st.button(f"Review {pending_review} payments", type="primary"):
                st.switch_page("pages/2_Review_Queue.py")
        with col_b:
            if st.button("Ask a follow-up"):
                st.switch_page("pages/8_Ask.py")

    st.write("")

    # ── Row 1: Key metrics ──
    col1, col2, col3, col4 = st.columns(4)
    net_position = stats["total_received"] - stats["total_out"]
    with col1:
        st.metric("Money in", fmt_inr(stats["total_received"]))
        st.markdown(metric_subtitle(f"{stats['total_payments']} payments · {confirm_rate:.0f}% confirmed"), unsafe_allow_html=True)
    with col2:
        st.metric("Money out", fmt_inr(stats["total_out"]))
        st.markdown(metric_subtitle("Faculty, rent, refunds, tax, etc."), unsafe_allow_html=True)
    with col3:
        st.metric("Net position", fmt_inr(net_position))
        st.markdown(
            metric_subtitle(f"Collection rate: {collection_rate:.0f}%"),
            unsafe_allow_html=True,
        )
    with col4:
        st.metric("Overdue", f"{overdue_count} ({fmt_inr(stats['overdue_amount'])})")
        if stats['oldest_overdue_days'] > 0:
            st.markdown(
                f'<p style="color:#e74c3c; font-size:0.8rem; margin-top:-8px;">'
                f'Oldest: {stats["oldest_overdue_days"]} days past due</p>',
                unsafe_allow_html=True,
            )

    st.write("")

    # ── Row 2: Confirmation + Commissions + Match states ──
    col1, col2, col3 = st.columns(3)

    with col1:
        with st.container(border=True):
            st.markdown("### Confirmation status")
            cc = stats["confirmation_counts"]
            in_bank = cc.get("in_bank", 0)
            by_gateway = cc.get("seen_by_gateway", 0)
            screenshot = cc.get("screenshot_only", 0)
            total = in_bank + by_gateway + screenshot
            if total > 0:
                st.markdown(
                    f'<div style="display:flex; height:24px; border-radius:6px; overflow:hidden; margin:8px 0;">'
                    f'<div style="background:#27ae60; width:{in_bank/total*100:.0f}%;"></div>'
                    f'<div style="background:#f39c12; width:{by_gateway/total*100:.0f}%;"></div>'
                    f'<div style="background:#e74c3c; width:{screenshot/total*100:.0f}%;"></div>'
                    f'</div>',
                    unsafe_allow_html=True,
                )
                st.markdown(
                    f'{badge(f"In bank: {in_bank}", "green")} &nbsp; '
                    f'{badge(f"Gateway: {by_gateway}", "orange")} &nbsp; '
                    f'{badge(f"Screenshot: {screenshot}", "red")}',
                    unsafe_allow_html=True,
                )

    with col2:
        with st.container(border=True):
            st.markdown("### Commissions")
            if stats["total_commission"] > 0:
                st.metric("Earned", fmt_inr(stats["total_commission"]))
                st.markdown(
                    f"TDS withheld: {fmt_inr(stats['total_tds'])} · "
                    f"**Net payable: {fmt_inr(stats['total_commission_net'])}**"
                )
                st.caption(f"{stats['counselors_with_commission']} counselors with earned commissions")
            else:
                st.caption("No commissions computed yet — match more payments first.")

    with col3:
        with st.container(border=True):
            st.markdown("### Match states")
            s1, s2 = st.columns(2)
            s1.metric("Matched", stats["matched_count"])
            s1.caption("Auto or approved")
            s2.metric("Pending", stats["suggested_count"] + stats["needs_review_count"])
            s2.caption("Needs review")
            s1b, s2b = st.columns(2)
            s1b.metric("Unmatched", stats["unmatched_count"])
            s1b.caption("No match attempted")
            s2b.metric("Suggested", stats["suggested_count"])
            s2b.caption("Has allocations")

    st.write("")

    # ── Row 3: Collections vs Expected + Cash forecast ──
    left, right = st.columns([3, 2])

    with left:
        with st.container(border=True):
            st.markdown("### Collections vs expected by month")
            st.caption("Expected = installments due that month. Collected = payments received.")
            import pandas as pd
            df = pd.DataFrame(stats["months_data"])
            if not df.empty and df[["Expected", "Collected"]].sum().sum() > 0:
                df = df.set_index("Month")
                st.bar_chart(df, color=["#dfe6e9", "#1a6b5a"])
            else:
                st.info("No data in this date range.")

    with right:
        with st.container(border=True):
            st.markdown("### Expected cash, next 6 weeks")
            st.caption("Open installments due in the coming weeks")
            import pandas as pd
            df_fc = pd.DataFrame(stats["forecast_weeks"])
            if not df_fc.empty and df_fc["Scheduled"].sum() > 0:
                df_fc = df_fc.set_index("Week")
                st.bar_chart(df_fc, color=["#1a6b5a", "#b2dfdb"])
            else:
                st.caption("No installments due in the next 6 weeks from the selected date.")

    st.write("")

    # ── Row 4: Needs your decision ──
    with st.container(border=True):
        st.markdown("### Needs your decision")

        items_shown = 0

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
            items_shown += 1

        # Match review items
        pending_rows = conn.execute(
            "SELECT mr.id, mr.payment_id, mr.confidence, mr.reason, "
            "p.payer_name, p.amount_paid_paise, p.currency, p.method, p.date "
            "FROM match_result mr "
            "JOIN payment_in p ON mr.payment_id = p.id "
            "WHERE mr.status = 'pending_review' AND mr.allocations != '[]' "
            "ORDER BY mr.confidence DESC LIMIT 3"
        ).fetchall()
        for row in pending_rows:
            cols = st.columns([1, 5, 1])
            cols[0].markdown(badge("Match", "teal"), unsafe_allow_html=True)
            cols[1].markdown(
                f"**{fmt_amount(row['amount_paid_paise'], row['currency'])} from "
                f"{row['payer_name'] or '(blank)'}**<br>"
                f'<span style="color:#636e72; font-size:0.85rem;">'
                f"{row['confidence']:.0%} confident"
                f"</span>",
                unsafe_allow_html=True,
            )
            if cols[2].button("Review", key=f"match_{row['id']}"):
                st.switch_page("pages/2_Review_Queue.py")
            st.markdown("---")
            items_shown += 1

        # Overdue reminders
        if overdue_reminders:
            cols = st.columns([1, 5, 1])
            cols[0].markdown(badge("Overdue", "orange"), unsafe_allow_html=True)
            cols[1].markdown(
                f"**{len(overdue_reminders)} installments past due — reminders drafted**<br>"
                f'<span style="color:#636e72; font-size:0.85rem;">'
                f"Total overdue: {fmt_inr(stats['overdue_amount'])}</span>",
                unsafe_allow_html=True,
            )
            if cols[2].button("Read drafts", key="overdue_drafts"):
                st.switch_page("pages/6_Reminders.py")
            items_shown += 1

        if items_shown == 0:
            st.success("Nothing needs your attention right now.")

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
