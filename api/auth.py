"""Clerk authentication and roles.

The front end sends the Clerk session token as ``Authorization: Bearer <jwt>``.
We verify it against Clerk's public keys (JWKS), check issuer, expiry and the
``azp`` (which front end issued it), then read the user's role.

Roles come from a custom session-token claim.  In the Clerk dashboard
(Sessions -> Customize session token) add:

    { "role": "{{user.public_metadata.role}}", "email": "{{user.primary_email_address}}" }

and set ``public_metadata.role`` on each user to ``finance_lead`` or ``staff``.
Users without one of those roles are refused, so a stray sign-up sees nothing.

Local development only: ``AUTH_DEV_BYPASS=1`` skips Clerk and acts as a fixed
dev user.  Settings refuse to start in production with the bypass on.
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache

import jwt
from fastapi import Depends, HTTPException, Request, status

from api.settings import get_settings

ROLES = ("finance_lead", "staff")


@dataclass(frozen=True)
class User:
    id: str
    email: str
    role: str

    @property
    def is_finance_lead(self) -> bool:
        return self.role == "finance_lead"

    @property
    def audit_actor(self) -> str:
        """Who did it, as written to the audit log."""
        return f"{self.email or self.id} ({self.role})"


@lru_cache
def _jwks_client(url: str) -> jwt.PyJWKClient:
    return jwt.PyJWKClient(url, cache_keys=True, lifespan=3600)


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


def verify_token(token: str) -> dict:
    s = get_settings()
    if not s.clerk_jwks_url:
        raise _unauthorized("Authentication is not configured")
    try:
        key = _jwks_client(s.clerk_jwks_url).get_signing_key_from_jwt(token).key
        claims = jwt.decode(
            token,
            key,
            algorithms=["RS256"],
            issuer=s.clerk_issuer,
            options={"require": ["exp", "iat", "sub", "iss"]},
            leeway=10,
        )
    except jwt.PyJWTError as exc:
        raise _unauthorized("Invalid or expired session") from exc

    azp = claims.get("azp")
    if s.clerk_authorized_parties and azp and azp.rstrip("/") not in s.clerk_authorized_parties:
        raise _unauthorized("Session was issued for a different site")
    if s.is_production and not azp:
        raise _unauthorized("Session is missing its issuing site")
    return claims


def current_user(request: Request) -> User:
    s = get_settings()
    if s.auth_dev_bypass and not s.is_production:
        return User(id="dev-user", email="dev@localhost", role=s.dev_role)

    header = request.headers.get("authorization", "")
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise _unauthorized("Sign in required")

    claims = verify_token(token)
    role = claims.get("role")
    if role not in ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your account has not been given access yet. Ask the finance lead.",
        )
    return User(id=claims["sub"], email=claims.get("email") or "", role=role)


def require_finance_lead(user: User = Depends(current_user)) -> User:
    if not user.is_finance_lead:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the finance lead can approve this.",
        )
    return user
