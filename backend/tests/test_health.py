"""Infrastructure tests — the app boots and can reach PostgreSQL."""

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


@pytest.mark.asyncio
async def test_health():
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        res = await client.get("/health")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    assert body["service"]


@pytest.mark.asyncio
async def test_health_db():
    """Verifies real PostgreSQL connectivity — fails if Supabase is unreachable."""
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        res = await client.get("/health/db")
    assert res.status_code == 200
    assert res.json()["database"] == "connected"
