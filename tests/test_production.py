"""Tests for production engineering features."""

import os
from ledger.db import get_connection, log_audit, verify_audit_integrity


class TestDatabaseURL:
    def test_memory_db(self):
        conn = get_connection(":memory:")
        # Should be able to create tables
        count = conn.execute("SELECT COUNT(*) FROM student").fetchone()[0]
        assert count == 0
        conn.close()

    def test_env_override(self, tmp_path, monkeypatch):
        db_file = tmp_path / "test.db"
        monkeypatch.setenv("DATABASE_URL", str(db_file))
        # Re-import to pick up env change
        import importlib
        import ledger.db
        importlib.reload(ledger.db)
        assert str(ledger.db.DB_PATH) == str(db_file)
        # Clean up
        monkeypatch.delenv("DATABASE_URL")
        importlib.reload(ledger.db)


class TestAuditIntegrity:
    def test_empty_log_is_valid(self):
        conn = get_connection(":memory:")
        assert verify_audit_integrity(conn) is True
        conn.close()

    def test_sequential_entries_are_valid(self):
        conn = get_connection(":memory:")
        log_audit(conn, "test", "create", "payment:1")
        log_audit(conn, "test", "update", "payment:1", "old", "new")
        log_audit(conn, "test", "approve", "match:1")
        assert verify_audit_integrity(conn) is True
        conn.close()

    def test_gap_detection(self):
        conn = get_connection(":memory:")
        log_audit(conn, "test", "create", "payment:1")
        log_audit(conn, "test", "update", "payment:2")
        log_audit(conn, "test", "approve", "match:1")
        # Delete middle entry to create gap
        conn.execute("DELETE FROM audit_log WHERE id = 2")
        conn.commit()
        assert verify_audit_integrity(conn) is False
        conn.close()

    def test_audit_fields(self):
        conn = get_connection(":memory:")
        log_audit(conn, "finance_lead", "approve_match", "match:42", "pending", "approved")
        row = conn.execute("SELECT * FROM audit_log WHERE id = 1").fetchone()
        assert row["actor"] == "finance_lead"
        assert row["action"] == "approve_match"
        assert row["entity"] == "match:42"
        assert row["old_value"] == "pending"
        assert row["new_value"] == "approved"
        assert row["timestamp"]  # non-empty
        conn.close()
