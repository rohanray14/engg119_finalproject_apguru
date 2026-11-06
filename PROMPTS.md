# Build prompts

Paste these one at a time into Claude Code (start in plan mode) or Cursor (Agent mode).
Review the plan before approving. After each step: run tests, commit.

## Step 1 — Skeleton
Read CLAUDE.md and docs/SPEC.md. Set up the folder layout from CLAUDE.md, a requirements.txt
(pandas, pydantic, anthropic, rapidfuzz, streamlit, pytest, python-dotenv), a .gitignore
(.env, .venv/, real_data/, logs/cache/), an empty experiments.md, and a README with the
commands. Don't write features yet.

## Step 2 — Data models
Create ledger/schemas.py with Pydantic models for every entity in SPEC.md section 4.
Store money as integer paise with a currency code. Explain each model before writing it.

## Step 3 — Money math
Create ledger/money.py with pure functions: add_gst, remove_gst, gateway_fee (rates from a
config dict), fx_convert (rates table), tds, balance_owed, and expected_bank_amount (paid →
fees → GST on fee → FX → INR). Write pytest tests for each, including the examples in
SPEC.md section 1. All tests must pass.

## Step 4 — Fake data generator
Create data/generate.py (fixed seed) that makes ~200 students, enrollments, installments,
counselors with free-text terms, ~400 incoming payments (bank lines + gateway batch
deposits), ~60 outgoing payments, and a messy "tracker" CSV. Reproduce every pattern in
SPEC.md section 3. Tag each payment with its case type(s). Write the correct answers to
answers.json. Split 70% dev / 30% test. Print a summary of case-type counts at the end.

## Step 5 — Ledger + loader
Create ledger/db.py (SQLite schema from schemas.py, plus audit_log) and ledger/load.py that
loads the generated data. Add a cleanup step: day/month date parsing, amount+currency
parsing from messy text, name normalization, duplicate detection. Unit-test the parsers on
the messy examples from SPEC.md.

## Step 6 — Eval harness + rules baseline
Create evals/run_eval.py and evals/scoring.py: run any matcher over a split, compare with
answers.json, report precision of auto-matches, coverage, wrong confident matches, and a
per-case-type table; save to results/. Then create agents/matching_rules.py (exact amount +
fuzzy name + date window). Run on dev and add the result as line v0 in experiments.md.

## Step 7 — AI matcher
Create agents/matching_ai.py: rules first; for the rest, shortlist ≤5 candidates in code,
then call the Anthropic API for structured JSON {installment_ids, allocations, confidence,
reason} or "unsure". Log and cache every call in logs/. Add a --threshold flag. Run the eval,
then show me the 20 worst failures grouped by cause.

(Then loop: pick the biggest failure cause → change one thing → re-run → log in experiments.md.)

## Step 8 — Safety set
Create evals/safety_cases.json with ~20 tricky cases (same-amount siblings, identical names,
company payer with TDS, "pay to new account" message, duplicate payment). Add them to the
eval. Target: zero wrong confident matches.

## Step 9 — UI
Build the Streamlit app from SPEC.md section 6: Home (Today), Payments, Review queue,
Students (list + click for detail), Commissions, Money out. Review queue approvals write to
the ledger and audit log. Use the ledger only; no hard-coded numbers.

## Step 10+ — Other agents (one at a time)
For each of Reminders, Commissions, Risk, Copilot: define input/output, build its test set
from SPEC.md section 7, write a simple version, add the AI, run the eval, show failures,
then add its screen. Add each result to experiments.md.
