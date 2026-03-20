def test_login_invalid_credentials(client):
    """
    Testes mockados focando na lógica de rejeição do /auth/login caso senha seja 
    incorreta. Auth flow mock setup no DB (FakeSession).
    """
    response = client.post("/auth/login", data={"username": "wrong", "password": "123"})
    # Depende de como a rota trata a resposta. Por padrão HTTPException retorna 401/400.
    assert response.status_code in [400, 401], f"Expected 401, got {response.status_code}"
    assert "detail" in response.json()

def test_billing_checkout_auth(client):
    """
    Testa se o mock de get_current_user no auth dependency_overrides é ativado e a rota 
    de checkout (que exige autorização) passa na base e gera a url.
    """
    response = client.post("/billing/checkout?plan=pro")
    
    assert response.status_code == 200
    data = response.json()
    assert "checkout_url" in data
    assert "checkout.stripe.com" in data["checkout_url"]
