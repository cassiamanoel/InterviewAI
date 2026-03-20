import pytest
from unittest.mock import patch, MagicMock, AsyncMock
from app.services.rag_service import RAGService

@pytest.mark.asyncio
async def test_rag_ask_question():
    with patch("app.services.rag_service.QdrantStore") as MockStore:
        mock_instance = MockStore.return_value
        
        # search became async
        mock_search_result = [MagicMock(payload={"text": "context1", "cv_id": "1", "chunk_index": 1}, score=0.9)]
        mock_instance.search = AsyncMock(return_value=mock_search_result)
        
        with patch("app.services.rag_service.EmbeddingService.embed_texts", new_callable=AsyncMock) as mock_embed:
            mock_embed.return_value = [[0.1, 0.2]]
            
            with patch("app.services.rag_service.RAGService._chat", new_callable=AsyncMock) as mock_chat:
                mock_chat.return_value = ("This is the answer", 42)
                
                res = await RAGService.ask_question("user_123", "What is python?", top_k=1)
                assert res["answer"] == "This is the answer"
                assert res["tokens"] == 42
                assert len(res["sources"]) == 1
