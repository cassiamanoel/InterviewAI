import pytest
from app.services.rag_service import RAGService

def test_pt_heuristic_short_phrases():
    """Testa se frases curtas são detectadas corretamente como PT pela heurística."""
    test_cases = [
        "cor favorita",
        "seus hobbies",
        "pontos fortes",
        "fala sobre vc",
        "vc gosta de cafe?",
        "trabalho atual",
        "quais os seus pontos fracos?",
        "experiencia profissional",
        "salario pretendido"
    ]
    for text in test_cases:
        assert RAGService._is_portuguese(text) is True, f"Falha ao detectar PT em: {text}"

def test_pt_heuristic_false_positives():
    """Testa se frases em inglês não ativam a heurística de PT."""
    test_cases = [
        "what is your name?",
        "tell me about yourself",
        "my favorite color is blue",
        "i have experience with python",
        "the company is great"
    ]
    for text in test_cases:
        assert RAGService._is_portuguese(text) is False, f"Falso positivo em: {text}"

def test_detect_language_universal():
    """Testa a detecção universal (Heurística + Lingua)."""
    # Português (Heurística)
    assert RAGService._detect_language("Oi, vc") == "pt"
    # Inglês (Lingua)
    assert RAGService._detect_language("I am a software engineer with ten years of experience") == "en"
    # Espanhol (Lingua)
    assert RAGService._detect_language("Me considero una persona orientada a resultados") == "es"
    # Francês (fallback/Lingua)
    assert RAGService._detect_language("Bonjour, je m'appelle André") == "fr"

def test_map_culture():
    """Testa o mapeamento de idioma para cultura."""
    assert RAGService._map_culture("pt") == "BR"
    assert RAGService._map_culture("es") == "ES"
    assert RAGService._map_culture("en") == "US"
    assert RAGService._map_culture("fr") == "US"  # Fallback US

def test_build_system_prompt_culture():
    """Testa se os tokens culturais estão presentes no prompt."""
    # Teste BR
    prompt_br = RAGService._build_system_prompt("pt")
    assert "TOM CULTURAL (BR)" in prompt_br
    assert "Tom natural, próximo e conversacional" in prompt_br
    assert "Menos formal, mais empático e humano" in prompt_br
    
    # Teste US
    prompt_us = RAGService._build_system_prompt("en")
    assert "TOM CULTURAL (US)" in prompt_us
    assert "Tom direto, objetivo e estruturado" in prompt_us
    assert "Segurança, clareza e concisão" in prompt_us

    # Teste ES
    prompt_es = RAGService._build_system_prompt("es")
    assert "TOM CULTURAL (ES)" in prompt_es
    assert "Tom profissional e respeitoso" in prompt_es
    assert "Formal moderado, levemente mais explicativo" in prompt_es
