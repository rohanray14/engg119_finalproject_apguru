#!/usr/bin/env bash
set -o errexit

echo "==> Python: $(python --version)"
echo "==> Working dir: $(pwd)"
echo "==> CSV files: $(ls data/*.csv 2>/dev/null | wc -l)"

# Seed the SQLite database if it doesn't exist yet
if [ ! -f data/_app_ledger.db ]; then
  echo "==> Seeding database with demo data..."
  python -m api.seed --reset
  echo "==> Seed complete"
else
  echo "==> Database already exists, skipping seed"
fi

exec uvicorn api.main:app --host 0.0.0.0 --port "${PORT:-10000}"
