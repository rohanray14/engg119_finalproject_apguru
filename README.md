# Educore Finance Desk

A prototype finance desk for Educore (formerly APGuru) — track every rupee coming in and going out, confirm against the bank, link to the right person, and keep it up to date with AI agents.

## Quick Start

```bash
# Generate fake data and answer keys
python data/generate.py --seed 42

# Run unit tests
pytest

# Run matching eval on dev split
python evals/run_eval.py --agent matching --split dev

# Launch the Streamlit UI
streamlit run app/Home.py
```
