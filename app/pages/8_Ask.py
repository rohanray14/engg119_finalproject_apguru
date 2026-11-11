"""Ask — chat with the finance copilot."""

import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

import streamlit as st
from app.Home import get_db
from app.style import apply_theme, fmt_inr
from agents.copilot import ask

st.set_page_config(page_title="Ask | Educore", page_icon="💰", layout="wide")
apply_theme()

conn = get_db()

with st.sidebar:
    st.markdown("## Educore")
    st.caption("Finance Desk")

st.title("Ask")

# Chat history
if "messages" not in st.session_state:
    st.session_state.messages = []

# Display chat history
for msg in st.session_state.messages:
    if msg["role"] == "user":
        st.markdown(
            f'<div style="background:#1C1C24; color:#F0F0F5; padding:12px 20px; '
            f'border-radius:12px; margin:8px 0; max-width:70%; margin-left:auto; '
            f'text-align:right;">{msg["content"]}</div>',
            unsafe_allow_html=True,
        )
    else:
        with st.container(border=True):
            st.markdown(msg["content"])
            if msg.get("transactions"):
                st.dataframe(msg["transactions"], use_container_width=True, hide_index=True)
            if msg.get("explanation"):
                with st.expander("How this was worked out"):
                    st.caption(msg["explanation"])

# Suggested questions (only show if no messages yet)
if not st.session_state.messages:
    st.write("")
    st.caption("Try asking")
    suggestions = [
        "Which families still owe us?",
        "How much did we receive this month?",
        "What is our cash position?",
        "Who are the largest payers?",
        "How many installments are overdue?",
    ]
    cols = st.columns(len(suggestions))
    for i, suggestion in enumerate(suggestions):
        if cols[i].button(suggestion, key=f"suggest_{i}"):
            st.session_state.messages.append({"role": "user", "content": suggestion})
            result = ask(conn, suggestion)
            st.session_state.messages.append({
                "role": "assistant",
                "content": result.answer,
                "transactions": result.transactions if result.transactions else None,
                "explanation": result.query_used if result.query_used else None,
            })
            st.rerun()

    st.write("")
    st.markdown("#### Additional insights we're working on")
    st.caption("These deeper analyses are on the roadmap:")
    insight_suggestions = [
        "Which program is most profitable?",
        "Which region brings in the most revenue?",
        "What are the upcoming payments in December?",
        "Is SAT enrollment tied to news or trends?",
        "Are enrollments seasonal? Which months peak?",
        "Approximate spend and comparison across gateways",
    ]
    insight_cols = st.columns(3)
    for i, insight in enumerate(insight_suggestions):
        col_idx = i % 3
        if insight_cols[col_idx].button(insight, key=f"insight_{i}"):
            st.session_state.messages.append({"role": "user", "content": insight})
            result = ask(conn, insight)
            st.session_state.messages.append({
                "role": "assistant",
                "content": result.answer,
                "transactions": result.transactions if result.transactions else None,
                "explanation": result.query_used if result.query_used else None,
            })
            st.rerun()

# Input
st.write("")
cols = st.columns([8, 1])
question = cols[0].text_input(
    "Ask",
    placeholder="Ask about payments, families, commissions...",
    label_visibility="collapsed",
)
if cols[1].button("Ask", type="primary", key="ask_main"):
    if question:
        st.session_state.messages.append({"role": "user", "content": question})

        result = ask(conn, question)

        st.session_state.messages.append({
            "role": "assistant",
            "content": result.answer,
            "transactions": result.transactions if result.transactions else None,
            "explanation": result.query_used if result.query_used else None,
        })
        st.rerun()
