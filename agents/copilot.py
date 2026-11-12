"""Copilot agent — answers finance questions using the ledger.

Two-step LLM pipeline:
1. Send the DB schema + question to Claude → it generates a read-only SQL query.
2. Execute the SQL, send results back to Claude → it writes a plain-English answer.

Rules enforced:
- Only SELECT queries are allowed (no mutations).
- The LLM never does money math — SQL computes, LLM formats.
- Every LLM call is logged to logs/llm_calls.jsonl.
"""

from __future__ import annotations

import hashlib
import json
import re
import sqlite3
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

try:
    import anthropic
    HAS_ANTHROPIC = True
except ImportError:
    HAS_ANTHROPIC = False

from config import CONFIG

MODEL = CONFIG.model
PROJECT_ROOT = Path(__file__).resolve().parent.parent
LOGS_DIR = PROJECT_ROOT / "logs"
CACHE_DIR = LOGS_DIR / "cache" / "copilot"

# ---------------------------------------------------------------------------
# Public interface
# ---------------------------------------------------------------------------

@dataclass
class CopilotAnswer:
    question: str
    answer: str
    query_used: str = ""
    transactions: list[dict] = field(default_factory=list)
    confidence: float = 1.0


DB_SCHEMA = """\
Tables in the database (all money columns store integer paise, 100 paise = 1 rupee):

student(id, name, aliases JSON, city, country, counselor_ids JSON, payer_aliases JSON, parent_name, parent_phone, parent_email)
enrollment(id, student_id FK→student, program, fee_model 'package'|'hourly', total_fee_paise, currency, gst_applicable 0/1)
installment(id, enrollment_id FK→enrollment, due_date ISO, amount_due_paise, currency, status 'open'|'partial'|'paid'|'overdue')
payment_in(id, source 'bank'|'gateway'|'cash'|'screenshot', method, payer_name, date ISO, amount_paid_paise, currency, gateway_fee_paise, gst_on_fee_paise, fx_diff_paise, tds_paise, amount_in_bank_paise, confirmation 'screenshot_only'|'seen_by_gateway'|'in_bank')
match_result(id, payment_id FK→payment_in, allocations JSON [{installment_id, allocated_paise}], method 'rules'|'ai'|'human', confidence REAL, reason, status 'auto'|'pending_review'|'approved'|'rejected')
counselor(id, name, terms_text, parsed_rule JSON)
commission_line(id, counselor_id FK→counselor, payment_id FK→payment_in, base_paise, rate REAL, commission_paise, refund_deduction_paise, tds_paise, net_paise, currency)
payment_out(id, date ISO, payee, category 'faculty'|'commission'|'refund'|'rent'|'ads'|'tax'|'software'|'other', amount_paise, currency)
bank_statement(id, date ISO, narration, credit_paise, debit_paise, payment_id FK→payment_in)
payout_approval(id, approved_at, actor, currency, total_net_paise, lines_fingerprint)
audit_log(id, timestamp ISO, actor, action, entity, old_value, new_value)
"""

SQL_SYSTEM_PROMPT = f"""\
You are a SQL assistant for Educore Finance Desk, an Indian tutoring company.
Given a user's question about their finances, generate a single SQLite SELECT query to answer it.

{DB_SCHEMA}

RULES:
1. Output ONLY a valid SQLite SELECT statement. No markdown, no explanation, no backticks.
2. NEVER generate INSERT, UPDATE, DELETE, DROP, ALTER, or any mutation.
3. All money is stored as integer paise (100 paise = 1 rupee). To display as rupees, divide by 100.0 in the query. Format with ROUND() as needed.
4. Dates are ISO format (YYYY-MM-DD). Use date() and strftime() for date arithmetic.
5. Keep queries simple and efficient. Use JOINs when needed. LIMIT large result sets to 25 rows.
6. If the question asks about "outstanding" or "owed", look at installments with status IN ('open', 'overdue', 'partial').
7. If the question asks about matched/linked payments, join payment_in with match_result WHERE status IN ('auto', 'approved').
8. For "this month" or "last month", use date('now', 'start of month') style expressions.
9. Group by currency when summing money — never add rupees to dollars.
10. If you cannot answer the question with the available tables, output: SELECT 'CANNOT_ANSWER' as error;
"""

ANSWER_SYSTEM_PROMPT = """\
You are a concise finance assistant for Educore, an Indian tutoring company.
Given a user's question and the query results from their database, write a short answer.

RULES:
1. Be extremely brief. Max 2-3 sentences for simple questions.
2. For lists, show the top 5 only with a one-line summary (e.g., "17 families owe a total of ₹52,14,000. Top 5:"). Use a compact format like "Name — ₹3,87,040".
3. Format money in Indian style: ₹1,23,000 for INR, $1,300 for USD.
4. All raw data is in paise (100 paise = 1 rupee). Convert to rupees/dollars.
5. Use Indian date format (dd/mm/yyyy) when showing dates.
6. If the data is empty, say so in one line.
7. Never guess or fabricate data. Only use what's in the results.
8. No SQL, no technical details, no padding words. Just the answer.
9. Never use markdown formatting (no **, no *, no #). Plain text only.
"""


