"""Shared styling and helpers for the Educore Finance Desk UI."""

import streamlit as st

# ---------------------------------------------------------------------------
# Theme CSS — matches the PDF design (dark sidebar, clean cards, pro typography)
# ---------------------------------------------------------------------------

THEME_CSS = """
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600;700&display=swap');

/* ── Dark theme palette ──
   --bg:             #0A0A0F   (page)
   --surface:        #141419   (cards)
   --surface-hover:  #1C1C24
   --sidebar:        #0E0E14
   --border:         #2A2A35
   --border-subtle:  #1E1E28
   --text:           #F0F0F5
   --text-secondary: #8A8A9A
   --text-tertiary:  #55556A
   --accent:         #00DC82   (Robinhood green)
   --danger:         #FF4D4D
   --warning:        #FFB020
   --info:           #4D9EFF
*/

/* ── Global font ── */
html, body, [class*="st-"] {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif !important;
}

/* ── Sidebar ── */
section[data-testid="stSidebar"] {
    background-color: #0E0E14;
    border-right: 1px solid #1E1E28;
}
section[data-testid="stSidebar"] .stMarkdown p,
section[data-testid="stSidebar"] .stMarkdown h1,
section[data-testid="stSidebar"] .stMarkdown h2,
section[data-testid="stSidebar"] .stMarkdown h3,
section[data-testid="stSidebar"] label,
section[data-testid="stSidebar"] span {
    color: #8A8A9A !important;
}
section[data-testid="stSidebar"] a {
    color: #F0F0F5 !important;
}
section[data-testid="stSidebar"] .stSelectbox label,
section[data-testid="stSidebar"] .stDateInput label {
    color: #55556A !important;
}
/* Sidebar active page link */
section[data-testid="stSidebar"] a[aria-current="page"] {
    background-color: rgba(0, 220, 130, 0.08) !important;
    color: #00DC82 !important;
}
section[data-testid="stSidebar"] a[aria-current="page"] span {
    color: #00DC82 !important;
}
/* Sidebar input backgrounds */
section[data-testid="stSidebar"] input,
section[data-testid="stSidebar"] [data-baseweb="input"],
section[data-testid="stSidebar"] [data-baseweb="select"] {
    background-color: #141419 !important;
    border-color: #2A2A35 !important;
    color: #F0F0F5 !important;
}

/* ── Page background ── */
.stApp {
    background-color: #0A0A0F;
    color: #F0F0F5;
}
.main .block-container {
    max-width: 1200px;
    padding-top: 2rem;
}

/* ── All text defaults to light ── */
.stMarkdown, .stMarkdown p, .stMarkdown li, .stCaption, p, span, label {
    color: #F0F0F5 !important;
}
.stCaption, .stMarkdown .caption {
    color: #55556A !important;
}

/* ── Metric cards ── */
div[data-testid="stMetric"] {
    background: #141419;
    border: 1px solid #2A2A35;
    border-radius: 12px;
    padding: 20px 24px;
}
div[data-testid="stMetric"] label {
    color: #55556A !important;
    font-size: 0.85rem !important;
    font-weight: 500 !important;
    letter-spacing: 0.04em;
    text-transform: uppercase;
}
div[data-testid="stMetric"] div[data-testid="stMetricValue"] {
    color: #F0F0F5 !important;
    font-family: 'JetBrains Mono', monospace !important;
    font-size: 1.8rem !important;
    font-weight: 700 !important;
}
/* Green delta (positive) */
div[data-testid="stMetric"] div[data-testid="stMetricDelta"] svg {
    fill: #00DC82;
}
div[data-testid="stMetric"] div[data-testid="stMetricDelta"] div {
    color: #00DC82 !important;
}

/* ── Cards (containers with border) ── */
div[data-testid="stVerticalBlock"] > div[data-testid="stVerticalBlockBorderWrapper"] {
    background: #141419;
    border: 1px solid #2A2A35;
    border-radius: 12px;
}

/* ── Buttons ── */
.stButton > button[kind="primary"],
.stButton > button[data-testid="stBaseButton-primary"] {
    background-color: #00DC82;
    color: #0A0A0F !important;
    border: none;
    border-radius: 8px;
    padding: 0.5rem 1.5rem;
    font-weight: 600;
}
.stButton > button[kind="primary"]:hover,
.stButton > button[data-testid="stBaseButton-primary"]:hover {
    background-color: #00C472;
    color: #0A0A0F !important;
}
.stButton > button[kind="secondary"],
.stButton > button[data-testid="stBaseButton-secondary"] {
    background-color: #141419;
    border: 1px solid #2A2A35;
    border-radius: 8px;
    color: #8A8A9A !important;
    font-weight: 500;
}
.stButton > button[kind="secondary"]:hover,
.stButton > button[data-testid="stBaseButton-secondary"]:hover {
    background-color: #1C1C24;
    border-color: #3A3A45;
    color: #F0F0F5 !important;
}

/* ── Expanders ── */
details {
    background: #141419;
    border: 1px solid #2A2A35;
    border-radius: 12px !important;
}
details summary {
    color: #F0F0F5 !important;
}

/* ── Dataframes ── */
.stDataFrame {
    border-radius: 8px;
    overflow: hidden;
}
/* Dark dataframe cells */
.stDataFrame [data-testid="StyledDataFrameDataCell"],
.stDataFrame [data-testid="StyledDataFrameHeaderCell"] {
    background-color: #141419 !important;
    color: #F0F0F5 !important;
    border-color: #1E1E28 !important;
}

/* ── Tabs ── */
.stTabs [data-baseweb="tab-list"] {
    gap: 8px;
    border-bottom-color: #1E1E28;
}
.stTabs [data-baseweb="tab"] {
    border-radius: 8px 8px 0 0;
    padding: 8px 20px;
    color: #8A8A9A;
}
.stTabs [aria-selected="true"] {
    color: #00DC82 !important;
    border-bottom-color: #00DC82 !important;
}

/* ── Chat messages ── */
div[data-testid="stChatMessage"] {
    background: #141419;
    border: 1px solid #2A2A35;
    border-radius: 12px;
    padding: 16px;
}

/* ── Text inputs ── */
.stTextInput input, .stTextArea textarea {
    background-color: #141419 !important;
    border: 1px solid #2A2A35 !important;
    color: #F0F0F5 !important;
    border-radius: 8px !important;
}
.stTextInput input:focus, .stTextArea textarea:focus {
    border-color: #00DC82 !important;
    box-shadow: 0 0 0 1px rgba(0, 220, 130, 0.2) !important;
}
.stTextInput input::placeholder, .stTextArea textarea::placeholder {
    color: #3A3A4A !important;
}

/* ── Select boxes ── */
[data-baseweb="select"] {
    background-color: #141419 !important;
}
[data-baseweb="select"] > div {
    background-color: #141419 !important;
    border-color: #2A2A35 !important;
    color: #F0F0F5 !important;
}
[data-baseweb="popover"] {
    background-color: #141419 !important;
    border: 1px solid #2A2A35 !important;
}
[data-baseweb="menu"] {
    background-color: #141419 !important;
}
[data-baseweb="menu"] li {
    color: #F0F0F5 !important;
}
[data-baseweb="menu"] li:hover {
    background-color: #1C1C24 !important;
}

/* ── Date input ── */
.stDateInput input {
    background-color: #141419 !important;
    border-color: #2A2A35 !important;
    color: #F0F0F5 !important;
}

/* ── Dividers ── */
hr {
    border-color: #1E1E28 !important;
}

/* ── Page title ── */
h1 {
    color: #F0F0F5 !important;
    font-weight: 700 !important;
}
h2, h3 {
    color: #F0F0F5 !important;
    font-weight: 600 !important;
}

/* ── Bar chart colors ── */
.stBarChart {
    background: transparent;
}

/* ── Success/info/warning/error alerts ── */
.stAlert {
    background-color: #141419 !important;
    border: 1px solid #2A2A35 !important;
    color: #F0F0F5 !important;
}

/* ── Scrollbar styling ── */
::-webkit-scrollbar {
    width: 6px;
    height: 6px;
}
::-webkit-scrollbar-track {
    background: #0A0A0F;
}
::-webkit-scrollbar-thumb {
    background: #2A2A35;
    border-radius: 3px;
}
::-webkit-scrollbar-thumb:hover {
    background: #3A3A45;
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
        "teal": ("#00DC82", "rgba(0,220,130,0.12)"),
        "red": ("#FF4D4D", "rgba(255,77,77,0.12)"),
        "orange": ("#FFB020", "rgba(255,176,32,0.12)"),
        "green": ("#00DC82", "rgba(0,220,130,0.12)"),
        "blue": ("#4D9EFF", "rgba(77,158,255,0.12)"),
        "gray": ("#8A8A9A", "rgba(138,138,154,0.12)"),
    }
    fg, bg = colors.get(color, colors["gray"])
    return (
        f'<span style="background:{bg}; color:{fg}; padding:4px 12px; '
        f'border-radius:6px; font-size:0.8rem; font-weight:600; '
        f'letter-spacing:0.03em;">{text}</span>'
    )


def metric_subtitle(text: str) -> str:
    """Small gray subtitle text for under metrics."""
    return f'<p style="color:#55556A; font-size:0.8rem; margin-top:-8px;">{text}</p>'


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
