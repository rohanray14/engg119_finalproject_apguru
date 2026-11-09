.PHONY: data test eval eval-agents app lint clean ci

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

lint:
	ruff check --select E,F,W .
	ruff format --check .

ci: lint test eval-agents

clean:
	rm -f data/_app_ledger.db data/_app_ledger.db-shm data/_app_ledger.db-wal
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
