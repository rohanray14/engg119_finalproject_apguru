#!/usr/bin/env bash
set -o errexit

echo "==> Python: $(python --version)"
echo "==> Working dir: $(pwd)"

# Always regenerate data so dates end at today
echo "==> Generating fresh data (dates ending today)..."
python data/generate.py --seed 42
echo "==> CSV files: $(ls data/*.csv 2>/dev/null | wc -l)"

# Always re-seed so the DB reflects today's data
echo "==> Seeding database with fresh data..."
rm -f data/ledger.db
python -m api.seed --reset
echo "==> Seed complete"

exec uvicorn api.main:app --host 0.0.0.0 --port "${PORT:-10000}" --proxy-headers --forwarded-allow-ips="*" --workers 1
