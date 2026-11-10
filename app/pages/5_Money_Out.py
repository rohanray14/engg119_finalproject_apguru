"""Money Out page — spend trends, burn rate, runway projection."""

import sys
from pathlib import Path
from datetime import date, timedelta

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

import streamlit as st
import pandas as pd
from app.Home import get_db
from app.style import apply_theme, badge, metric_subtitle, fmt_inr

st.set_page_config(page_title="Money Out | Educore", page_icon="💰", layout="wide")
apply_theme()

conn = get_db()

with st.sidebar:
    st.markdown("## Educore")
    st.caption("Finance Desk")


# ── Helpers ──────────────────────────────────────────────────────────

def _month_range(d: date):
    first = d.replace(day=1)
    if first.month == 12:
        last = first.replace(year=first.year + 1, month=1, day=1) - timedelta(days=1)
    else:
        last = first.replace(month=first.month + 1, day=1) - timedelta(days=1)
    return first, last


def _add_months(d: date, n: int) -> date:
    month = d.month - 1 + n
    year = d.year + month // 12
    month = month % 12 + 1
    return d.replace(year=year, month=month, day=1)


# ── Load all payment_out data ────────────────────────────────────────

all_rows = conn.execute(
    "SELECT * FROM payment_out ORDER BY date DESC, id DESC"
).fetchall()

if not all_rows:
    st.title("Money out")
    st.info("No outgoing payments recorded yet.")
    st.stop()


# ── Date range ───────────────────────────────────────────────────────

min_date = date.fromisoformat(
    conn.execute("SELECT MIN(date) FROM payment_out").fetchone()[0]
)
max_date = date.fromisoformat(
    conn.execute("SELECT MAX(date) FROM payment_out").fetchone()[0]
)

# Build month options for the slider
_all_months = []
_cursor = min_date.replace(day=1)
_end_month = max_date.replace(day=1)
while _cursor <= _end_month:
    _all_months.append(_cursor)
    _cursor = _add_months(_cursor, 1)

st.title("Money out")
st.caption("Spend trends, burn rate, and runway projections.")

if len(_all_months) > 1:
    range_start, range_end = st.select_slider(
        "Month range",
        options=_all_months,
        value=(_all_months[0], _all_months[-1]),
        format_func=lambda d: d.strftime("%b %Y"),
    )
else:
    range_start = range_end = _all_months[0]

# Effective date window
filter_start = range_start
_, filter_end = _month_range(range_end)

# Filter rows to selected range
all_rows = [r for r in all_rows if filter_start.isoformat() <= r["date"] <= filter_end.isoformat()]

if not all_rows:
    st.info("No payments in the selected range.")
    st.stop()

# ── Build monthly spend by category ─────────────────────────────────

monthly_totals = []  # [{month_label, month_date, cat1, cat2, ..., total}]
cursor = range_start
end = range_end

while cursor <= end:
    m_start, m_end = _month_range(cursor)
    row_data = {"month_label": m_start.strftime("%b %y"), "month_date": m_start, "total": 0}
    cats = conn.execute(
        "SELECT category, SUM(amount_paise) as s FROM payment_out "
        "WHERE date BETWEEN ? AND ? GROUP BY category",
        (m_start.isoformat(), m_end.isoformat()),
    ).fetchall()
    for c in cats:
        row_data[c["category"]] = c["s"]
        row_data["total"] += c["s"]
    monthly_totals.append(row_data)
    cursor = _add_months(cursor, 1)

df_monthly = pd.DataFrame(monthly_totals)

# Months with actual spend (for averages)
active_months = df_monthly[df_monthly["total"] > 0]
num_active = len(active_months)

# ── Headline metrics ─────────────────────────────────────────────────

total_spent = sum(r["amount_paise"] for r in all_rows)
avg_monthly_burn = int(active_months["total"].mean()) if num_active > 0 else 0

# Last full month vs the one before
if num_active >= 2:
    last_month_spend = int(active_months.iloc[-1]["total"])
    prev_month_spend = int(active_months.iloc[-2]["total"])
    mom_delta = ((last_month_spend - prev_month_spend) / prev_month_spend * 100) if prev_month_spend > 0 else 0
elif num_active == 1:
    last_month_spend = int(active_months.iloc[-1]["total"])
    prev_month_spend = 0
    mom_delta = 0
else:
    last_month_spend = 0
    prev_month_spend = 0
    mom_delta = 0

# Compare to money in (within same date range)
total_received = conn.execute(
    "SELECT COALESCE(SUM(amount_paid_paise), 0) FROM payment_in WHERE date BETWEEN ? AND ?",
    (filter_start.isoformat(), filter_end.isoformat()),
).fetchone()[0]
spend_ratio = (total_spent / total_received * 100) if total_received > 0 else 0

st.write("")

# ── Row 1: Key metrics ──────────────────────────────────────────────

col1, col2, col3, col4 = st.columns(4)

