# Educore Finance Desk

A finance operations platform for Educore (formerly APGuru), an Indian tutoring company that collects fees from families in India and abroad. Built for the company's finance lead to track every rupee in and out, reconcile against the bank, and manage collections with AI-assisted matching.

## Architecture

```
Browser (Next.js + Clerk auth)
    │  Authorization: Bearer <session token>
    ▼
FastAPI (api/)  ──►  SQLite (dev) / Postgres via Neon (prod)
    │
    ├── Rule-based + AI payment matching
    ├── Commission calculations (integer basis points)
    ├── Reminder generation
    └── Risk flagging
```

**Stack:** Next.js (App Router) + TypeScript + Tailwind CSS | FastAPI + Python 3.11 | Clerk auth | SQLite (dev) / Postgres (prod) | Anthropic API for AI matching

## Pages

| Page | What it does |
|---|---|
| **Today** | Daily dashboard: collections, pending reviews, overdue count, recent activity |
| **Payments** | Searchable ledger of all incoming payments with filters by source, currency, match status |
| **Review** | Queue of AI-suggested payment-to-installment matches for approval, rejection, or reassignment |
| **Students** | Student directory with enrollment details, installment schedules, and payment history |
| **Money Out** | Outgoing payments (refunds, vendor costs, commissions) with month-range filtering |
| **Commissions** | Counselor commission rules, earned amounts, payout approval with per-counselor statements |
| **Reminders** | Overdue and upcoming payment reminders with message preview and send actions |
| **Insights** | Business analytics: collection rates, revenue by program/geography/fee model, MoM trends |
| **Risk** | Flagged items by severity (overdue, duplicates, unverified large payments) with date filtering |
| **Audit** | Chronological log of every decision, approval, and system action |

## Quick start

### Prerequisites

- Python 3.11+
- Node.js 20.9+
- An Anthropic API key (optional, for AI matching)

### Backend (FastAPI)

```bash
pip install -e ".[dev,api]"
python data/generate.py --seed 42   # generate fake data + answer keys
make seed                            # load into database
make api                             # API on :8000, Clerk auth bypassed locally
```

### Frontend (Next.js)

```bash
cd web
npm install
npm run dev                          # Dev server on :3000
```

Set `NEXT_PUBLIC_API_URL=http://localhost:8000/api` in `web/.env.local`.

### Tests and evals

```bash
pytest                               # unit tests (SQLite)
make eval                            # matching eval (dev + safety splits)
make eval-agents                     # commissions, reminders, risk, copilot evals
```

## Configuration

| Env var | Purpose | Default |
|---|---|---|
| `DATABASE_URL` | Database connection | `data/ledger.db` (SQLite) |
| `ANTHROPIC_API_KEY` | AI matcher | _(unset = rules only)_ |
| `CLERK_SECRET_KEY` | Clerk auth (production) | _(bypassed locally)_ |
| `NEXT_PUBLIC_API_URL` | API base URL for frontend | `http://localhost:8000/api` |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk frontend key | _(bypassed locally)_ |

## Key design rules

- **Money is integer paise** with a currency code. No floats. The frontend formats with `Intl.NumberFormat("en-IN")`.
- **Dates are DD/MM (Indian format).** Never parsed as MM/DD.
- **AI suggests, humans approve.** Matches below the confidence threshold, payouts, and refunds require finance lead approval.
- **Every decision is atomic** — one transaction with its audit entry, protected by `decision_lock`. Concurrent decisions on the same item return 409.
- **Code does all money math.** GST, gateway fees, FX conversion, TDS, and commissions are deterministic Python with unit tests. The LLM never calculates.
- **Fake data only in the repo.** Real data lives in `real_data/` (gitignored) and is never sent to an LLM.

## Folder layout

```
api/         FastAPI production API (routers/, auth.py, seed.py, allocation.py)
web/         Next.js frontend (App Router, TypeScript, Tailwind)
ledger/      Schema, DB layer, money math, data loading, balances
agents/      Matching (rules + AI), reminders, commissions, risk, copilot
data/        generate.py, generated CSVs, answer keys (dev/ and test/ splits)
evals/       Scored eval harnesses with JSON answer keys
tests/       pytest unit tests + hypothesis property tests
app/         Legacy Streamlit prototype (still works, being replaced)
docs/        SPEC.md, HANDOFF.md, DEPLOY.md, design PDF
logs/        LLM call logs + cache
results/     One JSON/Markdown report per eval run
```

## Deployment

Production: Vercel (frontend) + Google Cloud Run (API) + Neon (Postgres) + Clerk (auth).

See [docs/DEPLOY.md](docs/DEPLOY.md) for the full deployment guide.

## Eval results

| Metric | Value |
|---|---|
| Precision (test split) | 100% |
| Coverage (test split) | 3.33% |
| Wrong confident matches | 0 |
| Safety violations | 0/25 |

See [REPORT.md](REPORT.md) for the full production-hardening report.
