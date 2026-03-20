import pytest
import asyncio
from app.services.email_service import email_service

@pytest.mark.asyncio
async def test_send_welcome_email():
    result = await email_service.send_welcome_email("user@example.com", "Test User")
    assert result is True

@pytest.mark.asyncio
async def test_send_password_reset():
    result = await email_service.send_password_reset("user@example.com", "token-1234")
    assert result is True
