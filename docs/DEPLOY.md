# Deploying the Finance Desk

```
Browser ──► Vercel (Next.js front end, Clerk sign-in)
               │  Authorization: Bearer <Clerk session token>
               ▼
          Cloud Run (FastAPI, api/) ──► Neon (Postgres)
```

Everything below fits in the free tiers while you build and test. Vercel's
free Hobby plan is for non-commercial use only, so move the front end to Vercel
Pro (about $20/month) before the business relies on it.

## 1. Database: Neon

1. Create a Neon project in the region closest to your users (India).
2. Copy the connection string (it ends in `?sslmode=require`).
3. Create the tables. They are also created automatically on the API's first request:
   ```
   DATABASE_URL="postgresql://...neon.tech/neondb?sslmode=require" python -c "from ledger.db import get_connection; get_connection().close()"
   ```
4. Optional, for a demo environment only: load the fake data with
   `DATABASE_URL=... python -m api.seed`. Never run this on the database that
   will hold real data.

Neon keeps a short history you can restore from. Before real data goes in, check
the restore window on your plan, and test a restore once.

## 2. Sign-in: Clerk

1. Create a Clerk application and turn on the sign-in methods you want (email + Google is typical).
2. **Restrict who can sign up.** Make sign-up invitation-only (or allowlist your
   company's email domain), so strangers can't create accounts.
3. **Customize the session token** to include the role and email:
   ```json
   { "role": "{{user.public_metadata.role}}", "email": "{{user.primary_email_address}}" }
   ```
4. For each person, set their **public metadata**:
   - finance lead: `{ "role": "finance_lead" }` (can approve)
   - everyone else: `{ "role": "staff" }` (read-only)

   Accounts with no role get "access not granted yet" from the API.
5. Note your **Frontend API URL** (looks like `https://xxx.clerk.accounts.dev`).
   That's `CLERK_ISSUER`.

## 3. API: Google Cloud Run

One-time setup (needs a Google Cloud project with billing enabled; the free
tier still applies, and you should set a budget alert):

```bash
gcloud services enable run.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com secretmanager.googleapis.com
gcloud artifacts repositories create finance-desk --repository-format=docker --location=asia-south1
printf '%s' "postgresql://...neon.tech/neondb?sslmode=require" | \
  gcloud secrets create finance-desk-database-url --data-file=-
# let Cloud Run read the secret
PROJECT_NUMBER=$(gcloud projects describe $(gcloud config get-value project) --format='value(projectNumber)')
gcloud secrets add-iam-policy-binding finance-desk-database-url \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role=roles/secretmanager.secretAccessor
```

Deploy (re-run for every release):

```bash
gcloud builds submit --config cloudbuild.yaml \
  --substitutions=_FRONTEND_URL=https://your-app.vercel.app,_CLERK_ISSUER=https://xxx.clerk.accounts.dev
```

Check it: `curl https://<service-url>/healthz` gives `{"ok":true}`, and
`/api/me` without a token gives 401.

The API **refuses to start** in production if auth is missing, the dev bypass is
on, or the database isn't Postgres. Check the Cloud Run logs if a deploy won't come up.

## 4. Front end: Vercel

(Step 2 of the plan.) Environment variables:

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | from Clerk |
| `CLERK_SECRET_KEY` | from Clerk |
| `NEXT_PUBLIC_API_URL` | the Cloud Run service URL |

## API environment variables

| Variable | Required in production | Meaning |
|---|---|---|
| `ENV` | yes (`production`) | turns on the safety checks, hides `/docs` |
| `DATABASE_URL` | yes | Neon connection string (as a secret) |
| `CLERK_ISSUER` | yes | Clerk Frontend API URL |
| `CLERK_AUTHORIZED_PARTIES` | yes | front-end URL(s), comma separated |
| `CORS_ORIGINS` | yes | front-end URL(s), comma separated |
| `ASK_RATE_LIMIT_PER_MINUTE` | no (20) | per-user limit on the Ask box |
| `AUTH_DEV_BYPASS` | never | local development only |

## Local development

```bash
pip install -e ".[dev,api]"
make seed     # fake data into data/ledger.db
make api      # http://localhost:8000/docs, Clerk bypassed
make test     # SQLite
TEST_POSTGRES_URL=postgresql://localhost/ledger_test make test-pg
```
