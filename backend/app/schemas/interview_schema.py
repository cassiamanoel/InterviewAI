from pydantic import BaseModel, Field
from typing import List, Optional


class AskRequest(BaseModel):
    question: str = Field(..., min_length=3, max_length=2000)
    language: Optional[str] = Field("pt", description="Idioma alvo da resposta")


class SourceItem(BaseModel):
    score: float
    cv_id: Optional[str] = None
    chunk_index: Optional[int] = None

class AskResponse(BaseModel):
    answer: str
    sources: List[SourceItem]
    usage_daily: dict