def ask(conn: sqlite3.Connection, question: str) -> CopilotAnswer:
    """Answer a finance question by generating and executing SQL via an LLM."""
    if not HAS_ANTHROPIC:
        return _fallback_regex(conn, question)

    import os
    api_key = (os.environ.get("ANTHROPIC_API_KEY") or "").strip()
    client = anthropic.Anthropic(api_key=api_key)

    # Step 1: Generate SQL
    sql_query = _generate_sql(client, question)
    if not sql_query or "CANNOT_ANSWER" in sql_query:
        return CopilotAnswer(
            question=question,
            answer="I'm not sure how to answer that with the data I have. "
                   "Try asking about payments, students, outstanding amounts, "
                   "expenses, commissions, or overdue installments.",
            confidence=0.0,
        )

    # Safety: only allow SELECT
    if not _is_safe_query(sql_query):
        return CopilotAnswer(
            question=question,
            answer="I can only answer read-only questions about your data.",
            confidence=0.0,
        )

    # Step 2: Execute the query
    try:
        rows = conn.execute(sql_query).fetchall()
        results = [dict(r) for r in rows]
    except Exception as e:
        # If the generated SQL has an error, try once more with the error message
        sql_query = _retry_sql(client, question, sql_query, str(e))
        if not sql_query or not _is_safe_query(sql_query):
            return CopilotAnswer(
                question=question,
                answer="I had trouble querying the database. Try rephrasing your question.",
                confidence=0.5,
            )
        try:
            rows = conn.execute(sql_query).fetchall()
            results = [dict(r) for r in rows]
        except Exception:
            return CopilotAnswer(
                question=question,
                answer="I had trouble querying the database. Try rephrasing your question.",
                confidence=0.5,
            )

    # Step 3: Generate the answer from results
    answer_text = _generate_answer(client, question, sql_query, results)

    return CopilotAnswer(
        question=question,
        answer=answer_text,
        query_used=sql_query,
        transactions=results[:25],  # cap what we send to the frontend
        confidence=1.0,
    )


# ---------------------------------------------------------------------------
# LLM calls
# ---------------------------------------------------------------------------

def _generate_sql(client: anthropic.Anthropic, question: str) -> str:
    """Ask the LLM to generate a SQL query for the question."""
    cache_key = _cache_key(f"sql:{question}")
    cached = _read_cache(cache_key)
    if cached is not None:
        return cached

    start = time.time()
    response = client.messages.create(
        model=MODEL,
        max_tokens=1024,
        system=SQL_SYSTEM_PROMPT,
        messages=[{"role": "user", "content": question}],
    )
    latency_ms = int((time.time() - start) * 1000)
    sql = response.content[0].text.strip()
    # Strip markdown fences if the model adds them
    sql = re.sub(r"^```(?:sql)?\s*", "", sql)
    sql = re.sub(r"\s*```$", "", sql)
    sql = sql.strip()

    _log_call(f"[SQL-GEN] {question}", sql, MODEL,
              response.usage.input_tokens, response.usage.output_tokens, latency_ms)
    _write_cache(cache_key, sql)
    return sql


def _retry_sql(
    client: anthropic.Anthropic, question: str, bad_sql: str, error: str,
) -> Optional[str]:
    """Retry SQL generation with the error message for context."""
    prompt = (
        f"The user asked: {question}\n\n"
        f"I generated this SQL:\n{bad_sql}\n\n"
        f"But it failed with: {error}\n\n"
        f"Please generate a corrected SQLite SELECT query. Output ONLY the SQL."
    )
    start = time.time()
    response = client.messages.create(
        model=MODEL,
        max_tokens=1024,
        system=SQL_SYSTEM_PROMPT,
        messages=[{"role": "user", "content": prompt}],
    )
    latency_ms = int((time.time() - start) * 1000)
    sql = response.content[0].text.strip()
    sql = re.sub(r"^```(?:sql)?\s*", "", sql)
    sql = re.sub(r"\s*```$", "", sql)
    sql = sql.strip()

    _log_call(f"[SQL-RETRY] {question}", sql, MODEL,
              response.usage.input_tokens, response.usage.output_tokens, latency_ms)
    return sql


