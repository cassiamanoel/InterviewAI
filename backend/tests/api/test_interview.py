import pytest
from unittest.mock import patch, AsyncMock

def test_ask_question(client):
    payload = {"question": "Como fazer um for em Python?"}
    
    with patch("app.services.rag_service.RAGService.ask_question", new_callable=AsyncMock) as mock_ask:
        mock_ask.return_value = {
            "answer": "Use a sintaxe for i in range(10):",
            "sources": [],
            "tokens": 50
        }
        
        with patch("app.services.rate_limit_service.RateLimitService.can_consume", new_callable=AsyncMock) as mock_can:
            mock_can.return_value = (True, {})
            
            with patch("app.services.rate_limit_service.RateLimitService.consume", new_callable=AsyncMock) as mock_consume:
                mock_consume.return_value = {"used": 50}
                
                response = client.post("/interview/ask", json=payload)
                assert response.status_code == 200
                assert "answer" in response.json()

def test_ask_question_empty(client):
    payload = {"question": "   "}
    response = client.post("/interview/ask", json=payload)
    assert response.status_code == 400
