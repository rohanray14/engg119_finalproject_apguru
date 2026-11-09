#!/usr/bin/env bash
set -o errexit

# Seed the SQLite database if it doesn't exist yet
if [ ! -f data/_app_ledger.db ]; then
  echo "==> Seeding database with demo data..."
  python -m api.seed --reset
fi

exec uvicorn api.main:app --host 0.0.0.0 --port "${PORT:-10000}"
