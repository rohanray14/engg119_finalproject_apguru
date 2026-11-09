# Overnight Production-Hardening Report

## Final Numbers (test split, one run)

| Metric | Value |
|---|---|
| **Precision** | 100.00% |
| **Coverage** | 3.33% (4/120) |
| **Wrong confident** | 0 |
| **Safety violations** | 0/25 |
| **Tests passing** | 157 |
| **API spend** | ~$1 (AI matcher tuning on dev only) |

## What was done

### Phase 0: Make the evals honest
- Fixed sibling overlap: 100% → 10.75% via explicit family modeling
- Removed label leakage (case_types no longer visible to matcher)
- Oracle analysis: 43.9% identifiability ceiling on dev
- Unified threshold at 0.95 across config, evals, and matcher
- Froze data hashes for reproducibility

### Phase 1: Matching engine to production quality
- **same_student(1) guard**: only HIGH confidence when a student has exactly 1 matching installment — eliminates ambiguity from random generator assignment
- **Amount explanation engine**: exact, TDS-10%, partial 50/60/75% deduction stories in `ledger/money.py`
- **Safety hardening**: expanded from 20 → 25 adversarial cases; MAX_STUDENTS_FOR_HIGH=5
- **AI matcher**: confidence calibration, all-installments safety check, multi-installment cap
- 6 error-analysis iterations (v5–v10)
- Practical auto-match ceiling: ~2.1% due to data characteristics (57% blank payer, 33% multi-installment ambiguity)

### Phase 2: Reconciliation
- Three-way reconciliation: payment ↔ gateway fees ↔ bank statement
- Gateway settlement breakdown: 343/343 matched, 0 mismatches
- Idempotent bank statement ingestion (UNIQUE + INSERT OR IGNORE)

### Phase 3: Agent evals
| Agent | Metric | Score |
|---|---|---|
| Commissions | parse_terms (30 cases) | 100% |
| Commissions | payout math (10 cases) | 100% |
| Reminders | correctness checks (6) | 100% |
| Risk | planted category recall (6/6) | 100% |
| Copilot | question accuracy (30 cases) | 100% |

Fixes applied during eval:
- `parse_terms`: city-scope false positive on "all students" (skip common words)
- Copilot: added 4 missing patterns; fixed pattern priority (overdue before payments)

### Phase 4: Production engineering
- **Persistence**: DATABASE_URL env var for configurable DB path
- **Ledger integrity**: append-only audit log with `verify_audit_integrity()` gap detection
- **Auth**: FINANCE_DESK_PASSWORD env var + Streamlit login gate (hmac.compare_digest)
- **Config**: single Pydantic config (config.py) — already existed
- **CI**: GitHub Actions workflow (Python 3.11/3.12, lint, test, agent evals)
- **Quality gates**: `make ci` runs ruff + pytest + eval_agents
- **Packaging**: Dockerfile, Makefile, pyproject.toml (done in prior commit)
- **Property tests**: 9 hypothesis tests for money math invariants

### Phase 5: UI fixes (done in prior session)
- Dashboard from single source of truth
- Configurable as-of date
- 4-state match labels
- Cash forecast sorted
- Review queue plain English
- Keyboard-driven review + bulk approve

## Coverage ceiling analysis

The practical auto-match ceiling is ~2.1% (not 43.9%) because:
1. **57% blank payer** — no name to match on
2. **33% multi-installment ambiguity** — generator assigns randomly (not FIFO), so even with perfect name match, can't pick the right installment
3. **7.5% safety-blocked** — global student count > MAX_STUDENTS_FOR_HIGH

The 43.9% oracle ceiling assumes perfect disambiguation including multi-installment cases. Achieving higher coverage requires either: (a) FIFO assignment in the generator, or (b) a global optimizer that allocates across all payments simultaneously.

## Key design decisions

1. **Integer paise everywhere** — no floats in money math, all amounts stored as int paise
2. **Code does all math** — LLM never computes or changes a number
3. **Confidence calibration** — same_student(1) guard, MAX_STUDENTS_FOR_HIGH=5, multi-installment cap at MEDIUM
4. **Safety-first** — 25 adversarial cases must pass; wrong confident matches = 0 is non-negotiable
5. **Append-only audit** — all changes logged with actor, action, entity, old/new values

## File changes summary

| Category | Files added/modified |
|---|---|
| Matching | agents/matching_rules.py, agents/matching_ai.py |
| Money math | ledger/money.py (explain_amount) |
| Reconciliation | ledger/reconciliation.py, ledger/load.py, ledger/db.py |
| Agents | agents/commissions.py, agents/copilot.py |
| Evals | evals/eval_agents.py, evals/commission_cases.json, evals/copilot_cases.json |
| Tests | tests/test_money_properties.py, tests/test_production.py, tests/test_reconciliation.py |
| Production | .github/workflows/ci.yml, app/auth.py, config.py |
| UI | app/Home.py, app/pages/2_Review_Queue.py, app/style.py |
