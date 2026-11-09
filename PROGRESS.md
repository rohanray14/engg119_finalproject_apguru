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
- [ ] Global assignment (no double-claiming installments)
- [ ] Split and partial payments
- [ ] Calibrated confidence
- [ ] Amount explanation (deduction stories)
- [ ] LLM call hygiene (structured output, Pydantic)
- [ ] Error analysis loop (5+ iterations)
- [ ] Expand safety cases

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
- [ ] Home page contradictions (consistent numbers)
- [ ] Hard-coded date (configurable "as of")
- [ ] State labels (unmatched/suggested/needs review/matched)
- [ ] Cash forecast x-axis sort
- [ ] Review queue debug strings (plain English)
- [ ] Keyboard-driven review + bulk approve

## Phase 6: Final report
- [ ] Run test split
- [ ] Write REPORT.md
- [ ] Update README
- [ ] Push branch + draft PR
- [ ] Write ALL PHASES COMPLETE
