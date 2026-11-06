"""Shared styling and helpers for the Educore Finance Desk UI."""

import streamlit as st

# ---------------------------------------------------------------------------
# Theme CSS — matches the PDF design (dark sidebar, clean cards, pro typography)
# ---------------------------------------------------------------------------

THEME_CSS = """
<style>
/* ── Sidebar ── */
section[data-testid="stSidebar"] {
    background-color: #1a2332;
    color: #ffffff;
}
section[data-testid="stSidebar"] .stMarkdown p,
section[data-testid="stSidebar"] .stMarkdown h1,
section[data-testid="stSidebar"] .stMarkdown h2,
section[data-testid="stSidebar"] .stMarkdown h3,
section[data-testid="stSidebar"] label,
section[data-testid="stSidebar"] span {
    color: #c8d6e5 !important;
}
section[data-testid="stSidebar"] a {
    color: #f5f6fa !important;
}
section[data-testid="stSidebar"] .stSelectbox label,
section[data-testid="stSidebar"] .stDateInput label {
    color: #8395a7 !important;
}

/* ── Page background ── */
.stApp {
    background-color: #f0f2f5;
}
.main .block-container {
    max-width: 1200px;
    padding-top: 2rem;
}

/* ── Metric cards ── */
div[data-testid="stMetric"] {
    background: #ffffff;
    border: 1px solid #e8ecef;
    border-radius: 12px;
    padding: 20px 24px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.04);
}
div[data-testid="stMetric"] label {
    color: #636e72 !important;
    font-size: 0.85rem !important;
    font-weight: 500 !important;
    letter-spacing: 0.02em;
}
div[data-testid="stMetric"] div[data-testid="stMetricValue"] {
    color: #1a2332 !important;
    font-size: 1.8rem !important;
    font-weight: 700 !important;
}

/* ── Cards (containers with border) ── */
div[data-testid="stVerticalBlock"] > div[data-testid="stVerticalBlockBorderWrapper"] {
    background: #ffffff;
    border: 1px solid #e8ecef;
    border-radius: 12px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.04);
}

/* ── Buttons ── */
.stButton > button[kind="primary"],
.stButton > button[data-testid="stBaseButton-primary"] {
    background-color: #1a6b5a;
    border: none;
    border-radius: 8px;
    padding: 0.5rem 1.5rem;
    font-weight: 600;
}
.stButton > button[kind="secondary"],
.stButton > button[data-testid="stBaseButton-secondary"] {
    background-color: #ffffff;
    border: 1px solid #dfe6e9;
    border-radius: 8px;
    color: #2d3436;
    font-weight: 500;
}

/* ── Expanders ── */
details {
    background: #ffffff;
    border: 1px solid #e8ecef;
    border-radius: 12px !important;
}

/* ── Dataframes ── */
.stDataFrame {
    border-radius: 8px;
    overflow: hidden;
}

/* ── Tabs ── */
.stTabs [data-baseweb="tab-list"] {
    gap: 8px;
}
.stTabs [data-baseweb="tab"] {
    border-radius: 8px 8px 0 0;
    padding: 8px 20px;
}

/* ── Chat messages ── */
div[data-testid="stChatMessage"] {
    background: #ffffff;
    border: 1px solid #e8ecef;
    border-radius: 12px;
    padding: 16px;
}

/* ── Page title ── */
h1 {
    color: #1a2332 !important;
    font-weight: 700 !important;
}
h2, h3 {
    color: #2d3436 !important;
    font-weight: 600 !important;
}

/* ── Hide default Streamlit branding ── */
#MainMenu {visibility: hidden;}
footer {visibility: hidden;}
header {visibility: hidden;}
</style>
"""


def apply_theme():
    """Inject the theme CSS into the page."""
    st.markdown(THEME_CSS, unsafe_allow_html=True)


# ---------------------------------------------------------------------------
# Badge helpers (colored labels like the PDF design)
# ---------------------------------------------------------------------------

def badge(text: str, color: str = "teal") -> str:
    """Return HTML for a colored badge."""
    colors = {
        "teal": ("#1a6b5a", "#e6f5f0"),
        "red": ("#c0392b", "#fde8e8"),
        "orange": ("#e67e22", "#fef3e2"),
        "green": ("#27ae60", "#e8f8ef"),
        "blue": ("#2980b9", "#e8f0fe"),
        "gray": ("#636e72", "#f0f2f5"),
    }
    fg, bg = colors.get(color, colors["gray"])
    return (
        f'<span style="background:{bg}; color:{fg}; padding:4px 12px; '
        f'border-radius:6px; font-size:0.8rem; font-weight:600; '
        f'letter-spacing:0.03em;">{text}</span>'
    )


def metric_subtitle(text: str) -> str:
    """Small gray subtitle text for under metrics."""
    return f'<p style="color:#636e72; font-size:0.8rem; margin-top:-8px;">{text}</p>'


# ---------------------------------------------------------------------------
# Formatting helpers
# ---------------------------------------------------------------------------

def fmt_inr(paise: int) -> str:
    """Format paise as ₹X,XX,XXX."""
    rupees = paise / 100
    if rupees >= 10_000_000:
        return f"₹{rupees / 10_000_000:.2f} Cr"
    if rupees >= 100_000:
        return f"₹{rupees / 100_000:.2f} L"
    if rupees != int(rupees):
        return f"₹{rupees:,.2f}"
    return f"₹{int(rupees):,}"


def fmt_amount(paise: int, currency: str) -> str:
    """Format paise with currency."""
    if currency == "INR":
        return fmt_inr(paise)
    return f"{currency} {paise / 100:,.2f}"


def fmt_date_display(iso_date: str | None) -> str:
    """Convert ISO date to display format like '12 Oct 2025'."""
    if not iso_date:
        return "—"
    try:
        from datetime import date
        d = date.fromisoformat(iso_date)
        return d.strftime("%-d %b %Y")
    except (ValueError, TypeError):
        return iso_date
