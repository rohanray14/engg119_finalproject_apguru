"""Educore Finance Desk API.

    uvicorn api.main:app --reload        # local, with AUTH_DEV_BYPASS=1

Health checks: ``/healthz`` (process is up) and ``/readyz`` (database reachable).
Everything under ``/api`` needs a signed-in Clerk user with a role.
"""

from __future__ import annotations

import logging
import sys
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi import Depends, FastAPI, Request  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.responses import JSONResponse  # noqa: E402

from api.database import close_pool, get_conn  # noqa: E402
from api.routers import actions, dashboard, ledger_views, review  # noqa: E402
from api.settings import get_settings  # noqa: E402

log = logging.getLogger("finance_desk")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")


@asynccontextmanager
async def lifespan(app: FastAPI):
    get_settings()  # fail fast on unsafe production config
    yield
    close_pool()


def create_app() -> FastAPI:
    s = get_settings()
    app = FastAPI(
        title="Educore Finance Desk API",
        version="1.0.0",
        lifespan=lifespan,
        # Don't publish the API map on the open internet.
        docs_url=None if s.is_production else "/docs",
        redoc_url=None,
        openapi_url=None if s.is_production else "/openapi.json",
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=s.cors_origins or ["http://localhost:3000"],
        allow_credentials=False,
        allow_methods=["GET", "POST"],
        allow_headers=["Authorization", "Content-Type"],
        max_age=600,
    )

    @app.middleware("http")
    async def request_context(request: Request, call_next):
        request_id = request.headers.get("x-request-id") or uuid.uuid4().hex[:16]
        start = time.perf_counter()
        response = await call_next(request)
        ms = (time.perf_counter() - start) * 1000
        response.headers["X-Request-ID"] = request_id
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Cache-Control"] = "no-store"  # financial data: never cache
        if s.is_production:
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        log.info("%s %s %s %.0fms rid=%s", request.method, request.url.path,
                 response.status_code, ms, request_id)
        return response

    @app.exception_handler(Exception)
    async def unhandled(request: Request, exc: Exception):
        # Log the details; never send stack traces or SQL to the browser.
        log.exception("Unhandled error on %s %s", request.method, request.url.path)
        return JSONResponse(status_code=500, content={"detail": "Something went wrong. It has been logged."})

    @app.get("/healthz", include_in_schema=False)
    def healthz():
        return {"ok": True}

    @app.get("/readyz", include_in_schema=False)
    def readyz(conn=Depends(get_conn)):
        conn.execute("SELECT 1").fetchone()
        return {"ok": True}

    for r in (dashboard.router, review.router, ledger_views.router, actions.router):
        app.include_router(r, prefix="/api")
    return app


app = create_app()
