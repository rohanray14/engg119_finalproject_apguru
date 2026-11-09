# Overnight run: Educore Finance Desk, from class prototype to production-grade

You are running unattended overnight. No human will answer questions until morning.
Read `CLAUDE.md` and `docs/SPEC.md` first. Every rule in CLAUDE.md still applies, with one change:
**for this run only, do not stop and wait for approval on structural changes.** Instead, make the
call and record it in `DECISIONS.md` (what you decided, the alternatives, why). If a decision is
hard to undo and could reasonably go either way (deleting data, changing the money representation,
changing the public schema of answers.json), do the prep work, write it up in DECISIONS.md and
skip it.

## Ground rules for this run

1. **Branch.** Work on the branch `overnight/production-hardening`. Create it if it doesn't exist,
   check it out if it does. Never commit to or push `main`, because Render deploys from it.
2. **Resume.** Keep `PROGRESS.md` as your checklist (phases and tasks below, each `[ ]` / `[x]`,
   plus a one-line note per finished task). At the start, read it and pick up from the first
   unchecked task. You may be restarted several times tonight; PROGRESS.md is how you resume.
3. **One change per commit.** After each task: `pytest` must pass, run the relevant eval, add a
   line to `experiments.md`, commit with a clear message. If a task can't be finished, revert it,
   note why in PROGRESS.md and move on.
4. **Eval integrity, which is the most important rule.**
   - Never edit `data/test/`, any `answers.json`, `evals/safety_cases.json` or existing tests to
     raise a score. If you find a real bug in the generator or answer key (Phase 0), fix the
     *generator*, regenerate *all* splits with the same seed, record the before/after numbers, and
     do it **before** any system tuning.
   - After Phase 0, write the sha256 of every file under `data/` and `evals/` to
     `evals/FROZEN.sha256`. From then on, check the hashes before every eval run and stop if they
     changed.
   - Tune only on **dev**. Run **test** exactly once, at the very end (Phase 6).
   - Matchers may read only what a real system would have: bank/gateway lines, payer text, dates,
     amounts, the student/enrollment/installment records and *their own* earlier match decisions.
     They may **not** read `case_types` or any generator-provided installment `status`.
5. **Budget.** LLM calls go through the existing cache. Log the estimated $ per eval run to
   `experiments.md`. If the night's total estimated API spend goes past **$25**, stop making
   uncached LLM calls and finish the non-LLM tasks.
6. **Independent review.** At the end of each phase, spawn a fresh subagent that has *not* seen your
   work. Give it the phase's diff and acceptance criteria and ask it to find bugs, eval leakage and
   rule violations. Fix what it finds, or record in DECISIONS.md why you didn't.

---

## Phase 0: Make the evals honest (do this before any tuning)

Known problems found in review. Confirm each one, fix it, and add a regression test.

- [ ] **Sibling tag is on 100% of payments.** `data/generate.py` defines a family by parent
      *last name* drawn from a small surname pool, so every student "has siblings". That makes the
      per-case-type table meaningless and makes payer/last-name matching unrealistic. Model families
      explicitly (a family_id, with a realistic share of multi-child families, around 10–15%).
      Tag siblings only for real multi-child families.
- [ ] **Label leakage.** `payment_in.case_types` is loaded into the DB, and both matchers SELECT it.
      Move the case types out of the operational table, into the answer key only. Installment
      `status` comes from the generator (`paid` before any matching has happened). Make every
      installment start `open`/`overdue`, and derive status only from approved/auto matches.
- [ ] **Identifiability ceiling.** Add an oracle analysis to `evals/`: for each payment, can the
      correct installment(s) be told apart from the others using only the observable fields?
      Report `identifiable_rate`, plus coverage *as a share of identifiable payments*. Many payments
      have a blank payer and a common amount, so they can't be identified by anyone, human or AI.
      Coverage targets in SPEC §7 should be measured against this ceiling.
- [ ] **Threshold mismatch.** The eval uses 0.8 and the UI says auto-match needs 95%. Use one
      config value (`config.py` or `config.toml`), used everywhere.
