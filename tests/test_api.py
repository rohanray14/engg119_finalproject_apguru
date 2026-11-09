"""API tests: auth, roles, every screen, and the safety of each decision.

Tokens are real RS256 JWTs signed with a key generated here; only the JWKS
download is replaced, so the Clerk verification code runs for real.
Runs on Postgres too when TEST_POSTGRES_URL is set.
"""

from __future__ import annotations

import os
import time

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient

ISSUER = "https://test-clerk.example.com"
FRONTEND = "https://desk.example.com"
_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)


def make_token(role="finance_lead", sub="user_1", email="lead@example.com", **overrides) -> str:
    now = int(time.time())
    claims = {"sub": sub, "iss": ISSUER, "iat": now, "nbf": now, "exp": now + 300,
              "azp": FRONTEND, "email": email}
    if role is not None:
        claims["role"] = role
    claims.update(overrides)
    claims = {k: v for k, v in claims.items() if v is not None}
    return jwt.encode(claims, _key, algorithm="RS256", headers={"kid": "test"})


def auth(role="finance_lead", **kw) -> dict:
    return {"Authorization": f"Bearer {make_token(role, **kw)}"}


class _FakeJWKS:
    def get_signing_key_from_jwt(self, token):
        return type("K", (), {"key": _key.public_key()})()


@pytest.fixture()
def client(tmp_path, monkeypatch):
    pg_url = os.environ.get("TEST_POSTGRES_URL")
    db_url = pg_url or str(tmp_path / "api.db")
    monkeypatch.setenv("DATABASE_URL", db_url)
    monkeypatch.setenv("CLERK_ISSUER", ISSUER)
    monkeypatch.setenv("CLERK_AUTHORIZED_PARTIES", FRONTEND)
    monkeypatch.setenv("CORS_ORIGINS", FRONTEND)
    monkeypatch.delenv("AUTH_DEV_BYPASS", raising=False)
    monkeypatch.setenv("ENV", "test")

    from api import auth as auth_mod
    from api import database, settings
    from api.seed import seed

    settings.get_settings.cache_clear()
    database.close_pool()
    monkeypatch.setattr(auth_mod, "_jwks_client", lambda url: _FakeJWKS())
    seed(db_url, reset=True)

    from api.main import create_app

    with TestClient(create_app(), raise_server_exceptions=False) as c:
        yield c
    database.close_pool()
    settings.get_settings.cache_clear()


def _pending_with_suggestion(client) -> dict:
    items = client.get("/api/review", headers=auth()).json()["items"]
    return next(i for i in items if i["has_suggestion"])


# ---------------------------------------------------------------------------
# Authentication and roles
# ---------------------------------------------------------------------------

class TestAuth:
    def test_health_needs_no_login(self, client):
        assert client.get("/healthz").status_code == 200
        assert client.get("/readyz").status_code == 200

    def test_no_token_is_401(self, client):
        assert client.get("/api/dashboard").status_code == 401

    def test_valid_token(self, client):
        r = client.get("/api/me", headers=auth())
        assert r.status_code == 200
        assert r.json() == {"id": "user_1", "email": "lead@example.com",
                            "role": "finance_lead", "can_approve": True}

    @pytest.mark.parametrize("overrides", [
        {"iss": "https://evil.example.com"},
        {"exp": int(time.time()) - 3600},
        {"azp": "https://other-site.example.com"},
    ])
    def test_bad_tokens_are_401(self, client, overrides):
        assert client.get("/api/me", headers=auth(**overrides)).status_code == 401

    def test_token_signed_by_another_key_is_401(self, client):
        other = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        now = int(time.time())
        token = jwt.encode({"sub": "x", "iss": ISSUER, "iat": now, "exp": now + 60, "role": "finance_lead"},
                           other, algorithm="RS256")
        assert client.get("/api/me", headers={"Authorization": f"Bearer {token}"}).status_code == 401

    def test_user_without_role_is_403(self, client):
        assert client.get("/api/dashboard", headers=auth(role=None)).status_code == 403
        assert client.get("/api/dashboard", headers=auth(role="admin")).status_code == 403

    def test_staff_can_read_but_not_decide(self, client):
        assert client.get("/api/review", headers=auth("staff")).status_code == 200
        item = _pending_with_suggestion(client)
        r = client.post(f"/api/review/{item['match_id']}/approve", headers=auth("staff"))
        assert r.status_code == 403
        assert client.get("/api/audit", headers=auth("staff")).status_code == 403
        r = client.post("/api/commissions/payout/approve", headers=auth("staff"), json={"expected_net_paise": 1})
        assert r.status_code == 403


