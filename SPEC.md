# Educore Finance Desk — Spec

## 1. Context

Educore (formerly APGuru) is an Indian tutoring company (SAT, AP, IB, IGCSE/A Level, GMAT,
GRE, etc.) with ~1,230 students in India, the USA, the UAE, Singapore and elsewhere. All bank
accounts and operations are in India, so every fee must end up in an Indian bank account.

Two pricing models:
- **Packages** (SAT, AP, AMC, TMUA, GMAT, GRE): paid upfront or in 2 installments ~2 months apart.
- **Hourly** (IB, IGCSE, A Levels): prepay 10 or 40 hours, then top up.

Indian fees carry **18% GST** (e.g. ₹2,36,000 + GST = ₹2,78,480; half installment ₹1,39,240;
10 hours ₹35,000 + GST = ₹41,300). Overseas students pay in USD, AED, etc.

Independent **counselors** refer students and earn a commission on fees received
(e.g. 10% or 20%; per student, city-wide, or split between two referrers). Refunds are deducted
from later commission. **2% TDS** is withheld before paying a counselor.

Today: staff ask for payment on WhatsApp → parent sends a screenshot → screenshot counts as
proof → staff type it into an Excel tracker → reminders sent by hand.

## 2. Main problems

1. **Many ways to pay:** NEFT, UPI, cash, cheque, cards via PayGlocal, Stripe, Razorpay, and
   foreign-currency bank accounts; 10+ currencies (mostly INR, USD, AED). Nothing unifies them.
2. **Charges change the amount:** gateway fees (~1.5–3.5%), GST on fees, FX differences, and
   TDS some company payers withhold. Family's payment ≠ tracker figure ≠ money in bank.
   Overseas payments can take a week+ to arrive.
3. **No real confirmation:** a WhatsApp screenshot counts as proof; nothing is checked
   against the bank or gateway.
4. **Hard to tell who paid:** payer is usually a parent or company, not the student (and blank
   half the time). No shared ID across files. Standard amounts repeat, so amount alone
   can't identify the payer.
5. **One payment ≠ one row:** one family payment covers several children/subjects; one fee
   arrives in installments or hourly top-ups.
6. **No one knows who still owes:** total fee missing in ~70% of tracker rows; "Full Paid"
   sometimes wrong; balances hidden in notes.
7. **Reminders are manual:** sent by hand on WhatsApp; second installments and top-ups missed.
8. **Commissions done by hand:** free-text terms per counselor; depend on payments being
   matched first; refunds and TDS applied manually.
9. **Money going out isn't tracked:** faculty pay, rent, ads, taxes, software, refunds and
   commissions aren't linked to anything.
10. **Messy records:** Excel misread dd/mm dates as mm/dd; mixed text date formats; duplicates;
    values in wrong columns; inconsistent names.

## 3. Real-data patterns the fake data must copy

(Measured from the real files. No real names or details are used anywhere in this project.)

**Payment methods (tracker):** NEFT ~35%, Stripe ~23%, PayGlocal ~20%, blank ~12%,
cash ~6%, Razorpay ~2%, cheque/other <1%.

**Common amounts (INR, GST-inclusive):** 1,77,000 (most common), 2,36,000, 1,50,000, 41,300,
1,18,000, 2,24,200, 1,41,600, 59,000, 2,47,800, 2,78,480, 1,39,240.
**Foreign:** USD 400 (10-hour block, most common), AED 1,500, USD 2,600 (SAT package),
USD 1,400/1,800/2,400, AED 4,800/9,000. Top 10 INR amounts cover ~50% of payments.

**Payer:** blank in ~50% of rows. When filled: ~93% a different person than the student
(parent), ~6% a company, ~1–2% the student.

**Messiness to reproduce:**
- Dates: mostly dd/mm/yyyy text; also dd.mm.yyyy and dd.mm.yy; some "16 Sept" style.
- Amount cells: "1,77,000", "4100 AED", "400 USD", "2L+GST", "90,000+GST", "$400/ 10 hours",
  "Paid Full" (status in amount column), "1500 AED + 1500 AED" (two payments in one cell).
- Due-date column holds statuses ("paid full", "paid hrly") more often than dates; typos
  ("hlry", "piad").
- Names: ~7% first-name only, misspellings, tags like "(old)" or "(Sat Math)".
- One family payment copied onto every sibling/subject row.
- Some company payers withhold 10% TDS (payment arrives at ~108% of base instead of 118%).

**Student list:** has a numeric Student ID (the only real key). Status per course:
Full Paid or Hourly (no installment status). Country/city messy ("Dubai" in country column,
Bangalore/Bengaluru).

