"""Simple password-based login gate for Streamlit.

Set FINANCE_DESK_PASSWORD env var to require authentication.
If unset, the app runs without auth (development mode).
"""

import os
import hashlib
import hmac

import streamlit as st


def check_auth() -> bool:
    """Show login form if FINANCE_DESK_PASSWORD is set. Returns True if authed."""
    password = os.environ.get("FINANCE_DESK_PASSWORD")
    if not password:
        return True  # no auth configured

    if st.session_state.get("authenticated"):
        return True

    st.title("Educore Finance Desk")
    st.markdown("Please log in to continue.")

    with st.form("login_form"):
        entered = st.text_input("Password", type="password")
        submitted = st.form_submit_button("Log in")

    if submitted:
        if hmac.compare_digest(entered, password):
            st.session_state["authenticated"] = True
            st.rerun()
        else:
            st.error("Incorrect password.")

    return False