class TestProductionSettings:
    def test_refuses_unsafe_production_config(self, monkeypatch):
        from api.settings import get_settings

        monkeypatch.setenv("ENV", "production")
        monkeypatch.setenv("AUTH_DEV_BYPASS", "1")
        monkeypatch.setenv("DATABASE_URL", "/tmp/x.db")
        get_settings.cache_clear()
        with pytest.raises(RuntimeError, match="Unsafe production configuration"):
            get_settings()
        get_settings.cache_clear()

    def test_dev_bypass_ignored_in_production(self, monkeypatch):
        from api.auth import current_user
        from api.settings import Settings

        s = Settings(env="production", auth_dev_bypass=True)
        monkeypatch.setattr("api.auth.get_settings", lambda: s)
        req = type("R", (), {"headers": {}})()
        with pytest.raises(Exception) as exc:
            current_user(req)
        assert getattr(exc.value, "status_code", None) == 401


# ---------------------------------------------------------------------------
# Screens
# ---------------------------------------------------------------------------

class TestScreens:
    @pytest.mark.parametrize("path", [
        "/api/meta", "/api/dashboard", "/api/review", "/api/payments", "/api/students",
        "/api/money-out", "/api/risk", "/api/reminders", "/api/commissions", "/api/audit",
    ])
    def test_screen_loads(self, client, path):
        r = client.get(path, headers=auth())
        assert r.status_code == 200, r.text

    def test_money_is_integer_paise(self, client):
        d = client.get("/api/dashboard", headers=auth()).json()
        assert all(isinstance(v, int) for k, v in d["month"].items() if k.endswith("_paise"))
        for p in client.get("/api/payments?limit=20", headers=auth()).json()["items"]:
            assert isinstance(p["amount_paid_paise"], int)
            assert len(p["currency"]) == 3

    def test_payments_filter_and_paging(self, client):
        page = client.get("/api/payments?limit=5&offset=5", headers=auth()).json()
        assert len(page["items"]) == 5 and page["total"] >= 10
        usd = client.get("/api/payments?currency=usd&limit=500", headers=auth()).json()
        assert all(p["currency"] == "USD" for p in usd["items"])

    def test_student_detail(self, client):
        sid = client.get("/api/students?limit=1", headers=auth()).json()["items"][0]["id"]
        d = client.get(f"/api/students/{sid}", headers=auth()).json()
        assert d["id"] == sid and "enrollments" in d
        assert client.get("/api/students/999999", headers=auth()).status_code == 404

    def test_review_item_detail(self, client):
        item = _pending_with_suggestion(client)
        d = client.get(f"/api/review/{item['match_id']}", headers=auth()).json()
        assert d["suggested_installments"]
        assert d["reason_text"]

    def test_ask(self, client):
        r = client.post("/api/ask", headers=auth(), json={"question": "Who owes us the most?"})
        assert r.status_code == 200 and r.json()["answer"]
        assert client.post("/api/ask", headers=auth(), json={"question": "x" * 501}).status_code == 422

    def test_ask_rate_limit(self, client, monkeypatch):
        from api.routers import actions

        monkeypatch.setattr(actions, "_ask_limiter", actions._RateLimiter())
        monkeypatch.setattr(actions, "get_settings", lambda: type("S", (), {"ask_rate_limit_per_minute": 2})())
        h = auth(sub="rate_user")
        codes = [client.post("/api/ask", headers=h, json={"question": "How many payments?"}).status_code
                 for _ in range(3)]
        assert codes == [200, 200, 429]


# ---------------------------------------------------------------------------
# Decisions
# ---------------------------------------------------------------------------

def _match_status(client, match_id):
    return client.get(f"/api/review/{match_id}", headers=auth()).json()["status"]