**Gateway fee assumptions (configurable, unconfirmed):** PayGlocal international card 2.75%,
PayGlocal INR card 1.25%, Stripe 3%, Razorpay 3%, bank transfer 0.5%; 18% GST on the fee.
Real gateways deposit in **batches, net of fees**, converted at their own FX rate, 1–3+ days later.

**Bank statement narration format:** `NEFT/<ref>/<PAYER NAME>/FEE`, `UPI/...`, `IMPS/...`,
`CASH/...`, `FX INWARD/PAYGLOCAL/<ref>/<NAME>/FEE`. Debits: faculty payout, rent, ads, GST
payment, software, utilities.

## 4. Data model (ledger)

- **Student**: id, name, aliases, city, country, counselor_id(s), parent/payer aliases
- **Enrollment/Fee**: student_id, program, model (package|hourly), total_fee, currency, GST flag
- **Installment**: enrollment_id, due_date, amount_due, status (open|partial|paid|overdue)
- **PaymentIn**: id, source (bank|gateway|cash|screenshot), method, payer_name, date,
  amount_paid + currency, deductions {gateway_fee, gst_on_fee, fx_diff, tds},
  amount_in_bank (INR), confirmation (screenshot_only | seen_by_gateway | in_bank)
- **Match**: payment_id → one or more installment_ids with allocated amounts; method
  (rules|ai|human); confidence; reason; status (auto|pending_review|approved|rejected)
- **Counselor**: id, name, terms_text, parsed_rule {rate, scope: own_referrals|city, city, split}
- **CommissionLine**: counselor_id, payment_id, base, rate, commission, refund_deduction, tds, net
- **PaymentOut**: id, date, payee, category (faculty|commission|refund|rent|ads|tax|software|other), amount
- **Reminder**: installment_id, scheduled_for, channel (whatsapp, simulated), text, status
- **AuditLog**: timestamp, actor (user|agent name), action, entity, old, new

## 5. Agents

All agents read the ledger; only approved actions write to it.

| Agent | Solves | Input → output | AI's part |
|---|---|---|---|
| **Payment Matching** | 3, 4, 5 | payment + shortlist of candidate installments → {installment_ids + allocations or "unsure", confidence, reason} | Judging parent/company payers, misspellings, group payments |
| **Reminders** | 6, 7 | open installments + schedule rules → reminder messages + send times | Writing the message; reading replies like "paid yesterday" |
| **Commissions** | 8 | counselor terms text → structured rule; code then computes payouts | Parsing free-text terms only |
| **Risk** | 3, 6, 10 | ledger → flags with severity and explanation | Spotting suspicious messages; explaining flags |
| **Copilot** | all | question → answer + cited transactions; daily briefing; cash forecast | Understanding the question, choosing queries, explaining |

Matching pipeline: (1) exact rules → (2) code shortlists ≤5 candidates (amount within
GST/fee/FX/TDS tolerances, date window, fuzzy name, payer alias) → (3) LLM chooses or says
"unsure" → (4) confidence ≥ threshold auto-matches, else review queue.

Reminder schedule (default): 3 days before due, on due date, 7 days after; 3rd reminder or any
dispute needs approval.

## 6. Screens (Streamlit)

1. **Today:** AI briefing, key totals (received, unmatched, overdue, commissions due),
   "needs your decision" list, cash forecast.
2. **Payments:** every payment with amount paid / deductions / amount in bank, method,
   confirmation level, match status; filters.
3. **Review queue:** one payment at a time: bank line, AI suggestion + reason + confidence,
   other candidates, Approve / Pick another / Not a fee.
4. **Students:** one searchable list (paid, owed, status, next due); click a name → detail
   (enrollments, installments, payments, reminders).
5. **Commissions:** counselors with terms text, parsed rule, earned, TDS, net, status;
   click → statement; Approve payout.
6. **Money out:** debits by category.
7. **Ask:** chat box; answers show a table of the underlying transactions.

## 7. Evals

| Agent | Test set | Metrics | Target |
|---|---|---|---|
| Matching | generated payments with answer key, tagged by case type | precision of auto-matches, coverage, wrong confident matches, per-case-type breakdown | precision ≥98%, coverage ≥80%, beats rules baseline |
| Matching safety | hand-made tricky cases (same-amount siblings, identical names, new-bank-details message) | wrong confident matches | 0 |
| Reminders | generated installments | right families, amounts, dates (code); message quality (LLM judge, validated on ~30 hand labels) | 100% correct targets |
| Commissions | ~30 terms texts with hand-written rules + hand-calculated payouts | rule parse accuracy; exact payout match | 100% payouts exact |
| Risk | ledger with planted problems | recall of planted issues, false alarms | high recall, few false alarms |
| Copilot | ~30 questions with known answers | correct number + correct transactions cited | ≥90% |

Always run the **rules-only baseline** first. Track cost and latency per run.
