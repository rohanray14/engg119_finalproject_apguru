# Educore Finance Desk

A prototype finance desk for Educore (formerly APGuru) — track every rupee coming in and going out, confirm against the bank, link to the right person, and keep it up to date with AI agents.

## Results

| Metric | Value |
|---|---|
| Precision (test split) | 100% |
| Coverage (test split) | 3.33% |
| Wrong confident matches | 0 |
| Safety violations | 0/25 |
| Tests passing | 157 |

See [REPORT.md](REPORT.md) for the full production-hardening report.

## Quick Start

```bash
# Install dependencies
pip install -e ".[dev]"

# Generate fake data and answer keys
python data/generate.py --seed 42

# Run unit tests
pytest

# Run all evals
make eval          # matching evals (dev + safety)
make eval-agents   # commissions, reminders, risk, copilot

# Launch the Streamlit UI
streamlit run app/Home.py
```

## Configuration

| Env var | Purpose | Default |
|---|---|---|
| `DATABASE_URL` | SQLite database path | `data/ledger.db` |
| `FINANCE_DESK_PASSWORD` | Enable login gate | _(unset = no auth)_ |
| `ANTHROPIC_API_KEY` | AI matcher (optional) | _(unset = rules only)_ |

## Makefile targets

```
make data          # regenerate fake data (seed 42)
make test          # pytest
make eval          # matching eval (dev + safety)
make eval-agents   # commissions, reminders, risk, copilot evals
make app           # start Streamlit
make lint          # ruff check + format
make ci            # lint + test + eval-agents
make clean         # remove temp DB and __pycache__
```

## Architecture

- **Ledger** (`ledger/`): SQLite schema, money math (integer paise), data loading, reconciliation
- **Agents** (`agents/`): matching (rules + AI), reminders, commissions, risk, copilot
- **Evals** (`evals/`): scored eval harnesses with JSON answer keys
- **App** (`app/`): Streamlit UI with dashboard, review queue, and agent pages
- **Tests** (`tests/`): pytest unit tests + hypothesis property tests
