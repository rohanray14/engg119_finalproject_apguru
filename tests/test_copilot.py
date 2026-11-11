"""Tests for the copilot agent (LLM-powered text-to-SQL)."""

import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from ledger.load import load_all
from agents.copilot import ask, CopilotAnswer, _is_safe_query


DATA_DIR = PROJECT_ROOT / "data"


def _get_conn():
    return load_all(data_dir=DATA_DIR, db_path=":memory:")


class TestCopilotQuestions:
    """Each test checks that the LLM produces a relevant, non-empty answer."""

    def test_total_received(self):
        conn = _get_conn()
        ans = ask(conn, "How much have we received in total?")
        assert isinstance(ans, CopilotAnswer)
        assert len(ans.answer) > 10  # substantive answer
        assert ans.confidence > 0
        # Should mention a rupee amount somewhere
        assert "₹" in ans.answer or "INR" in ans.answer or "received" in ans.answer.lower()
        conn.close()

    def test_total_paid_out(self):
        conn = _get_conn()
        ans = ask(conn, "How much have we paid out in expenses?")
        assert len(ans.answer) > 10
        assert "₹" in ans.answer or "spent" in ans.answer.lower() or "paid" in ans.answer.lower()
        conn.close()

    def test_count_payments(self):
        conn = _get_conn()
        ans = ask(conn, "How many payments have we received?")
        assert "payment" in ans.answer.lower() or any(c.isdigit() for c in ans.answer)
        conn.close()

    def test_count_students(self):
        conn = _get_conn()
        ans = ask(conn, "How many students do we have?")
        assert "student" in ans.answer.lower() or any(c.isdigit() for c in ans.answer)
        conn.close()

    def test_overdue(self):
        conn = _get_conn()
        ans = ask(conn, "How many installments are overdue?")
        assert "overdue" in ans.answer.lower() or any(c.isdigit() for c in ans.answer)
        conn.close()

    def test_who_owes(self):
        conn = _get_conn()
        ans = ask(conn, "Who owes us the most?")
        assert ans.confidence > 0
        assert len(ans.answer) > 10
        conn.close()

    def test_largest_payments(self):
        conn = _get_conn()
        ans = ask(conn, "Which payments are the largest?")
        assert len(ans.answer) > 10
        conn.close()

    def test_unmatched(self):
        conn = _get_conn()
        ans = ask(conn, "Show me unmatched payments")
        assert len(ans.answer) > 10
        conn.close()

    def test_cash_position(self):
        conn = _get_conn()
        ans = ask(conn, "What is our cash position?")
        assert len(ans.answer) > 10
        assert "₹" in ans.answer or "inflow" in ans.answer.lower() or "net" in ans.answer.lower()
        conn.close()

    def test_expense_breakdown(self):
        conn = _get_conn()
        ans = ask(conn, "Show expense breakdown by category")
        assert ans.confidence > 0
        assert len(ans.answer) > 10
        conn.close()

    def test_unknown_question(self):
        conn = _get_conn()
        ans = ask(conn, "What is the meaning of life?")
        # LLM should either say it can't answer or produce a low-confidence result
        assert ans.confidence == 0.0 or "not sure" in ans.answer.lower() or "cannot" in ans.answer.lower()
        conn.close()

    def test_answer_has_fields(self):
        conn = _get_conn()
        ans = ask(conn, "How much received in total?")
        assert ans.question
        assert ans.answer
        conn.close()

    def test_returns_transactions(self):
        """Verify the LLM pipeline returns actual data rows."""
        conn = _get_conn()
        ans = ask(conn, "List the 5 largest payments")
        assert isinstance(ans.transactions, list)
        # Should have some rows since we have test data
        assert len(ans.transactions) > 0
        conn.close()


class TestSafetyGuard:
    """Verify the SQL safety filter blocks mutations."""

    def test_select_allowed(self):
        assert _is_safe_query("SELECT * FROM student") is True
        assert _is_safe_query("SELECT COUNT(*) FROM payment_in;") is True

    def test_insert_blocked(self):
        assert _is_safe_query("INSERT INTO student VALUES (1, 'test')") is False

    def test_update_blocked(self):
        assert _is_safe_query("UPDATE student SET name = 'x'") is False

    def test_delete_blocked(self):
        assert _is_safe_query("DELETE FROM student") is False

    def test_drop_blocked(self):
        assert _is_safe_query("DROP TABLE student") is False

    def test_subquery_with_mutation_blocked(self):
        assert _is_safe_query("SELECT * FROM student; DROP TABLE student") is False

    def test_pragma_blocked(self):
        assert _is_safe_query("PRAGMA table_info(student)") is False
