"""Ask page — chat with the finance copilot."""

import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

import streamlit as st
from app.Home import get_db, fmt_inr
from agents.copilot import ask

st.set_page_config(page_title="Ask | Educore", layout="wide")
st.title("Ask the Finance Copilot")

conn = get_db()

# Chat history
if "messages" not in st.session_state:
    st.session_state.messages = []

# Display chat history
for msg in st.session_state.messages:
    with st.chat_message(msg["role"]):
        st.write(msg["content"])
        if msg.get("transactions"):
            st.dataframe(msg["transactions"], use_container_width=True, hide_index=True)

# Input
if prompt := st.chat_input("Ask a question about finances..."):
    st.session_state.messages.append({"role": "user", "content": prompt})
    with st.chat_message("user"):
        st.write(prompt)

    # Get answer
    result = ask(conn, prompt)

    with st.chat_message("assistant"):
        st.write(result.answer)
        if result.transactions:
            st.dataframe(result.transactions, use_container_width=True, hide_index=True)
        if result.query_used:
            with st.expander("Query used"):
                st.code(result.query_used, language="sql")

    st.session_state.messages.append({
        "role": "assistant",
        "content": result.answer,
        "transactions": result.transactions if result.transactions else None,
    })
