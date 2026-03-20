import pytest
from app.services.billing_service import billing_service

@pytest.mark.asyncio
async def test_create_checkout_session():
    user_id = "test-user-id"
    plan = "pro"
    url = await billing_service.create_checkout_session(user_id, plan)
    
    assert "checkout.stripe.com" in url
    assert plan in url
    assert user_id in url

@pytest.mark.asyncio
async def test_handle_webhook():
    payload = {
        "type": "checkout.session.completed",
        "data": {
            "object": {
                "client_reference_id": "test-user-id"
            }
        }
    }
    
    success = await billing_service.handle_webhook(payload, "test-signature")
    assert success is True
