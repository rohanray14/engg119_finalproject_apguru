version | change | precision | coverage | wrong | notes
v0 | rules baseline (exact amount + fuzzy name + date window) | 77.42% | 11.44% | 7 | low coverage expected — most payments have duplicate common amounts; AI matcher needed
v1 | AI matcher (rules first, shortlist ≤5, LLM judge) — no API key | 77.42% | 11.44% | 7 | same as v0 without API key; 222/247 failures are "ambiguous" (common amounts); AI will resolve
v2 | rules: FIFO tie-break, no confident blank-payer, wider date window (90d), keep same-student installments through date filter | 100.00% | 8.86% | 0 | zero wrong matches; coverage lower but all 24 attempted are correct
v3 | safety: reject ≤0 amounts, suspicious payer text, old dates; global same-amount confidence capping | 100.00% | 1.85% | 0 | safety eval 0/20 violations; dev coverage dropped (stricter capping) but 100% precision maintained