with col1:
    st.metric("Total spent (all time)", fmt_inr(total_spent))
    st.markdown(metric_subtitle(f"{len(all_rows)} payments"), unsafe_allow_html=True)
with col2:
    delta_str = f"{mom_delta:+.0f}% MoM" if prev_month_spend > 0 else None
    st.metric("Avg monthly burn", fmt_inr(avg_monthly_burn), delta=delta_str, delta_color="inverse")
with col3:
    st.metric("Last month", fmt_inr(last_month_spend))
    if prev_month_spend > 0:
        st.markdown(metric_subtitle(f"Prior: {fmt_inr(prev_month_spend)}"), unsafe_allow_html=True)
with col4:
    color = "#27ae60" if spend_ratio < 50 else "#e67e22" if spend_ratio < 75 else "#e74c3c"
    st.metric("Spend / Revenue", f"{spend_ratio:.0f}%")
    st.markdown(
        f'<p style="color:{color}; font-size:0.8rem; margin-top:-8px;">'
        f'of {fmt_inr(total_received)} received</p>',
        unsafe_allow_html=True,
    )

st.write("")

# ── Row 2: Spend trend chart + Category breakdown ───────────────────

left, right = st.columns([3, 2])

with left:
    with st.container(border=True):
        st.markdown("### Monthly spend trend")
        st.caption("Month-over-month outflows by category")
        all_cats = [c for c in df_monthly.columns if c not in ("month_label", "month_date", "total")]
        chart_df = df_monthly[["month_label"] + all_cats].copy()
        chart_df = chart_df.set_index("month_label")
        # Convert paise to rupees for readability
        chart_df = chart_df.fillna(0) / 100
        if not chart_df.empty:
            st.bar_chart(chart_df)

with right:
    with st.container(border=True):
        st.markdown("### Spend by category")
        st.caption("All-time breakdown")
        categories = conn.execute(
            "SELECT category, COUNT(*) as count, SUM(amount_paise) as total "
            "FROM payment_out WHERE date BETWEEN ? AND ? GROUP BY category ORDER BY total DESC",
            (filter_start.isoformat(), filter_end.isoformat()),
        ).fetchall()
        for c in categories:
            pct = c["total"] / total_spent * 100 if total_spent > 0 else 0
            cols = st.columns([3, 2, 1])
            cols[0].markdown(f"**{c['category'].title()}**")
            cols[1].markdown(fmt_inr(c["total"]))
            cols[2].markdown(
                f'<span style="color:#636e72; font-size:0.85rem;">{pct:.0f}%</span>',
                unsafe_allow_html=True,
            )
        # Simple bar
        cat_df = pd.DataFrame([{"Category": c["category"].title(), "Amount": c["total"] / 100} for c in categories])
        if not cat_df.empty:
            cat_df = cat_df.set_index("Category")
            st.bar_chart(cat_df, color=["#1a6b5a"])

st.write("")

# ── Row 3: Runway projection ────────────────────────────────────────

