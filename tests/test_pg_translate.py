"""Unit tests for the SQLite -> Postgres statement translator (no database needed)."""

import pytest

from ledger.pg import UntranslatableSQL, translate_schema, translate_sql


def test_placeholders_and_percent():
    assert translate_sql("SELECT * FROM t WHERE a = ? AND b LIKE '%x%'", True) == \
        "SELECT * FROM t WHERE a = %s AND b ILIKE '%%x%%'"


def test_question_mark_inside_string_is_kept():
    assert translate_sql("SELECT 'why?' WHERE a = ?", True) == "SELECT 'why?' WHERE a = %s"


def test_comment_with_apostrophe_does_not_break_placeholders():
    sql = "SELECT a -- don't touch\nFROM t WHERE id = ?"
    assert translate_sql(sql, True) == "SELECT a \nFROM t WHERE id = %s"


def test_block_comment_removed():
    assert translate_sql("SELECT /* it's ? */ a FROM t WHERE b = ?", True) == "SELECT  a FROM t WHERE b = %s"


def test_lowercase_like_translated_but_not_inside_literals():
    assert translate_sql("select * from t where name like ? and note = 'like'", True) == \
        "select * from t where name ILIKE %s and note = 'like'"


def test_doubled_quote_escape():
    assert translate_sql("SELECT 'it''s ?' , ?", True) == "SELECT 'it''s ?' , %s"


def test_insert_or_replace_upsert_and_trailing_semicolon():
    out = translate_sql("INSERT OR REPLACE INTO student (id, name) VALUES (?, ?);", True)
    assert out == "INSERT INTO student (id, name) VALUES (%s, %s) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name"


def test_insert_or_replace_uses_table_key():
    out = translate_sql("INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)", True)
    assert "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value" in out


def test_insert_or_ignore():
    assert translate_sql("INSERT OR IGNORE INTO t (id) VALUES (?)", True).endswith("ON CONFLICT DO NOTHING")


def test_untranslatable_forms_are_refused():
    with pytest.raises(UntranslatableSQL):
        translate_sql("INSERT OR REPLACE INTO t (id, a) VALUES (?, ?) RETURNING id", True)
    with pytest.raises(UntranslatableSQL):
        translate_sql("INSERT OR REPLACE INTO t (a) VALUES (?)", True)


def test_no_params_leaves_percent_alone():
    assert translate_sql("SELECT '%' AS p", False) == "SELECT '%' AS p"


def test_schema_types():
    ddl = translate_schema("id INTEGER PRIMARY KEY AUTOINCREMENT, x INTEGER, c REAL")
    assert ddl == "id BIGSERIAL PRIMARY KEY, x BIGINT, c DOUBLE PRECISION"
