.PHONY: data test test-pg eval eval-agents app api seed lint clean ci

data:
	python data/generate.py --seed 42

test:
	python -m pytest --tb=short -q

eval:
	python evals/run_eval.py --agent matching --split dev
	python evals/run_eval.py --agent matching --split safety

eval-agents:
	python evals/eval_agents.py --all

app:
	streamlit run app/Home.py

# API for local development: Clerk is bypassed, SQLite file in data/.
api:
	AUTH_DEV_BYPASS=1 uvicorn api.main:app --reload --port 8000

seed:
	python -m api.seed --reset

# Same tests against Postgres, e.g. TEST_POSTGRES_URL=postgresql://localhost/ledger_test make test-pg
test-pg:
	TEST_POSTGRES_URL=$${TEST_POSTGRES_URL:?set TEST_POSTGRES_URL} python -m pytest --tb=short -q

lint:
	ruff check --select E,F,W .
	ruff format --check .

ci: lint test eval-agents

clean:
	rm -f data/_app_ledger.db data/_app_ledger.db-shm data/_app_ledger.db-wal
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
