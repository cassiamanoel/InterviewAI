import pytest

def test_get_me(client):
    response = client.get("/auth/me")
    assert response.status_code == 200
    assert "email" in response.json()
