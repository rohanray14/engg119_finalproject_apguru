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
- [ ] Gateway settlement breakdown
- [ ] Three-way reconciliation view
- [ ] Idempotent ingestion
- [ ] Settlement eval

## Phase 3: Other agent evals
- [ ] Commissions eval
- [ ] Reminders eval
- [ ] Risk eval
- [ ] Copilot eval (tool-calling rebuild)

## Phase 4: Production engineering
- [ ] Persistence (DATABASE_URL, migrations)
- [ ] Ledger integrity (append-only events)
- [ ] Auth (login gate)
- [ ] Config (single Pydantic config)
- [ ] Quality gates (ruff, mypy, coverage)
- [ ] CI (GitHub Actions)
- [ ] Packaging (Dockerfile, Makefile)
- [ ] Property-based tests (hypothesis)

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