with st.container(border=True):
    st.markdown("### Cash runway projection")
    st.caption("Cumulative net position over 12 months under stress scenarios")

    # Monthly inflow data
    inflow_months = []
    cursor = range_start
    while cursor <= end:
        m_start, m_end = _month_range(cursor)
        received = conn.execute(
            "SELECT COALESCE(SUM(amount_paid_paise), 0) FROM payment_in WHERE date BETWEEN ? AND ?",
            (m_start.isoformat(), m_end.isoformat()),
        ).fetchone()[0]
        expected = conn.execute(
            "SELECT COALESCE(SUM(amount_due_paise), 0) FROM installment WHERE due_date BETWEEN ? AND ?",
            (m_start.isoformat(), m_end.isoformat()),
        ).fetchone()[0]
        inflow_months.append({"month_date": m_start, "received": received, "expected": expected})
        cursor = _add_months(cursor, 1)

    df_inflow = pd.DataFrame(inflow_months)
    active_inflow = df_inflow[df_inflow["expected"] > 0]
    avg_monthly_expected = int(active_inflow["expected"].mean()) if len(active_inflow) > 0 else 0
    avg_monthly_received = int(active_inflow["received"].mean()) if len(active_inflow) > 0 else 0
    current_collection_rate = (avg_monthly_received / avg_monthly_expected * 100) if avg_monthly_expected > 0 else 0

    mc1, mc2, mc3 = st.columns(3)
    mc1.metric("Avg monthly expected", fmt_inr(avg_monthly_expected))
    mc2.metric("Avg monthly collected", fmt_inr(avg_monthly_received))
    mc3.metric("Current collection rate", f"{current_collection_rate:.0f}%")

    import altair as alt

    # Project forward 12 months at different collection rates
    scenarios = [
        ("Current rate", current_collection_rate / 100),
        ("10% drop", max(0, current_collection_rate - 10) / 100),
        ("25% drop", max(0, current_collection_rate - 25) / 100),
        ("50% drop", max(0, current_collection_rate - 50) / 100),
    ]

    # Net position = cumulative (inflow - outflow) starting from zero
    projection_rows = []
    last_month = end
    for month_offset in range(1, 13):
        proj_month = _add_months(last_month, month_offset)
        for scenario_name, rate in scenarios:
            monthly_inflow = int(avg_monthly_expected * rate)
            monthly_net = monthly_inflow - avg_monthly_burn
            cumulative = monthly_net * month_offset
            projection_rows.append({
                "Month": proj_month,
                "Scenario": scenario_name,
                "Cumulative": cumulative / 100,  # rupees
            })

    df_proj = pd.DataFrame(projection_rows)

    # Single teal hue, darker = better scenario, lighter = worse
    scenario_names = [s[0] for s in scenarios]
    _opacities = [1.0, 0.65, 0.4, 0.22]
    _dashes = [[0, 0], [6, 3], [4, 4], [2, 2]]

    base = alt.Chart(df_proj).encode(
        x=alt.X("Month:T", title=None, axis=alt.Axis(format="%b %y", labelAngle=-45)),
        y=alt.Y("Cumulative:Q", title="Cumulative net (₹)", axis=alt.Axis(format="~s")),
        detail="Scenario:N",
    )

    lines = alt.layer(*[
        base.transform_filter(
            alt.datum.Scenario == name
        ).mark_line(
            strokeWidth=2.5 if i == 0 else 1.8,
            opacity=_opacities[i],
            strokeDash=_dashes[i],
            color="#1a6b5a",
        )
        for i, name in enumerate(scenario_names)
    ])

    # Nearest-point rule for a single clean tooltip
    nearest = alt.selection_point(
        nearest=True, on="pointerover", fields=["Month"], empty=False,
    )
    points = base.mark_point(opacity=0).encode(
        tooltip=[
            alt.Tooltip("Month:T", title="Month", format="%b %Y"),
            alt.Tooltip("Scenario:N", title="Scenario"),
            alt.Tooltip("Cumulative:Q", title="Net position (₹)", format=",.0f"),
        ],
    ).add_params(nearest)

    rule = base.mark_rule(color="#ccc", strokeWidth=0.5).encode(
        x="Month:T",
    ).transform_filter(nearest)

    chart = (lines + rule + points).properties(height=320).configure_view(
        strokeWidth=0,
    ).configure_axis(
        grid=True, gridColor="#f0f0f0", labelColor="#636e72", titleColor="#636e72",
    )

    st.altair_chart(chart, use_container_width=True)

    # Scenario legend + summary as a compact row
    indicator_cols = st.columns(len(scenarios))
    for idx, (scenario_name, rate) in enumerate(scenarios):
        monthly_inflow = int(avg_monthly_expected * rate)
        monthly_net = monthly_inflow - avg_monthly_burn
        opacity = _opacities[idx]
        dash_label = "━━" if idx == 0 else "╌╌" if idx == 1 else "┄┄" if idx == 2 else "··"
        with indicator_cols[idx]:
            if monthly_net < 0:
                status = f"−{fmt_inr(abs(monthly_net))}/mo deficit"
            elif monthly_net == 0:
                status = "Break-even"
            else:
                status = f"+{fmt_inr(monthly_net)}/mo surplus"
            st.markdown(
                f'<div style="padding:4px 0;">'
                f'<span style="font-size:0.85rem; color:rgba(26,107,90,{opacity}); font-weight:600;">'
                f'{dash_label} {scenario_name}</span><br>'
                f'<span style="font-size:0.78rem; color:#636e72;">{status}</span>'
                f'</div>',
                unsafe_allow_html=True,
            )

st.write("")

# ── Row 4: Detailed table ───────────────────────────────────────────

with st.container(border=True):
    st.markdown("### All outgoing payments")

    col1, col2 = st.columns(2)
    with col1:
        cat_filter = st.selectbox(
            "Category",
            ["All"] + [c["category"] for c in categories],
        )
    with col2:
        curr_filter = st.selectbox("Currency", ["All", "INR", "USD", "AED", "GBP"])

    query = "SELECT * FROM payment_out WHERE date BETWEEN ? AND ?"
    params: list = [filter_start.isoformat(), filter_end.isoformat()]
    if cat_filter != "All":
        query += " AND category = ?"
        params.append(cat_filter)
    if curr_filter != "All":
        query += " AND currency = ?"
        params.append(curr_filter)
    query += " ORDER BY date DESC, id DESC"

    rows = conn.execute(query, params).fetchall()
    st.caption(f"{len(rows)} payments")

    if rows:
        from app.style import fmt_date_display
        data = []
        for r in rows:
            data.append({
                "Date": fmt_date_display(r["date"]),
                "Payee": r["payee"],
                "Category": r["category"].title(),
                "Amount": fmt_inr(r["amount_paise"]),
                "Currency": r["currency"],
            })
        st.dataframe(data, use_container_width=True, hide_index=True)
