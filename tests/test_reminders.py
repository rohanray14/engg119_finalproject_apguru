"""Tests for the reminders agent."""

import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from datetime import date
from ledger.load import load_all
from agents.reminders import generate_reminders, Reminder, _compose_message


DATA_DIR = PROJECT_ROOT / "data"


def _get_conn():
    return load_all(data_dir=DATA_DIR, db_path=":memory:")


class TestReminderGeneration:
    def test_generates_reminders(self):
        conn = _get_conn()
        # Use a date far enough in the future that some installments are due
        reminders = generate_reminders(conn, as_of=date(2026, 3, 1))
        assert isinstance(reminders, list)
        conn.close()

    def test_reminder_has_correct_fields(self):
        conn = _get_conn()
        reminders = generate_reminders(conn, as_of=date(2026, 3, 1))
        if reminders:
            r = reminders[0]
            assert isinstance(r, Reminder)
            assert r.installment_id > 0
            assert r.student_id > 0
            assert r.student_name
            assert r.amount_due_paise > 0
            assert r.currency
            assert r.reminder_type in ("pre_due", "on_due", "overdue")
            assert r.scheduled_for is not None
            assert r.message
        conn.close()

    def test_reminder_types_correct(self):
        conn = _get_conn()
        reminders = generate_reminders(conn, as_of=date(2026, 6, 1))
        types = {r.reminder_type for r in reminders}
        # Should see at least pre_due and on_due for installments within range
        assert len(types) >= 1
        for r in reminders:
            assert r.reminder_type in ("pre_due", "on_due", "overdue")
        conn.close()

    def test_no_reminders_for_paid(self):
        """Paid installments should not get reminders."""
        conn = _get_conn()
        reminders = generate_reminders(conn, as_of=date(2026, 6, 1))
        # Get all paid installment ids
        paid_ids = {
            r["id"] for r in conn.execute(
                "SELECT id FROM installment WHERE status = 'paid'"
            ).fetchall()
        }
        reminder_inst_ids = {r.installment_id for r in reminders}
        overlap = paid_ids & reminder_inst_ids
        assert len(overlap) == 0, f"Reminders generated for paid installments: {overlap}"
        conn.close()

    def test_amounts_match_installments(self):
        """Reminder amounts must match the installment amount."""
        conn = _get_conn()
        reminders = generate_reminders(conn, as_of=date(2026, 6, 1))
        for r in reminders:
            inst = conn.execute(
                "SELECT amount_due_paise, currency FROM installment WHERE id = ?",
                (r.installment_id,),
            ).fetchone()
            assert r.amount_due_paise == inst["amount_due_paise"]
            assert r.currency == inst["currency"]
        conn.close()

    def test_scheduled_dates_follow_schedule(self):
        """Scheduled dates should be -3, 0, or +7 relative to due date."""
        conn = _get_conn()
        reminders = generate_reminders(conn, as_of=date(2026, 6, 1))
        for r in reminders:
            if r.due_date is None:
                continue
            offset = (r.scheduled_for - r.due_date).days
            assert offset in (-3, 0, 7), f"Unexpected offset {offset} for {r.reminder_type}"
        conn.close()


class TestComposeMessage:
    def test_pre_due_message(self):
        msg = _compose_message("Rohan Ray", "SAT", 17700000, "INR",
                               date(2025, 6, 15), "pre_due")
        assert "Rohan Ray" in msg
        assert "SAT" in msg
        assert "₹177,000" in msg
        assert "15/06/2025" in msg
        assert "due on" in msg

    def test_on_due_message(self):
        msg = _compose_message("Rohan Ray", "SAT", 17700000, "INR",
                               date(2025, 6, 15), "on_due")
        assert "due today" in msg

    def test_overdue_message(self):
        msg = _compose_message("Rohan Ray", "SAT", 17700000, "INR",
                               date(2025, 6, 15), "overdue")
        assert "overdue" in msg

    def test_foreign_currency_format(self):
        msg = _compose_message("John Doe", "IB", 40000, "USD",
                               date(2025, 6, 15), "pre_due")
        assert "USD 400.00" in msg
