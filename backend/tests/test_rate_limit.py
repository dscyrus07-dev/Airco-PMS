"""Rate limiter — in-memory fallback semantics (Redis path covered by
integration environments; the fail-open contract is asserted directly)."""

import pytest

from app.core import rate_limit as rl
from app.core.config import settings


@pytest.fixture(autouse=True)
def _enable_and_reset():
    settings.RATE_LIMIT_ENABLED = True
    rl._mem_counts.clear()
    yield
    settings.RATE_LIMIT_ENABLED = False
    rl._mem_counts.clear()


async def test_allows_up_to_limit_then_blocks():
    assert await rl.check_rate_limit("t", "ip1", 2, 60) is True
    assert await rl.check_rate_limit("t", "ip1", 2, 60) is True
    assert await rl.check_rate_limit("t", "ip1", 2, 60) is False
    # a different identity is unaffected
    assert await rl.check_rate_limit("t", "ip2", 2, 60) is True


async def test_scopes_are_independent():
    assert await rl.check_rate_limit("login", "ip1", 1, 60) is True
    assert await rl.check_rate_limit("login", "ip1", 1, 60) is False
    assert await rl.check_rate_limit("signup", "ip1", 1, 60) is True


async def test_disabled_passes_everything():
    settings.RATE_LIMIT_ENABLED = False
    for _ in range(5):
        assert await rl.check_rate_limit("t", "ip1", 1, 60) is True
