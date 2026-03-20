def test_health_check(client):
    """Testa se a API está online."""
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}