# Educore Finance Desk

A prototype finance desk for Educore (formerly APGuru), an Indian tutoring company that
collects fees from families in India and abroad. The user is the company's **finance lead**.

Goal: track every rupee coming in and going out in one place, confirm it against the bank,
link it to the right person, and keep it up to date with AI agents. The finance lead approves
anything that matters.

Full spec: `docs/SPEC.md`. Build order and prompts: `docs/PROMPTS.md`. Read SPEC.md before
any non-trivial task.

**Production rebuild in progress:** read `docs/HANDOFF.md` first. It has the current
status, decisions already made, open questions for the owner, and the brief for the
next step (Next.js front end).

## Rules (never break these)

1. **Code does all money math.** GST, gateway fees, FX conversion, TDS, balances and
   commissions are deterministic Python functions with unit tests. The LLM never calculates
   or changes a number.
2. **The AI suggests; a person approves.** Matches below the confidence threshold, commission
   payouts, refunds and any bank-detail change wait for approval. Only routine reminders may
   go out automatically (simulated in the prototype).
3. **Every change is logged** to the audit log: who, what, when, old value, new value.
4. **Every LLM call is logged** (input, output, model, tokens, latency) to `logs/` and cached,
   so re-running an eval is free and reproducible.
5. **Never change a test, test data or answer key to make a score go up.** Fix the system.
6. **Fake data only.** Never commit or send real student data. `real_data/` is gitignored and
   never sent to an LLM.
7. **Dates are day/month (Indian format).** Never parse dd/mm as mm/dd.
8. **Money is stored as integer paise** (or `Decimal`), never floats. Every amount carries
   a currency code.

## Tech stack

- Python 3.11+, Pydantic models, SQLite ledger (via `sqlite3` or SQLModel)
- Anthropic API for LLM calls (structured JSON output); `rapidfuzz` for name similarity
- Streamlit for the prototype UI (`app/`)
- FastAPI for the production API (`api/`), Clerk auth, Postgres (Neon) in production;
  `ledger/pg.py` lets the same code run on SQLite and Postgres. Deploy: `docs/DEPLOY.md`
- pytest for unit tests; `evals/run_eval.py` for scored evals

## Folder layout

```
data/        generate.py, generated CSVs, answers.json (dev/ and test/ splits)
ledger/      schemas.py, db.py, money.py (all money math), load.py
agents/      matching_rules.py, matching_ai.py, reminders.py, commissions.py, risk.py, copilot.py
evals/       run_eval.py, scoring.py, safety_cases.json
results/     one JSON/Markdown report per eval run
logs/        LLM call logs + cache
app/         Streamlit prototype (Home.py + pages/)
api/         FastAPI production API (routers/, auth.py, seed.py)
tests/       pytest unit tests
experiments.md   one line per eval run: version | change | precision | coverage | wrong | notes
```

## Commands

```
python data/generate.py --seed 42          # fake data + answer keys
pytest                                      # unit tests (must pass before any commit)
python evals/run_eval.py --agent matching --split dev
streamlit run app/Home.py
make api                                    # FastAPI locally, Clerk bypassed
TEST_POSTGRES_URL=... pytest                # same tests on Postgres
```

## How to work

- Plan first, then build. Explain the plan and wait for approval on anything structural.
- One feature per change. After each change: run `pytest`, run the relevant eval, add a line
  to `experiments.md`, then commit.
- Iterate on the **dev** split. Run the **test** split only when reporting a final number.
- When an eval case fails, look at its log before changing anything.