def _audit_actions(client):
    return [i["action"] for i in client.get("/api/audit?limit=500", headers=auth()).json()["items"]]


class TestDecisions:
    def test_approve_is_logged_with_the_real_user(self, client):
        item = _pending_with_suggestion(client)
        r = client.post(f"/api/review/{item['match_id']}/approve", headers=auth(email="priya@educore.in"))
        assert r.status_code == 200
        top = client.get("/api/audit?limit=1", headers=auth()).json()["items"][0]
        assert top["action"] == "approve_match"
        assert top["actor"] == "priya@educore.in (finance_lead)"
        assert top["entity"] == f"match:{item['match_id']}"
        detail = client.get(f"/api/review/{item['match_id']}", headers=auth()).json()
        assert all(i["status"] == "paid" for i in detail["suggested_installments"])

    def test_cannot_decide_twice(self, client):
        item = _pending_with_suggestion(client)
        assert client.post(f"/api/review/{item['match_id']}/approve", headers=auth()).status_code == 200
        assert client.post(f"/api/review/{item['match_id']}/approve", headers=auth()).status_code == 409
        assert client.post(f"/api/review/{item['match_id']}/reject", headers=auth(), json={}).status_code == 409
        assert _audit_actions(client).count("approve_match") == 1

    def test_failed_decision_changes_nothing(self, client, monkeypatch):
        """If anything fails mid-approval, the match, installments and audit
        log are all left exactly as they were."""
        from api.routers import review

        item = _pending_with_suggestion(client)
        before = len(_audit_actions(client))

        def boom(conn):
            raise RuntimeError("simulated failure")

        monkeypatch.setattr(review, "recompute_commissions", boom)
        r = client.post(f"/api/review/{item['match_id']}/approve", headers=auth())
        assert r.status_code == 500
        assert "simulated" not in r.text  # no internals leaked
        assert _match_status(client, item["match_id"]) == "pending_review"
        detail = client.get(f"/api/review/{item['match_id']}", headers=auth()).json()
        assert all(i["status"] != "paid" for i in detail["suggested_installments"])
        assert len(_audit_actions(client)) == before

    def test_assign_checks_currency_and_paid(self, client):
        items = client.get("/api/review", headers=auth()).json()["items"]
        item = items[0]
        d = client.get(f"/api/review/{item['match_id']}", headers=auth()).json()
        inst_id = d["other_candidates"][0]["installment_id"] if d["other_candidates"] else None
        if inst_id is None:
            pytest.skip("no same-amount candidate in demo data")
        r = client.post(f"/api/review/{item['match_id']}/assign", headers=auth(), json={"installment_id": inst_id})
        assert r.status_code == 200
        # The installment is now paid; assigning another payment to it is refused
        other = next(i for i in client.get("/api/review", headers=auth()).json()["items"])
        r = client.post(f"/api/review/{other['match_id']}/assign", headers=auth(), json={"installment_id": inst_id})
        assert r.status_code == 409

    def test_reject(self, client):
        item = client.get("/api/review", headers=auth()).json()["items"][0]
        r = client.post(f"/api/review/{item['match_id']}/reject", headers=auth(), json={"note": "school trip refund"})
        assert r.status_code == 200
        assert _match_status(client, item["match_id"]) == "rejected"

    def test_bulk_approve_only_listed_high_confidence(self, client):
        items = client.get("/api/review", headers=auth()).json()["items"]
        high = [i["match_id"] for i in items if i["confidence"] >= 0.9 and i["has_suggestion"]]
        low = [i["match_id"] for i in items if i["confidence"] < 0.9][:1]
        r = client.post("/api/review/bulk-approve", headers=auth(), json={"match_ids": high[:2] + low})
        body = r.json()
        assert r.status_code == 200
        assert body["approved"] == high[:2]
        assert [s["match_id"] for s in body["skipped"]] == low

    def test_payout_requires_the_total_shown_and_only_once(self, client):
        def inr():
            totals = client.get("/api/commissions", headers=auth()).json()["totals"]
            return next(t for t in totals if t["currency"] == "INR")

        payable = inr()["payable_paise"]
        assert payable > 0
        body = {"currency": "INR", "expected_payable_paise": payable + 1}
        assert client.post("/api/commissions/payout/approve", headers=auth(), json=body).status_code == 409
        body["expected_payable_paise"] = payable
        r = client.post("/api/commissions/payout/approve", headers=auth(), json=body)
        assert r.status_code == 200 and r.json()["approved_net_paise"] == payable
        # Nothing left to pay: approving again would mean paying twice.
        assert inr()["payable_paise"] == 0
        assert client.post("/api/commissions/payout/approve", headers=auth(), json=body).status_code == 409

    def test_rate_change_after_payout_only_pays_the_difference(self, client):
        """Reviewer's repro: changing one rate used to make the whole total
        approvable again, including lines already approved."""
        def inr():
            return next(t for t in client.get("/api/commissions", headers=auth()).json()["totals"]
                        if t["currency"] == "INR")

        first = inr()["payable_paise"]
        client.post("/api/commissions/payout/approve", headers=auth(),
                    json={"currency": "INR", "expected_payable_paise": first})
        c = next(c for c in client.get("/api/commissions", headers=auth()).json()["counselors"]
                 if any(a["currency"] == "INR" and a["net_paise"] > 0 for a in c["amounts"]))
        before_net = next(a["net_paise"] for a in c["amounts"] if a["currency"] == "INR")
        client.post(f"/api/commissions/counselors/{c['id']}/rule", headers=auth(),
                    json={"rate_bps": c["rule"]["rate_bps"] + 100})
        c2 = next(x for x in client.get("/api/commissions", headers=auth()).json()["counselors"] if x["id"] == c["id"])
        after_net = next(a["net_paise"] for a in c2["amounts"] if a["currency"] == "INR")
        assert inr()["payable_paise"] == after_net - before_net > 0

    def test_commissions_never_mix_currencies(self, client):
        d = client.get("/api/commissions", headers=auth()).json()
        currencies = [t["currency"] for t in d["totals"]]
        assert len(currencies) == len(set(currencies))
        assert len(currencies) > 1, "demo data has commissions in more than one currency"
        for c in d["counselors"]:
            assert all({"currency", "net_paise"} <= set(a) for a in c["amounts"])
        dash = client.get("/api/dashboard", headers=auth()).json()
        assert sorted(x["currency"] for x in dash["commissions"]) == sorted(currencies)

    def test_hand_set_rule_is_used_in_the_math(self, client):
        before = client.get("/api/commissions", headers=auth()).json()
        c = next(c for c in before["counselors"] if any(a["net_paise"] > 0 for a in c["amounts"]))
        new_bps = 100 if c["rule"]["rate_bps"] > 100 else 200
        r = client.post(f"/api/commissions/counselors/{c['id']}/rule", headers=auth(), json={"rate_bps": new_bps})
        assert r.status_code == 200
        after = next(x for x in client.get("/api/commissions", headers=auth()).json()["counselors"]
                     if x["id"] == c["id"])
        assert after["rule"]["source"] == "finance_lead"
        assert after["rule"]["rate_bps"] == new_bps
        assert after["amounts"] != c["amounts"]
        assert "set_commission_rule" in _audit_actions(client)
        assert "rebuild_commissions" in _audit_actions(client)

    def test_unsupported_rule_scope_is_refused(self, client):
        cid = client.get("/api/commissions", headers=auth()).json()["counselors"][0]["id"]
        r = client.post(f"/api/commissions/counselors/{cid}/rule", headers=auth(),
                        json={"rate_bps": 1000, "scope": "city"})
        assert r.status_code == 422

    def test_reminder_approval_once(self, client):
        rem = client.get("/api/reminders", headers=auth()).json()["items"][0]
        body = {"installment_id": rem["installment_id"], "reminder_type": rem["reminder_type"]}
        assert client.post("/api/reminders/approve", headers=auth(), json=body).status_code == 200
        assert client.post("/api/reminders/approve", headers=auth(), json=body).status_code == 409


