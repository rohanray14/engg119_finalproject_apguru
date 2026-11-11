#!/usr/bin/env bash
set -o errexit

echo "==> Python: $(python --version)"
echo "==> Working dir: $(pwd)"
echo "==> CSV files: $(ls data/*.csv 2>/dev/null | wc -l)"

# Seed if the database is empty (no payments loaded yet)
DB="data/ledger.db"
PAYMENTS=$(python -c "
import sqlite3, os
db='$DB'
if not os.path.exists(db):
    print(0)
else:
    c=sqlite3.connect(db)
    try:
        print(c.execute('SELECT COUNT(*) FROM payment_in').fetchone()[0])
    except:
        print(0)
    c.close()
" 2>/dev/null || echo 0)

echo "==> Payments in DB: $PAYMENTS"

if [ "$PAYMENTS" = "0" ]; then
  echo "==> Seeding database with demo data..."
  rm -f "$DB"
  python -m api.seed --reset
  echo "==> Seed complete"
else
  echo "==> Database has data, skipping seed"
fi

exec uvicorn api.main:app --host 0.0.0.0 --port "${PORT:-10000}" --proxy-headers --forwarded-allow-ips="*" --workers 1
