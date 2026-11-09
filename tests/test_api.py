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
    monkeypatch.delenv("ENV", raising=False)

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

    def test_payout_requires_the_total_shown(self, client):
        total = client.get("/api/commissions", headers=auth()).json()["totals"]["net_paise"]
        assert total > 0
        r = client.post("/api/commissions/payout/approve", headers=auth(), json={"expected_net_paise": total + 1})
        assert r.status_code == 409
        r = client.post("/api/commissions/payout/approve", headers=auth(), json={"expected_net_paise": total})
        assert r.status_code == 200 and r.json()["approved_net_paise"] == total

    def test_hand_set_rule_is_used_in_the_math(self, client):
        before = client.get("/api/commissions", headers=auth()).json()
        c = next(c for c in before["counselors"] if c["net_paise"] > 0)
        new_pct = 1.0 if c["rule"]["rate"] > 0.01 else 2.0
        r = client.post(f"/api/commissions/counselors/{c['id']}/rule", headers=auth(), json={"rate_pct": new_pct})
        assert r.status_code == 200
        after = next(x for x in client.get("/api/commissions", headers=auth()).json()["counselors"] if x["id"] == c["id"])
        assert after["rule"]["source"] == "finance_lead"
        assert after["rule"]["rate"] == pytest.approx(new_pct / 100)
        assert after["net_paise"] != c["net_paise"]
        assert "set_commission_rule" in _audit_actions(client)

    def test_reminder_approval_once(self, client):
        rem = client.get("/api/reminders", headers=auth()).json()["items"][0]
        body = {"installment_id": rem["installment_id"], "reminder_type": rem["reminder_type"]}
        assert client.post("/api/reminders/approve", headers=auth(), json=body).status_code == 200
        assert client.post("/api/reminders/approve", headers=auth(), json=body).status_code == 409