- [ ] **Missing results.** `experiments.md` v5 (AI, 45% precision) has no matching file in
      `results/`. Re-run rules and AI on dev with the fixed data and record new v-lines.
- [ ] **Eval harness upgrades.** Results JSON should include git SHA, model, prompt version,
      threshold, data hash, cost and latency (p50/p95). Add a `--compare <run_a> <run_b>` mode
      that prints a diff table. Add a precision/coverage curve over thresholds 0.5–0.99.
- [ ] Freeze: write `evals/FROZEN.sha256` and commit.

**Exit criteria:** fixes merged with tests; new baseline lines in experiments.md; an honest
per-case-type table.

## Phase 1: Matching engine to production quality

Target on dev: **0 wrong confident matches on safety**, **precision ≥ 98%**, and coverage as close
as possible to the identifiable ceiling. Beat the rules baseline.

- [ ] **Global assignment, not one payment at a time.** Today two payments can claim the same
      installment, and the UI suggests installments that are already `paid`. Track remaining
      balance per installment and solve the assignment across all payments (greedy by confidence
      with conflict resolution, or Hungarian/ILP). Allocations (`allocated_paise`) are computed in
      code (`ledger/money.py`) and never by the LLM.
- [ ] **Split and partial payments.** Support one payment → several installments (siblings,
      several subjects) and several payments → one installment (partials, "1500 AED + 1500 AED").
      Score allocations, not just installment IDs.
- [ ] **Calibrated confidence.** Don't use the LLM's self-reported confidence directly. Build
      features (amount residual after the fee/GST/FX/TDS explanation, name score, date gap, margin
      over the 2nd candidate, number of same-amount candidates, LLM choice and agreement across
      2 samples) and fit a calibrator (isotonic or logistic) on dev with cross-validation. Report
      ECE and a reliability table.
- [ ] **Amount explanation.** For each candidate, compute in code which deduction story explains
      the gap (gateway fee + GST on fee, FX band, 10% TDS, partial). Pass the explanation to the
      LLM as a fact. Don't use a ±20% band.
