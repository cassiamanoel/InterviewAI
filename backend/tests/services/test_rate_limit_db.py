from unittest.mock import patch, MagicMock, AsyncMock
from datetime import date
from app.services.rate_limit_service import RateLimitService
import pytest

@pytest.mark.asyncio
async def test_can_consume_free():
    from app.services.rate_limit_service import Limits
    with patch("app.services.rate_limit_service.RateLimitService._get_limits_for_user", new_callable=AsyncMock) as mock_lim:
        mock_lim.return_value = Limits(10, 1000)
        
        with patch("app.services.rate_limit_service.RateLimitService.ensure_usage_row", new_callable=AsyncMock):
            mock_db = AsyncMock()
            mock_scalars_result = MagicMock()
            
            mock_usage = MagicMock()
            mock_usage.requests_used = 0
            mock_usage.tokens_used = 0
            
            mock_scalars_result.first.return_value = mock_usage
            mock_db.scalars.return_value = mock_scalars_result
            
            ok, _ = await RateLimitService.can_consume(mock_db, "user1", date.today(), 1, 0)
            assert ok is True
