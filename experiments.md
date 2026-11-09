version | change | precision | coverage | wrong | notes
v0 | rules baseline (exact amount + fuzzy name + date window) | 77.42% | 11.44% | 7 | low coverage expected — most payments have duplicate common amounts; AI matcher needed
v1 | AI matcher (rules first, shortlist ≤5, LLM judge) — no API key | 77.42% | 11.44% | 7 | same as v0 without API key; 222/247 failures are "ambiguous" (common amounts); AI will resolve
v2 | rules: FIFO tie-break, no confident blank-payer, wider date window (90d), keep same-student installments through date filter | 100.00% | 8.86% | 0 | zero wrong matches; coverage lower but all 24 attempted are correct
v3 | safety: reject ≤0 amounts, suspicious payer text, old dates; global same-amount confidence capping | 100.00% | 1.85% | 0 | safety eval 0/20 violations; dev coverage dropped (stricter capping) but 100% precision maintained
v4 | step 10: reminders (45 generated, 3 types), commissions (terms parser, TDS), risk (70 flags, 6 categories), copilot (13 question patterns) | 100.00% | 1.85% | 0 | 138 tests passing; all 4 agents functional; UI pages added
v5 | AI matcher with Anthropic API (claude-sonnet-4-6), dotenv fix, model ID fix | 45.00% | 7.38% | 11 | AI calling Claude successfully; coverage 4x rules-only; precision needs tuning (AI too aggressive on confidence)
v6 | Phase 0: fix siblings (100%→10.75%), remove label leakage, unified threshold 0.95, oracle analysis | 100.00% | 0.00% | 0 | data regenerated seed=42; identifiability ceiling 43.9%; rules assign max 0.85 for common amounts → 0% coverage at 0.95 threshold (honest); $0
