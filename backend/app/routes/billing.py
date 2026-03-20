from fastapi import APIRouter, Depends, Request, HTTPException
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.core.security import get_current_user
from app.db.models import User
from app.services.billing_service import billing_service

router = APIRouter(prefix="/billing", tags=["Billing"])

@router.post("/checkout")
async def create_checkout(
    plan: str = "pro", 
    current_user: User = Depends(get_current_user)
):
    """
    Creates a new checkout session for the authenticated user.
    """
    if plan not in ["pro", "premium"]:
        raise HTTPException(status_code=400, detail="Plano inválido.")

    url = await billing_service.create_checkout_session(str(current_user.id), plan)
    return {"checkout_url": url}

@router.post("/webhook")
async def stripe_webhook(request: Request, db: AsyncSession = Depends(get_db)):
    """
    Endpoint for Stripe / LemonSqueezy to send billing events.
    """
    payload = await request.json()
    signature = request.headers.get("stripe-signature", "")

    # Valida e processa webhook
    success = await billing_service.handle_webhook(payload, signature)
    
    if not success:
        raise HTTPException(status_code=400, detail="Webhook signature mismatch")

    return JSONResponse(content={"status": "success"})
