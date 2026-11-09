# Handoff: production rebuild

Read this before working on the production rebuild. Last updated 9 Nov 2026.

## Where things stand

The goal is to turn the Streamlit prototype into a production site for real users
(Educore's finance lead and staff).

Chosen stack: **Next.js on Vercel + Clerk sign-in + FastAPI on Google Cloud Run + Postgres on Neon.**

| Step | Status |
|---|---|
| 1. Backend API (`api/`), Postgres support, Clerk roles, deploy files | **Done.** Branch `production/api-backend`, not merged to `main` yet |
| 2. Next.js front end (`web/`) | **Next.** Not started |
| 3. Hardening: error monitoring (e.g. Sentry), backups test, uptime check | Not started |
| 4. Real-data onboarding: ingestion path, retire the fake-data-only rule safely | Not started |

The Streamlit app (`app/`) still works and is what's live on Render. Leave it alone
until the new site replaces it.

## Decisions already made (don't silently change)

- **Auto-match threshold is 0.95** (`config.py`). The Streamlit app auto-approved from
  0.80, which is below what the evals were run at (experiments.md v10: precision is
  82% at 0.85). On the demo data this means 13 auto and 84 for review.
- **Money leaves the API as integer paise plus a currency code.** The front end
  formats it. Never add amounts in different currencies; show one figure per currency.
- **Commission math is in integer basis points** (`agents/commissions.py` `apply_bps`).
- **Roles come from Clerk `public_metadata.role`**: `finance_lead` can decide, `staff`
  is read-only, no role means no access.
- **Every decision is one transaction with its audit entry**, under `decision_lock`.
  A decision on a match that's no longer pending returns 409. Keep this pattern for
  any new write endpoint.
- **Payments are allocated against what each installment still owes**
  (`api/allocation.py`, `ledger/balances.py`). A part-payment leaves it `partial`.
- **Payout approval** sends the payable total shown on screen; the API refuses if it
  changed. Each payout records its lines, so later payouts only contain new money.
- **Production DB access:** the API connects as a restricted role. Schema changes run
  separately as the owner via `python -m api.migrate --environment production`.
  See `docs/DEPLOY.md`.

## Open items for the finance lead to decide

1. `tests/test_production.py::test_gap_detection` is skipped on Postgres only. That test
   deletes an audit row, and Postgres now blocks the delete itself. It still runs
   unchanged on SQLite, and a Postgres test proves the delete is refused.
   **Needs the owner's OK** (CLAUDE.md rule 5).
2. On the dev split, the rules matcher makes **2 confident wrong matches** at 0.95. This
   was already true before the rebuild (experiments.md v13). Fix it before real data goes in.
3. **Foreign-currency payments aren't in the dashboard's monthly totals**, which count
   INR only. Adding them needs FX conversion in code.
4. **City-scoped commission rules are rejected** because the commission math doesn't
   apply scope yet. Implement it, or keep rejecting it.
5. **Data from before the rebuild:** matches created by the prototype recorded
   `allocated_paise: 0`. Any database not seeded fresh needs a one-off backfill of
   allocations before go-live.

## Step 2 brief: the Next.js front end

**Where:** a new `web/` folder in this repo. Next.js (App Router), TypeScript, Tailwind,
`@clerk/nextjs`. Deploy on Vercel with the project root set to `web/`.

**Design:** follow `docs/Educore Finance Desk — App Screens.pdf`. The Streamlit pages
in `app/pages/` show what each screen contains. Make it work on mobile, with loading,
empty and error states on every screen.

**Auth:** wrap the app in Clerk. Call the API with
`Authorization: Bearer ${await getToken()}`.
- Read `GET /api/me` for `role` and `can_approve`.
- Hide or disable decision buttons for staff. The API enforces this too.
- A 403 with "not been given access" should show a friendly "ask the finance lead" page.

**API base URL:** `NEXT_PUBLIC_API_URL`. Locally, run `make api` (port 8000) with Clerk
bypassed, after `make seed`.

**Screens and endpoints** (all under `/api`; interactive docs at `http://localhost:8000/docs`):

| Screen | Read | Actions (finance lead) |
|---|---|---|
| Today | `GET /dashboard?as_of=`, `GET /meta` | none |
| Payments | `GET /payments?source&currency&confirmation&match&search&limit&offset` | none |
| Review queue | `GET /review`, `GET /review/{id}` | `POST /review/{id}/approve`; `/assign {installment_id}`; `/reject {note}`; `POST /review/bulk-approve {match_ids}` |
| Students | `GET /students?search&limit&offset`, `GET /students/{id}` | none |
| Commissions | `GET /commissions`, `GET /commissions/counselors/{id}/statement` | `POST /commissions/counselors/{id}/rule {rate_bps}`; `POST /commissions/payout/approve {currency, expected_payable_paise}` |
| Money out | `GET /money-out?category&currency` | none |
| Reminders | `GET /reminders?as_of&type&approval` | `POST /reminders/approve {installment_id, reminder_type}` |
| Risk | `GET /risk?as_of&severity` | none |
| Ask | none | `POST /ask {question}` (rate limited; handle 429) |
| Audit log | `GET /audit?before_id` (finance lead only) | none |

**Front-end rules:**
- **Formatting money:** format paise with `Intl.NumberFormat("en-IN", {style: "currency", currency})`,
  which gives Indian grouping (₹1,23,456).
- **Dates:** the API sends ISO dates; display them as DD/MM/YYYY.
- **Bulk approve:** send exactly the ids the user saw and ticked, never "everything above 90%".
- **Payout:** send the `payable_paise` value that was displayed.
- **409 responses:** show the message and refetch, because someone else already decided.
- **Generated types:** generate TypeScript types from `/openapi.json` (e.g. `openapi-typescript`)
  rather than hand-writing them.

## Local setup

```bash
git checkout production/api-backend
pip install -e ".[dev,api]"
make seed && make api              # API on :8000, Clerk bypassed, fake data
make test                          # SQLite
# Postgres tests: TEST_POSTGRES_URL=postgresql://localhost/ledger_test make test-pg
```

## Deploy checklist (needs the owner's accounts)

Neon → `api.migrate` as owner → create the `finance_api` role → Clerk (invite-only,
session token claims, roles) → Cloud Run via `cloudbuild.yaml` → Vercel.
Full steps are in `docs/DEPLOY.md`. Keep keys out of chats and commits; paste them
straight into the Vercel and Cloud Run settings.
