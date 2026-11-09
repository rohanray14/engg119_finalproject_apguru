"""API settings, read once from environment variables.

Production refuses to start with unsafe settings (no auth issuer, dev auth
bypass on, SQLite database), so a misconfigured deploy fails loudly instead of
serving financial data openly.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from functools import lru_cache


def _list(name: str) -> list[str]:
    return [v.strip().rstrip("/") for v in os.environ.get(name, "").split(",") if v.strip()]


KNOWN_ENVS = ("development", "test", "production")


@dataclass(frozen=True)
class Settings:
    env: str = "production"
    database_url: str = ""
    clerk_issuer: str = ""
    clerk_jwks_url: str = ""
    clerk_authorized_parties: list[str] = field(default_factory=list)
    cors_origins: list[str] = field(default_factory=list)
    auth_dev_bypass: bool = False
    dev_role: str = "finance_lead"
    ask_rate_limit_per_minute: int = 20

    @property
    def is_production(self) -> bool:
        # Fail closed: anything that isn't explicitly development/test is production.
        return self.env not in ("development", "test")

    @property
    def dev_bypass_active(self) -> bool:
        return self.auth_dev_bypass and self.env in ("development", "test")

    def validate(self) -> None:
        if self.env not in KNOWN_ENVS:
            raise RuntimeError(f"ENV must be one of {', '.join(KNOWN_ENVS)} (got {self.env!r})")
        if not self.is_production:
            return
        problems = []
        if self.auth_dev_bypass:
            problems.append("AUTH_DEV_BYPASS must be off in production")
        if not self.clerk_issuer:
            problems.append("CLERK_ISSUER is required in production")
        if not self.clerk_authorized_parties:
            problems.append("CLERK_AUTHORIZED_PARTIES (your front-end URL) is required in production")
        if not self.database_url.startswith(("postgres://", "postgresql://")):
            problems.append("DATABASE_URL must be a Postgres URL in production")
        if not self.cors_origins:
            problems.append("CORS_ORIGINS (your front-end URL) is required in production")
        if problems:
            raise RuntimeError("Unsafe production configuration: " + "; ".join(problems))


@lru_cache
def get_settings() -> Settings:
    from ledger.db import DATABASE_URL

    issuer = os.environ.get("CLERK_ISSUER", "").rstrip("/")
    s = Settings(
        # Unset means production: a forgotten variable must not open the API.
        env=os.environ.get("ENV", "production").strip().lower(),
        database_url=os.environ.get("DATABASE_URL", DATABASE_URL),
        clerk_issuer=issuer,
        clerk_jwks_url=os.environ.get(
            "CLERK_JWKS_URL", f"{issuer}/.well-known/jwks.json" if issuer else ""
        ),
        clerk_authorized_parties=_list("CLERK_AUTHORIZED_PARTIES"),
        cors_origins=_list("CORS_ORIGINS"),
        auth_dev_bypass=os.environ.get("AUTH_DEV_BYPASS", "").lower() in ("1", "true", "yes"),
        dev_role=os.environ.get("AUTH_DEV_ROLE", "finance_lead"),
        ask_rate_limit_per_minute=int(os.environ.get("ASK_RATE_LIMIT_PER_MINUTE", "20")),
    )
    s.validate()
    return s