# ---------------------------------------------------------------------------
# Partial payments, bulk approve, concurrency
# ---------------------------------------------------------------------------

def _db(client):
    from api.settings import get_settings
    from ledger.db import get_connection

    return get_connection(get_settings().database_url)


def _insert_pending(conn, amount_paise, installment_id, confidence):
    """Add a fake payment + pending suggestion (test fixture, not answer-key data)."""
    cur_row = conn.execute("SELECT currency FROM installment WHERE id = ?", (installment_id,)).fetchone()
    pid = conn.execute("SELECT COALESCE(MAX(id), 0) + 1000 FROM payment_in").fetchone()[0]
    conn.execute(
        "INSERT INTO payment_in (id, source, method, payer_name, date, amount_paid_paise, currency, confirmation) "
        "VALUES (?, 'bank', 'neft', 'Test Payer', '2025-12-01', ?, ?, 'in_bank')",
        (pid, amount_paise, cur_row[0]))
    conn.execute(
        "INSERT INTO match_result (payment_id, allocations, method, confidence, reason, status) "
        "VALUES (?, ?, 'rules', ?, 'test_fixture', 'pending_review')",
        (pid, '[{"installment_id": %d, "allocated_paise": 0}]' % installment_id, confidence))
    mid = conn.execute("SELECT MAX(id) FROM match_result").fetchone()[0]
    conn.commit()
    return mid


