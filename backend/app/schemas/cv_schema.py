from pydantic import BaseModel
from uuid import UUID
from datetime import datetime

class CVResponse(BaseModel):
    id: UUID
    user_id: UUID
    created_at: datetime

    class Config:
        from_attributes = True