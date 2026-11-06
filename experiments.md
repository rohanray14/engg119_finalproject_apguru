version | change | precision | coverage | wrong | notes
v0 | rules baseline (exact amount + fuzzy name + date window) | 77.42% | 11.44% | 7 | low coverage expected — most payments have duplicate common amounts; AI matcher needed
v1 | AI matcher (rules first, shortlist ≤5, LLM judge) — no API key | 77.42% | 11.44% | 7 | same as v0 without API key; 222/247 failures are "ambiguous" (common amounts); AI will resolve