def _open_installment(conn, skip=0):
    return conn.execute(
        "SELECT id, amount_due_paise FROM installment i WHERE status = 'open' AND NOT EXISTS ("
        "  SELECT 1 FROM match_result mr WHERE mr.allocations LIKE '%' || i.id || '%') "
        "ORDER BY id LIMIT 1 OFFSET ?", (skip,)).fetchone()


class TestPartialPayments:
    def test_part_payment_leaves_installment_partial_then_paid(self, client):
        conn = _db(client)
        inst = _open_installment(conn)
        half = inst["amount_due_paise"] // 2
        m1 = _insert_pending(conn, half, inst["id"], 0.85)
        conn.close()

        r = client.post(f"/api/review/{m1}/approve", headers=auth())
        assert r.status_code == 200, r.text
        assert r.json()["installment_changes"] == [{"installment_id": inst["id"], "from": "open", "to": "partial"}]
        detail = client.get(f"/api/review/{m1}", headers=auth()).json()
        assert detail["suggested_installments"][0]["remaining_paise"] == inst["amount_due_paise"] - half

        conn = _db(client)
        m2 = _insert_pending(conn, inst["amount_due_paise"] - half, inst["id"], 0.85)
        conn.close()
        r = client.post(f"/api/review/{m2}/approve", headers=auth())
        assert r.json()["installment_changes"] == [{"installment_id": inst["id"], "from": "partial", "to": "paid"}]

        actions = client.get("/api/audit?limit=50", headers=auth()).json()["items"]
        assert any(a["entity"] == f"installment:{inst['id']}" and a["new_value"] == "paid" for a in actions)

    def test_cannot_approve_onto_a_paid_installment(self, client):
        conn = _db(client)
        inst = _open_installment(conn)
        m1 = _insert_pending(conn, inst["amount_due_paise"], inst["id"], 0.85)
        m2 = _insert_pending(conn, inst["amount_due_paise"], inst["id"], 0.85)
        conn.close()
        assert client.post(f"/api/review/{m1}/approve", headers=auth()).status_code == 200
        r = client.post(f"/api/review/{m2}/approve", headers=auth())
        assert r.status_code == 409 and "already paid" in r.json()["detail"]
        assert _match_status(client, m2) == "pending_review"


class TestBulkApprove:
    def test_bulk_approves_listed_high_confidence_items(self, client):
        conn = _db(client)
        a, b = _open_installment(conn, 0), _open_installment(conn, 1)
        m_hi1 = _insert_pending(conn, a["amount_due_paise"], a["id"], 0.93)
        m_hi2 = _insert_pending(conn, b["amount_due_paise"], b["id"], 0.97)
        m_lo = _insert_pending(conn, b["amount_due_paise"], b["id"], 0.60)
        conn.close()
        r = client.post("/api/review/bulk-approve", headers=auth(), json={"match_ids": [m_hi1, m_hi2, m_lo]})
        body = r.json()
        assert body["approved"] == [m_hi1, m_hi2]
        assert body["skipped"] == [{"match_id": m_lo, "reason": "below bulk-approve confidence"}]
        assert _match_status(client, m_hi1) == "approved"
        assert _audit_actions(client).count("bulk_approve_match") == 2


