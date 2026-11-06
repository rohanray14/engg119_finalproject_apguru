"""Tests for the copilot agent."""

import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from ledger.load import load_all
from agents.copilot import ask, CopilotAnswer


DATA_DIR = PROJECT_ROOT / "data"


def _get_conn():
    return load_all(data_dir=DATA_DIR, db_path=":memory:")


class TestCopilotQuestions:
    def test_total_received(self):
        conn = _get_conn()
        ans = ask(conn, "How much have we received in total?")
        assert isinstance(ans, CopilotAnswer)
        assert "Total received" in ans.answer
        assert ans.confidence > 0
        conn.close()

    def test_total_paid_out(self):
        conn = _get_conn()
        ans = ask(conn, "How much have we paid out?")
        assert "paid out" in ans.answer.lower() or "Total" in ans.answer
        conn.close()

    def test_count_payments(self):
        conn = _get_conn()
        ans = ask(conn, "How many payments have we received?")
        assert "payment" in ans.answer.lower()
        conn.close()

    def test_count_students(self):
        conn = _get_conn()
        ans = ask(conn, "How many students do we have?")
        assert "student" in ans.answer.lower()
        conn.close()

    def test_overdue(self):
        conn = _get_conn()
        ans = ask(conn, "How many installments are overdue?")
        assert "overdue" in ans.answer.lower()
        conn.close()

    def test_who_owes(self):
        conn = _get_conn()
        ans = ask(conn, "Who owes us the most?")
        assert ans.confidence > 0
        conn.close()

    def test_largest_payments(self):
        conn = _get_conn()
        ans = ask(conn, "Which payments are the largest?")
        assert "Largest" in ans.answer or "payment" in ans.answer.lower()
        conn.close()

    def test_unmatched(self):
        conn = _get_conn()
        ans = ask(conn, "Show me unmatched payments")
        assert "unmatched" in ans.answer.lower()
        conn.close()

    def test_cash_position(self):
        conn = _get_conn()
        ans = ask(conn, "What is our cash position?")
        assert "Inflow" in ans.answer or "Net" in ans.answer
        conn.close()

    def test_expense_breakdown(self):
        conn = _get_conn()
        ans = ask(conn, "Show breakdown by category")
        assert ans.confidence > 0
        conn.close()

    def test_unknown_question(self):
        conn = _get_conn()
        ans = ask(conn, "What is the meaning of life?")
        assert ans.confidence == 0.0
        assert "not sure" in ans.answer.lower()
        conn.close()

    def test_answer_has_fields(self):
        conn = _get_conn()
        ans = ask(conn, "How much received in total?")
        assert ans.question
        assert ans.answer
        conn.close()