def _generate_answer(
    client: anthropic.Anthropic,
    question: str,
    sql: str,
    results: list[dict],
) -> str:
    """Given query results, generate a natural-language answer."""
    # Format results for the LLM
    if not results:
        results_text = "(no rows returned)"
    elif len(results) <= 25:
        results_text = json.dumps(results, default=str, indent=2)
    else:
        results_text = json.dumps(results[:25], default=str, indent=2)
        results_text += f"\n... ({len(results)} total rows, showing first 25)"

    prompt = (
        f"User question: {question}\n\n"
        f"Query results:\n{results_text}"
    )

    cache_key = _cache_key(f"answer:{question}:{results_text[:500]}")
    cached = _read_cache(cache_key)
    if cached is not None:
        return cached

    start = time.time()
    response = client.messages.create(
        model=MODEL,
        max_tokens=1024,
        system=ANSWER_SYSTEM_PROMPT,
        messages=[{"role": "user", "content": prompt}],
    )
    latency_ms = int((time.time() - start) * 1000)
    answer = response.content[0].text.strip()

    _log_call(f"[ANSWER] {question}", answer, MODEL,
              response.usage.input_tokens, response.usage.output_tokens, latency_ms)
    _write_cache(cache_key, answer)
    return answer


# ---------------------------------------------------------------------------
# Safety
# ---------------------------------------------------------------------------

_FORBIDDEN = re.compile(
    r"\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|ATTACH|DETACH|PRAGMA|VACUUM)\b",
    re.IGNORECASE,
)


def _is_safe_query(sql: str) -> bool:
    """Only allow SELECT queries."""
    stripped = sql.strip().rstrip(";").strip()
    if not stripped.upper().startswith("SELECT"):
        return False
    if _FORBIDDEN.search(stripped):
        return False
    return True


# ---------------------------------------------------------------------------
# Fallback: regex-based (used when anthropic not installed)
# ---------------------------------------------------------------------------

def _fallback_regex(conn: sqlite3.Connection, question: str) -> CopilotAnswer:
    """Simple regex fallback when the Anthropic SDK is unavailable."""
    q = question.strip().lower()

    if re.search(r"(?:how much|total).*(?:received|collected)", q):
        rows = conn.execute(
            "SELECT currency, SUM(amount_paid_paise) as total, COUNT(*) as cnt "
            "FROM payment_in GROUP BY currency ORDER BY total DESC"
        ).fetchall()
        lines = [f"{r['currency']}: {r['total']/100:,.0f} ({r['cnt']} payments)" for r in rows]
        return CopilotAnswer(question=question, answer="Total received:\n" + "\n".join(lines),
                             transactions=[dict(r) for r in rows])

    if re.search(r"(?:who|which).*(?:owe|outstanding)", q):
        rows = conn.execute(
            "SELECT s.name, SUM(i.amount_due_paise) as owed, i.currency "
            "FROM installment i JOIN enrollment e ON i.enrollment_id = e.id "
            "JOIN student s ON e.student_id = s.id "
            "WHERE i.status IN ('open', 'overdue') "
            "GROUP BY s.id, s.name, i.currency ORDER BY owed DESC LIMIT 20"
        ).fetchall()
        lines = [f"  {r['name']}: {r['currency']} {r['owed']/100:,.0f}" for r in rows]
        return CopilotAnswer(question=question,
                             answer="Top students with outstanding balances:\n" + "\n".join(lines),
                             transactions=[dict(r) for r in rows])

    if re.search(r"(?:how many).*overdue", q):
        row = conn.execute(
            "SELECT COUNT(*) as cnt, COALESCE(SUM(amount_due_paise), 0) as total "
            "FROM installment WHERE status = 'overdue'"
        ).fetchone()
        return CopilotAnswer(question=question,
                             answer=f"There are {row['cnt']} overdue installments totaling "
                                    f"\u20b9{row['total']/100:,.0f}.")

    return CopilotAnswer(
        question=question,
        answer="The AI assistant is not available right now. "
               "Try asking about totals, payments, students, or overdue amounts.",
        confidence=0.0,
    )


# ---------------------------------------------------------------------------
# Logging & caching
# ---------------------------------------------------------------------------

def _log_call(
    prompt: str, output: str, model: str,
    input_tokens: int, output_tokens: int, latency_ms: int,
):
    LOGS_DIR.mkdir(parents=True, exist_ok=True)
    log_entry = {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "model": model,
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "latency_ms": latency_ms,
        "prompt_preview": prompt[:500],
        "output_preview": output[:500],
    }
    log_path = LOGS_DIR / "llm_calls.jsonl"
    with open(log_path, "a") as f:
        f.write(json.dumps(log_entry) + "\n")


def _cache_key(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


def _read_cache(key: str) -> Optional[str]:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path = CACHE_DIR / f"{key}.txt"
    if path.exists():
        return path.read_text()
    return None


def _write_cache(key: str, response: str):
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path = CACHE_DIR / f"{key}.txt"
    path.write_text(response)
