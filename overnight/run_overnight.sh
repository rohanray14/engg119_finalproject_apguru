#!/usr/bin/env bash
# Runs Claude Code headless in a loop until OVERNIGHT.md is finished or the attempt cap is hit.
# Each restart resumes from PROGRESS.md. Run from the repo root, in a FRESH CLONE (not your main
# working copy), with an ANTHROPIC_API_KEY that has a spend limit set in the Console.
#
#   chmod +x run_overnight.sh && ./run_overnight.sh
set -u
mkdir -p logs/overnight
git fetch origin
git checkout -B overnight/production-hardening origin/main 2>/dev/null || git checkout overnight/production-hardening

for i in $(seq 1 10); do
  echo "=== attempt $i  $(date) ===" | tee -a logs/overnight/runner.log
  claude -p "$(cat overnight/OVERNIGHT.md)" \
    --dangerously-skip-permissions \
    --max-turns 250 \
    > "logs/overnight/attempt_$i.log" 2>&1
  if grep -q "ALL PHASES COMPLETE" PROGRESS.md 2>/dev/null; then
    echo "done after $i attempts" | tee -a logs/overnight/runner.log
    break
  fi
  sleep 30
done
