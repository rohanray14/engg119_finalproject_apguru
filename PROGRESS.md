# Overnight Production-Hardening Progress

## Phase 0: Make the evals honest
- [x] Sibling tag on 100% — model families explicitly (100% → 10.75%)
- [x] Label leakage — removed case_types from DB, installments start open
- [x] Identifiability ceiling — oracle: 43.9% identifiable on dev
- [x] Threshold mismatch — config.py with 0.95 threshold everywhere
- [x] Missing results — re-run evals with new data (v6 in experiments.md)
- [x] Eval harness upgrades — git SHA, data hash, latency, compare mode
- [x] Freeze: evals/FROZEN.sha256 written

## Phase 1: Matching engine to production quality
- [x] Global assignment (no double-claiming installments) — sort by confidence desc, claim/downgrade conflicts
- [x] Amount explanation (deduction stories) — exact, TDS-10%, partial 50/60/75% in ledger/money.py
- [x] Expand safety cases — 25 cases (was 20), +5 edge cases
- [x] Error analysis loop (6 iterations: v5–v10) — identified coverage ceiling
  - Practical auto-match ceiling: ~2.1% (6/280) due to data characteristics
  - 57% blank payer, 33% multi-installment ambiguity, 7.5% safety-blocked
  - v9 rules: 100% precision, 1.79% coverage, 0 wrong, 0/25 safety violations
  - v10 AI: same at 0.95 threshold (multi-installment cap blocks AI gains)
- [x] LLM call hygiene — improved prompts, confidence calibration, safety checks, caching
- [x] Calibrated confidence — same_student(1) guard, MAX_STUDENTS_FOR_HIGH=5, multi-inst cap at MEDIUM
- [ ] Split and partial payments (deferred — explain_amount handles detection, full allocation needs global optimizer)

## Phase 2: Reconciliation
- [x] Gateway settlement breakdown — per-gateway totals (paid, fees, GST, net, discrepancy)
- [x] Three-way reconciliation view — payment ↔ gateway fees ↔ bank statement matching
- [x] Idempotent ingestion — UNIQUE constraint + INSERT OR IGNORE on bank_statement
- [x] Settlement eval — 343/343 matched, 0 gateway mismatches, 0 bank mismatches

## Phase 3: Other agent evals
- [x] Commissions eval — 30 parse cases 100%, 10 payout cases 100%; fixed city-scope false positive on "all students"
- [x] Reminders eval — 1257 reminders, all 6 checks pass (amounts, dates, schedule, no-paid, messages)
- [x] Risk eval — 6/6 planted categories detected (100% recall), severity ordering correct
- [x] Copilot eval — 30 questions 100%; added 4 missing patterns (count transactions, spend, biggest, expenses)

## Phase 4: Production engineering
- [x] Persistence — DATABASE_URL env var support in db.py
- [x] Ledger integrity — append-only audit log with verify_audit_integrity() gap detection
- [x] Auth — FINANCE_DESK_PASSWORD env var, Streamlit login gate with hmac.compare_digest
- [x] Config (single Pydantic config) — already done in config.py
- [x] Quality gates — ruff lint in Makefile (`make ci`), GitHub Actions workflow
- [x] CI — .github/workflows/ci.yml (Python 3.11+3.12, lint, test, agent evals)
- [x] Packaging — Dockerfile, Makefile, pyproject.toml (done in earlier commit)
- [x] Property-based tests — 9 hypothesis tests for money math (GST, fees, FX, TDS, balance)

## Phase 5: UI fixes
- [x] Home page contradictions (consistent numbers) — compute_dashboard_stats() single source of truth
- [x] Hard-coded date (configurable "as of") — sidebar date_input with data range
- [x] State labels (unmatched/suggested/needs review/matched) — clear 4-state display
- [x] Cash forecast x-axis sort — weeks generated in order from as_of date
- [x] Review queue debug strings (plain English) — format_match_reason() parser
- [x] Keyboard-driven review + bulk approve — bulk approve >=90%, keyboard hints

## Phase 6: Final report
- [ ] Run test split
- [ ] Write REPORT.md
- [ ] Update README
- [ ] Push branch + draft PR
- [ ] Write ALL PHASES COMPLETE