- [ ] **LLM call hygiene.** Use tool use / structured output with a Pydantic schema. Put payer text
      and narration inside clearly delimited data blocks, and treat them as untrusted (prompt
      injection; there's a safety case for it). Add retries with backoff, bounded concurrency, and
      a cache key that includes model + prompt version. Log the full prompt/response, not 500-char
      previews.
- [ ] **Error analysis loop.** After each change, dump the 20 worst dev failures grouped by cause
      to `results/failures_<run>.md`, and pick the next change from the biggest cause. Make at
      least 5 iterations, each one a v-line.
- [ ] Expand `evals/safety_cases.json` **only by adding new cases** (never edit existing ones):
      already-fully-paid installment, two payments for one installment, refund showing as a
      negative credit, same family paying for two kids at once, payer name containing
      instructions. Add these before tuning against them.

## Phase 2: Reconciliation (the real product core)

- [ ] **Gateway settlement breakdown.** Gateways deposit batches net of fees, 1–3 days later, at
      their own FX rate. Match each bank settlement line to the set of gateway transactions it
      contains (subset-sum with tolerance, in code). Advance confirmation from
      `screenshot_only → seen_by_gateway → in_bank`.
- [ ] **Three-way reconciliation view:** tracker ↔ gateway ↔ bank, with exceptions listed.
- [ ] **Idempotent ingestion.** Re-importing the same bank file must not create duplicates
      (hash of date + amount + ref + narration). Add a CSV column-mapping layer, so a new bank
      export format needs only a mapping file and no code changes. Ship mappings for the generated
      format, plus a documented template.
- [ ] Eval: generate settlement batches with an answer key; report batch-resolution accuracy.

## Phase 3: Evals for the other agents (SPEC §7, currently missing)

Only matching has a scored eval. For each agent, build its test set first, freeze it, then improve
the agent.
- [ ] **Commissions:** around 30 free-text terms with hand-written expected rules and payouts. Target:
      100% exact payouts. The LLM only parses terms; code computes the money.
- [ ] **Reminders:** correct targets, amounts and dates (100%, checked by code), plus an LLM judge for
      tone, validated against about 30 labels you write and save in `evals/`.
- [ ] **Risk:** a ledger with planted issues. Report recall and false alarms.
- [ ] **Copilot:** about 30 questions with known answers. Currently it's around 13 regex patterns. Rebuild it as
      tool calling over a fixed set of safe, read-only query functions (no raw SQL from the model).
      Each answer cites the transaction IDs used, and the number comes from code. Target ≥ 90%.

## Phase 4: Production engineering

- [ ] **Persistence.** The app rebuilds `data/_app_ledger.db` from CSVs, and Render's disk is
      ephemeral, so approvals are lost on restart. Separate "seed demo data" from "the ledger".
      Add a `DATABASE_URL` setting (SQLite locally, Postgres in prod) via SQLAlchemy, with Alembic
      migrations. Write a Render deploy note in the README (managed Postgres). Don't change Render
      settings yourself.
- [ ] **Ledger integrity.** Approvals, rejections and payouts are append-only events in the audit
      log. Balances are derived, never edited in place. Add an "undo approval" that writes a
      reversing event.
- [ ] **Auth.** A simple login gate (env-configured password or Streamlit auth) and a viewer vs
      finance-lead role. Only the finance lead can approve.
- [ ] **Config.** Gateway fee rates, FX source, thresholds, reminder schedule and TDS rates live in
      one config file, validated by Pydantic.
- [ ] **Quality gates.** `ruff`, `mypy` (at least on `ledger/` and `agents/`), `pytest --cov`
      with ≥ 85% on `ledger/` and `agents/`, and `pre-commit`.
- [ ] **CI.** GitHub Actions: lint, typecheck, tests, the rules eval and the safety eval (no API key
      needed; use the cache or rules only). Fail the build on any wrong confident safety match.
- [ ] **Packaging.** A `Dockerfile`, `.env.example`, pinned `requirements.txt` (or `pyproject.toml`),
      and a `Makefile` with `make data test eval app`.
- [ ] Property-based tests (`hypothesis`) for `ledger/money.py`: GST round-trips, no float drift,
      and allocations summing exactly to the payment.

## Phase 5: UI fixes found on the live site

- [ ] The Home page contradicts itself: "Installments overdue: 0 / ₹0 outstanding", while the
      briefing says "0 installments are past due", the decision list shows installments 161 and
      215 days overdue, and another card says "26 installments are past due". Compute every number
      from one function and add a test that the Home numbers agree with each other.
- [ ] The date is hard-coded ("Wednesday, 5 November"). Use a configurable "as of" date (default
      today), and in demo mode clamp it to the data's date range.
- [ ] "5 matched automatically; 19 need you" vs "Waiting for a match: 395": define and label
      these states clearly (unmatched / suggested / needs review / matched).
- [ ] The cash-forecast x-axis is out of order (10 Dec comes before 5 Nov). Sort by date.
- [ ] The review queue shows raw debug strings
      (`_amount+name(100.0)vs_second(47.6…)+fifo+global(11)`) and suggests installments with
      status `paid`. Show a plain-English reason, the deduction explanation, and only open
      balances. Every suggestion shows "50% sure"; show the calibrated confidence.
- [ ] Add a keyboard-driven review flow (approve / next / reject) and a bulk-approve option for
      high-confidence items, with an undo.

## Phase 6: Final report

- [ ] Run the **test** split once for every agent with a scored eval.
- [ ] Write `REPORT.md`: an architecture diagram (mermaid); before/after tables (dev and test) for
      every agent; the identifiability ceiling; cost and latency per 100 payments; the safety
      results; known limitations; and the next 5 things you'd build.
- [ ] Update the README (setup, architecture, eval table, how to run).
- [ ] Push the branch and open a **draft** PR into `main` with REPORT.md as the description.
      Don't merge.
- [ ] Write `ALL PHASES COMPLETE` as the last line of PROGRESS.md.

If you run out of time, the priority order is **Phase 0 → 1 → 5 → 4 (CI, persistence) → 3 → 2 → 6**.
Whatever happens, always finish with an updated PROGRESS.md and REPORT.md that describe the actual
state.