@pytest.mark.skipif(not os.environ.get("TEST_POSTGRES_URL"), reason="needs real concurrent transactions")
class TestConcurrency:
    def test_overlapping_approvals_do_not_double_commissions(self, client):
        """Reviewer's repro: two approvals at once used to leave two full sets
        of commission lines (payout total doubled)."""
        import threading

        items = [i for i in client.get("/api/review", headers=auth()).json()["items"] if i["has_suggestion"]][:6]
        barrier = threading.Barrier(len(items))
        results = []

        def go(mid):
            barrier.wait()
            results.append(client.post(f"/api/review/{mid}/approve", headers=auth()).status_code)

        threads = [threading.Thread(target=go, args=(i["match_id"],)) for i in items]
        [t.start() for t in threads]
        [t.join() for t in threads]
        assert results and all(code in (200, 409) for code in results)

        conn = _db(client)
        lines = conn.execute("SELECT counselor_id, payment_id, COUNT(*) FROM commission_line "
                             "GROUP BY counselor_id, payment_id HAVING COUNT(*) > 1").fetchall()
        assert lines == [], "duplicate commission lines after concurrent approvals"
        from agents.commissions import compute_commissions
        expected = sum(c.net_paise for c in compute_commissions(conn, commit=False))
        actual = conn.execute("SELECT COALESCE(SUM(net_paise),0) FROM commission_line").fetchone()[0]
        conn.rollback()
        conn.close()
        assert actual == expected


class TestSafetyRails:
    @pytest.mark.parametrize("env", [None, "prod", "Production ", "staging"])
    def test_dev_bypass_never_applies_outside_dev(self, monkeypatch, env):
        from api.settings import get_settings

        if env is None:
            monkeypatch.delenv("ENV", raising=False)
        else:
            monkeypatch.setenv("ENV", env)
        monkeypatch.setenv("AUTH_DEV_BYPASS", "1")
        monkeypatch.setenv("DATABASE_URL", "/tmp/x.db")
        get_settings.cache_clear()
        with pytest.raises(RuntimeError):
            get_settings()
        get_settings.cache_clear()

    def test_seed_refuses_a_production_database(self, tmp_path, monkeypatch):
        from api.seed import seed
        from ledger.db import get_connection, set_meta

        url = os.environ.get("TEST_POSTGRES_URL") or str(tmp_path / "prod.db")
        seed(url, reset=True)
        conn = get_connection(url)
        set_meta(conn, "environment", "production")
        conn.commit()
        conn.close()
        try:
            with pytest.raises(SystemExit, match="PRODUCTION"):
                seed(url, reset=True)
        finally:
            if url.startswith("postgres"):
                from ledger import pg
                from ledger.db import SCHEMA_SQL

                pg.reset_schema(url, SCHEMA_SQL).close()  # don't leave a "production" test DB behind


@pytest.mark.skipif(not os.environ.get("TEST_POSTGRES_URL"), reason="Postgres migration flow")
class TestMigration:
    def test_production_needs_migration_then_blocks_seeding(self):
        from api.migrate import migrate
        from api.seed import seed
        from ledger import pg
        from ledger.db import SCHEMA_SQL

        url = os.environ["TEST_POSTGRES_URL"]
        conn = pg.reset_schema(url, SCHEMA_SQL)
        conn.executescript("DROP SCHEMA public CASCADE; CREATE SCHEMA public;")
        conn.commit()
        problems = pg.check_production_ready(conn, SCHEMA_SQL)
        conn.close()
        assert any("missing tables" in p for p in problems)
        pg._schema_ready.discard(url)
        try:
            assert migrate(url, "production") == []
            with pytest.raises(SystemExit, match="PRODUCTION"):
                seed(url, reset=True)
            with pytest.raises(SystemExit, match="can't be re-marked"):
                migrate(url, "demo")
        finally:
            pg.reset_schema(url, SCHEMA_SQL).close()
