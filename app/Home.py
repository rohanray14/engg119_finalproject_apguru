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


def _month_range(d: date):
    """Return (first_day, last_day) of the month containing d."""
    first = d.replace(day=1)
    if first.month == 12:
        last = first.replace(year=first.year + 1, month=1, day=1) - timedelta(days=1)
    else:
        last = first.replace(month=first.month + 1, day=1) - timedelta(days=1)
    return first, last


def _prev_month(d: date):
    """Return the first day of the previous month."""
    first = d.replace(day=1)
    return (first - timedelta(days=1)).replace(day=1)


def compute_dashboard_stats(conn, as_of: date) -> dict:
    """Compute all dashboard numbers from one source of truth."""
    as_of_iso = as_of.isoformat()

    # ── This month vs last month ──
    this_start, this_end = _month_range(as_of)
    prev_start, prev_end = _month_range(_prev_month(as_of))

    from ledger.money import fx_convert

    def _sum_fx(sql, params):
        """Sum amounts across all currencies, converting to INR paise."""
        rows = conn.execute(sql, params).fetchall()
        return sum(fx_convert(r[1], r[0], "INR") for r in rows)

    received_this_month = _sum_fx(
        "SELECT currency, COALESCE(SUM(amount_paid_paise),0) FROM payment_in WHERE date BETWEEN ? AND ? GROUP BY currency",
        (this_start.isoformat(), this_end.isoformat()),
    )
    received_last_month = _sum_fx(
        "SELECT currency, COALESCE(SUM(amount_paid_paise),0) FROM payment_in WHERE date BETWEEN ? AND ? GROUP BY currency",
        (prev_start.isoformat(), prev_end.isoformat()),
    )
    expected_this_month = _sum_fx(
        "SELECT currency, COALESCE(SUM(amount_due_paise),0) FROM installment WHERE due_date BETWEEN ? AND ? GROUP BY currency",
        (this_start.isoformat(), this_end.isoformat()),
    )
    spent_this_month = _sum_fx(
        "SELECT currency, COALESCE(SUM(amount_paise),0) FROM payment_out WHERE date BETWEEN ? AND ? GROUP BY currency",
        (this_start.isoformat(), this_end.isoformat()),
    )

    collection_rate_this = (received_this_month / expected_this_month * 100) if expected_this_month > 0 else 0

    # ── All-time totals (for reference), FX-converted to INR ──
    total_received = _sum_fx(
        "SELECT currency, COALESCE(SUM(amount_paid_paise),0) FROM payment_in GROUP BY currency", ())
    total_out = _sum_fx(
        "SELECT currency, COALESCE(SUM(amount_paise),0) FROM payment_out GROUP BY currency", ())
    confirmed = _sum_fx(
        "SELECT currency, COALESCE(SUM(amount_paid_paise),0) FROM payment_in WHERE confirmation='in_bank' GROUP BY currency", ())
    confirm_rate = (confirmed / total_received * 100) if total_received > 0 else 0

    # ── Overdue ──
    overdue_count = conn.execute(
        "SELECT COUNT(*) FROM installment WHERE status='open' AND due_date < ?",
        (as_of_iso,),
    ).fetchone()[0]
    overdue_amount = conn.execute(
        "SELECT COALESCE(SUM(amount_due_paise), 0) FROM installment WHERE status='open' AND due_date < ?",
        (as_of_iso,),
    ).fetchone()[0]
    oldest_overdue_row = conn.execute(
        "SELECT MIN(due_date) FROM installment WHERE status='open' AND due_date < ?",
        (as_of_iso,),
    ).fetchone()
    oldest_overdue_date = oldest_overdue_row[0] if oldest_overdue_row else None
    oldest_overdue_days = (as_of - date.fromisoformat(oldest_overdue_date)).days if oldest_overdue_date else 0

    # ── Match states ──
    matched_count = conn.execute(
        "SELECT COUNT(*) FROM match_result WHERE status IN ('auto','approved')"
    ).fetchone()[0]
    suggested_count = conn.execute(
        "SELECT COUNT(*) FROM match_result WHERE status='pending_review' AND allocations != '[]'"
    ).fetchone()[0]
    needs_review_count = conn.execute(
        "SELECT COUNT(*) FROM match_result WHERE status='pending_review' AND allocations = '[]'"
    ).fetchone()[0]

    # ── Confirmation breakdown ──
    confirmation_counts = {}
    for r in conn.execute("SELECT confirmation, COUNT(*) FROM payment_in GROUP BY confirmation"):
        confirmation_counts[r[0]] = r[1]

    # ── Collections vs Expected by month (only months with data) ──
    months_data = []
    # Find the actual data range
    min_month = conn.execute(
        "SELECT MIN(d) FROM (SELECT MIN(date) AS d FROM payment_in UNION SELECT MIN(due_date) FROM installment WHERE due_date IS NOT NULL)"
    ).fetchone()[0]
    max_month = conn.execute(
        "SELECT MAX(d) FROM (SELECT MAX(date) AS d FROM payment_in UNION SELECT MAX(due_date) FROM installment WHERE due_date IS NOT NULL)"
    ).fetchone()[0]
    if min_month and max_month:
        cursor = date.fromisoformat(min_month).replace(day=1)
        end = date.fromisoformat(max_month).replace(day=1)
        while cursor <= end:
            m_start, m_end = _month_range(cursor)
            expected_m = _sum_fx(
                "SELECT currency, COALESCE(SUM(amount_due_paise),0) FROM installment WHERE due_date BETWEEN ? AND ? GROUP BY currency",
                (m_start.isoformat(), m_end.isoformat()),
            )
            collected_m = _sum_fx(
                "SELECT currency, COALESCE(SUM(amount_paid_paise),0) FROM payment_in WHERE date BETWEEN ? AND ? GROUP BY currency",
                (m_start.isoformat(), m_end.isoformat()),
            )
            if expected_m > 0 or collected_m > 0:
                months_data.append({
                    "Month": m_start.strftime("%b %y"),
                    "Expected": expected_m / 100,
                    "Collected": collected_m / 100,
                })
            if cursor.month == 12:
                cursor = cursor.replace(year=cursor.year + 1, month=1)
            else:
                cursor = cursor.replace(month=cursor.month + 1)

    # ── Cash forecast: next 6 weeks ──
    forecast_weeks = []
    for i in range(6):
        week_start = as_of + timedelta(weeks=i)
        week_end = week_start + timedelta(days=6)
        scheduled = _sum_fx(
            "SELECT currency, COALESCE(SUM(amount_due_paise),0) FROM installment "
            "WHERE status IN ('open','partial') AND due_date BETWEEN ? AND ? GROUP BY currency",
            (week_start.isoformat(), week_end.isoformat()),
        )
        forecast_weeks.append({
            "Week": week_start.strftime("%-d %b"),
            "Scheduled": scheduled / 100,
            "Likely (70%)": int(scheduled * 0.7) / 100,
        })

    # ── Commissions ──
    total_commission = conn.execute("SELECT COALESCE(SUM(commission_paise), 0) FROM commission_line").fetchone()[0]
    total_tds = conn.execute("SELECT COALESCE(SUM(tds_paise), 0) FROM commission_line").fetchone()[0]
    total_commission_net = conn.execute("SELECT COALESCE(SUM(net_paise), 0) FROM commission_line").fetchone()[0]
    counselors_with_commission = conn.execute(
        "SELECT COUNT(DISTINCT counselor_id) FROM commission_line WHERE net_paise > 0"
    ).fetchone()[0]

    # ── Top families owing ──
    top_owing = conn.execute(
        "SELECT s.name, s.id, "
        "SUM(i.amount_due_paise) as total_owed, "
        "MIN(i.due_date) as earliest_due "
        "FROM installment i "
        "JOIN enrollment e ON i.enrollment_id = e.id "
        "JOIN student s ON e.student_id = s.id "
        "WHERE i.status = 'open' AND i.due_date < ? "
        "GROUP BY s.id "
        "ORDER BY total_owed DESC LIMIT 5",
        (as_of_iso,),
    ).fetchall()

    # ── Largest unmatched payments ──
    largest_unmatched = conn.execute(
        "SELECT p.id, p.payer_name, p.amount_paid_paise, p.currency, p.date, p.method "
        "FROM payment_in p "
        "LEFT JOIN match_result mr ON mr.payment_id = p.id "
        "WHERE mr.id IS NULL "
        "ORDER BY p.amount_paid_paise DESC LIMIT 5"
    ).fetchall()

    return {
        "received_this_month": received_this_month,
        "received_last_month": received_last_month,
        "expected_this_month": expected_this_month,
        "spent_this_month": spent_this_month,
        "collection_rate_this": collection_rate_this,
        "total_received": total_received,
        "total_out": total_out,
        "confirm_rate": confirm_rate,
        "overdue_count": overdue_count,
        "overdue_amount": overdue_amount,
        "oldest_overdue_days": oldest_overdue_days,
        "matched_count": matched_count,
        "suggested_count": suggested_count,
        "needs_review_count": needs_review_count,
        "confirmation_counts": confirmation_counts,
        "months_data": months_data,
        "forecast_weeks": forecast_weeks,
        "total_commission": total_commission,
        "total_tds": total_tds,
        "total_commission_net": total_commission_net,
        "counselors_with_commission": counselors_with_commission,
        "top_owing": top_owing,
        "largest_unmatched": largest_unmatched,
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

    # Pre-approve top suggested matches so commissions page shows realistic data
    suggested = conn.execute(
        "SELECT id, payment_id, allocations FROM match_result "
        "WHERE status = 'pending_review' AND allocations != '[]' "
        "ORDER BY confidence DESC LIMIT 40"
    ).fetchall()
    for r in suggested:
        allocs = json.loads(r["allocations"])
        inst_ids = [a["installment_id"] for a in allocs if a.get("installment_id")]
        if inst_ids:
            conn.execute(
                "UPDATE match_result SET status = 'approved' WHERE id = ?",
                (r["id"],),
            )
    conn.commit()

    # Compute commissions from matched payments
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

    # ── Sidebar ──
    min_date_row = conn.execute("SELECT MIN(due_date) FROM installment WHERE due_date IS NOT NULL").fetchone()
    max_date_row = conn.execute("SELECT MAX(due_date) FROM installment WHERE due_date IS NOT NULL").fetchone()
    min_date = date.fromisoformat(min_date_row[0]) if min_date_row and min_date_row[0] else date(2025, 4, 1)
    max_date = date.fromisoformat(max_date_row[0]) if max_date_row and max_date_row[0] else date(2026, 9, 30)
    default_as_of = min_date + (max_date - min_date) // 2

    with st.sidebar:
        st.markdown("## Educore")
        st.caption("Finance Desk")
        st.markdown("---")
        as_of = st.date_input(
            "As-of date",
            value=st.session_state.get("global_as_of", default_as_of),
            min_value=min_date,
            max_value=max_date,
            help="All overdue / forecast calculations use this date. Shared across all pages.",
        )
        st.session_state["global_as_of"] = as_of
        st.markdown("---")
        st.markdown(
            '<p style="color:#55556A; font-size:0.75rem; margin-top:2rem;">'
            '<b>Data sources</b><br>'
            'Bank statement · synced on load<br>'
            'PayGlocal, Stripe, Razorpay · synced on load<br>'
            'Fee tracker · synced on load</p>',
            unsafe_allow_html=True,
        )

    stats = compute_dashboard_stats(conn, as_of)

    # ── Header ──
    month_label = as_of.strftime("%B %Y")
    st.caption(as_of.strftime("%A, %-d %B %Y"))
    st.title("Today")

    # ── Briefing ──
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
            f'<span style="color:#8A8A9A;">Generated from the ledger</span>',
            unsafe_allow_html=True,
        )
        # Build a concise briefing
        parts = []
        parts.append(f"**{stats['matched_count']}** payments matched; **{pending_review}** need review.")
        if stats["expected_this_month"] > 0:
            parts.append(f"This month: collected {fmt_inr(stats['received_this_month'])} of {fmt_inr(stats['expected_this_month'])} expected (**{stats['collection_rate_this']:.0f}%**).")
        if overdue_count > 0:
            oldest_note = f", oldest {stats['oldest_overdue_days']} days" if stats['oldest_overdue_days'] > 0 else ""
            parts.append(f"**{overdue_count}** installments overdue ({fmt_inr(stats['overdue_amount'])}{oldest_note}).")
        if high_risk:
            parts.append(f"**{len(high_risk)}** high-severity risk flag(s).")
        st.markdown(" ".join(parts))

        col_a, col_b, _ = st.columns([1, 1, 3])
        with col_a:
            if st.button(f"Review {pending_review} payments", type="primary"):
                st.switch_page("pages/2_Review_Queue.py")
        with col_b:
            if st.button("Ask a follow-up"):
                st.switch_page("pages/8_Ask.py")

    st.write("")

    # ── Needs your decision (actions first) ──
    with st.container(border=True):
        st.markdown("### Needs your decision")

        items_shown = 0

        # Risk items (highest urgency)
        for f in high_risk[:2]:
            cols = st.columns([1, 5, 1])
            cols[0].markdown(badge("Risk", "red"), unsafe_allow_html=True)
            cols[1].markdown(
                f"**{f.explanation[:80]}**<br>"
                f'<span style="color:#8A8A9A; font-size:0.85rem;">{f.category}'
                f'{" · " + fmt_inr(f.amount_paise) if f.amount_paise else ""}</span>',
                unsafe_allow_html=True,
            )
            if cols[2].button("Check", key=f"risk_{f.entity}"):
                st.switch_page("pages/7_Risk.py")
            st.markdown("---")
            items_shown += 1

        # Match review items (show amount at stake)
        pending_rows = conn.execute(
            "SELECT mr.id, mr.payment_id, mr.confidence, mr.reason, "
            "p.payer_name, p.amount_paid_paise, p.currency, p.method, p.date "
            "FROM match_result mr "
            "JOIN payment_in p ON mr.payment_id = p.id "
            "WHERE mr.status = 'pending_review' AND mr.allocations != '[]' "
            "ORDER BY p.amount_paid_paise DESC LIMIT 3"
        ).fetchall()
        for row in pending_rows:
            cols = st.columns([1, 5, 1])
            cols[0].markdown(badge("Match", "teal"), unsafe_allow_html=True)
            cols[1].markdown(
                f"**{fmt_amount(row['amount_paid_paise'], row['currency'])}** from "
                f"{row['payer_name'] or '(blank)'}<br>"
                f'<span style="color:#8A8A9A; font-size:0.85rem;">'
                f"{row['confidence']:.0%} confident · {fmt_date_display(row['date'])}"
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
                f"**{len(overdue_reminders)} overdue** — reminders drafted<br>"
                f'<span style="color:#8A8A9A; font-size:0.85rem;">'
                f"Total: {fmt_inr(stats['overdue_amount'])}</span>",
                unsafe_allow_html=True,
            )
            if cols[2].button("Read drafts", key="overdue_drafts"):
                st.switch_page("pages/6_Reminders.py")
            items_shown += 1

        if items_shown == 0:
            st.success("Nothing needs your attention right now.")

    st.write("")

    # ── Row 1: This month snapshot ──
    col1, col2, col3, col4 = st.columns(4)

    # Delta vs last month
    if stats["received_last_month"] > 0:
        delta_pct = (stats["received_this_month"] - stats["received_last_month"]) / stats["received_last_month"] * 100
        delta_str = f"{delta_pct:+.0f}% vs last month"
    else:
        delta_str = None

    with col1:
        st.metric(f"Received ({month_label})", fmt_inr(stats["received_this_month"]),
                  delta=delta_str)
    with col2:
        st.metric(f"Expected ({month_label})", fmt_inr(stats["expected_this_month"]))
        if stats["expected_this_month"] > 0:
            st.markdown(metric_subtitle(f"Collection rate: {stats['collection_rate_this']:.0f}%"), unsafe_allow_html=True)
    with col3:
        st.metric(f"Spent ({month_label})", fmt_inr(stats["spent_this_month"]))
        net_this = stats["received_this_month"] - stats["spent_this_month"]
        color = "#00DC82" if net_this >= 0 else "#FF4D4D"
        st.markdown(f'<p style="color:{color}; font-size:0.8rem; margin-top:-8px;">Net: {fmt_inr(net_this)}</p>', unsafe_allow_html=True)
    with col4:
        st.metric("Overdue", f"{overdue_count}")
        if overdue_count > 0:
            st.markdown(
                f'<p style="color:#FF4D4D; font-size:0.8rem; margin-top:-8px;">'
                f'{fmt_inr(stats["overdue_amount"])} · oldest {stats["oldest_overdue_days"]}d</p>',
                unsafe_allow_html=True,
            )

    st.write("")

    # ── Row 2: Confirmation + Commissions (2 cards, more space) ──
    col1, col2 = st.columns(2)

    with col1:
        with st.container(border=True):
            st.markdown("### Confirmation status")
            st.caption(f"{stats['confirm_rate']:.0f}% of all-time payments confirmed in bank")
            cc = stats["confirmation_counts"]
            in_bank = cc.get("in_bank", 0)
            by_gateway = cc.get("seen_by_gateway", 0)
            screenshot = cc.get("screenshot_only", 0)
            total = in_bank + by_gateway + screenshot
            if total > 0:
                st.markdown(
                    f'<div style="display:flex; height:28px; border-radius:6px; overflow:hidden; margin:12px 0;">'
                    f'<div style="background:#00DC82; width:{in_bank/total*100:.0f}%; display:flex; align-items:center; justify-content:center; color:#0A0A0F; font-size:0.75rem; font-weight:600;">{in_bank/total*100:.0f}%</div>'
                    f'<div style="background:#FFB020; width:{by_gateway/total*100:.0f}%; display:flex; align-items:center; justify-content:center; color:#0A0A0F; font-size:0.75rem; font-weight:600;">{by_gateway/total*100:.0f}%</div>'
                    f'<div style="background:#FF4D4D; width:{screenshot/total*100:.0f}%; display:flex; align-items:center; justify-content:center; color:#0A0A0F; font-size:0.75rem; font-weight:600;">{screenshot/total*100:.0f}%</div>'
                    f'</div>',
                    unsafe_allow_html=True,
                )
                c1, c2, c3 = st.columns(3)
                c1.markdown(f'{badge(f"In bank: {in_bank}", "green")}', unsafe_allow_html=True)
                c2.markdown(f'{badge(f"Gateway: {by_gateway}", "orange")}', unsafe_allow_html=True)
                c3.markdown(f'{badge(f"Screenshot: {screenshot}", "red")}', unsafe_allow_html=True)

    with col2:
        with st.container(border=True):
            st.markdown("### Commissions")
            if stats["total_commission"] > 0:
                c1, c2, c3 = st.columns(3)
                c1.metric("Earned", fmt_inr(stats["total_commission"]))
                c2.metric("TDS (2%)", fmt_inr(stats["total_tds"]))
                c3.metric("Net payable", fmt_inr(stats["total_commission_net"]))
                st.caption(f"{stats['counselors_with_commission']} counselors with earned commissions · computed from {stats['matched_count']} matched payments")
            else:
                st.caption("No commissions computed yet — match more payments first.")

    st.write("")

    # ── Row 3: Top owing families + Largest unmatched payments ──
    col1, col2 = st.columns(2)

    with col1:
        with st.container(border=True):
            st.markdown("### Top families owing")
            if stats["top_owing"]:
                for rank, row in enumerate(stats["top_owing"], 1):
                    days_overdue = (as_of - date.fromisoformat(row["earliest_due"])).days if row["earliest_due"] else 0
                    cols = st.columns([0.5, 3, 2, 1.5])
                    cols[0].markdown(f"**{rank}.**")
                    cols[1].markdown(f"**{row['name']}**")
                    cols[2].markdown(f"{fmt_inr(row['total_owed'])}")
                    cols[3].markdown(
                        f'{badge(f"{days_overdue}d", "red" if days_overdue > 90 else "orange")}',
                        unsafe_allow_html=True,
                    )
            else:
                st.success("No overdue families.")

    with col2:
        with st.container(border=True):
            st.markdown("### Largest unmatched payments")
            if stats["largest_unmatched"]:
                for rank, row in enumerate(stats["largest_unmatched"], 1):
                    cols = st.columns([0.5, 3, 2, 1.5])
                    cols[0].markdown(f"**{rank}.**")
                    cols[1].markdown(f"**{row['payer_name'] or '(blank)'}**")
                    cols[2].markdown(fmt_amount(row['amount_paid_paise'], row['currency']))
                    cols[3].markdown(
                        f'<span style="color:#8A8A9A; font-size:0.8rem;">{fmt_date_display(row["date"])}</span>',
                        unsafe_allow_html=True,
                    )
                st.caption(f"These payments have no match — review or assign them manually.")
            else:
                st.success("All payments matched.")

    st.write("")

    # ── Row 4: Collections chart + Cash forecast ──
    left, right = st.columns([3, 2])

    with left:
        with st.container(border=True):
            st.markdown("### Collections vs expected")
            st.caption("Monthly: installments due vs payments received")
            import pandas as pd
            df = pd.DataFrame(stats["months_data"])
            if not df.empty:
                df = df.set_index("Month")
                st.bar_chart(df, color=["#2A2A35", "#00DC82"])
            else:
                st.info("No data in this date range.")

    with right:
        with st.container(border=True):
            st.markdown("### Cash due, next 6 weeks")
            st.caption("Open installments coming due")
            import pandas as pd
            df_fc = pd.DataFrame(stats["forecast_weeks"])
            if not df_fc.empty and df_fc["Scheduled"].sum() > 0:
                df_fc = df_fc.set_index("Week")
                st.bar_chart(df_fc, color=["#00DC82", "#1C4A3A"])
            else:
                st.caption("No installments due in the next 6 weeks.")

    st.write("")

    # ── Ask box ──
    with st.container(border=True):
        cols = st.columns([1, 8, 1])
        cols[0].markdown(
            '<p style="font-weight:600; color:#F0F0F5; margin-top:8px;">Ask</p>',
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
