from app.services.chunker import chunk_text

def test_chunk_text():
    text = "A" * 1000
    chunks = chunk_text(text, chunk_size=200, overlap=50)
    assert len(chunks) > 0
    assert len(chunks[0]) <= 200

def test_chunk_text_empty():
    assert chunk_text("") == []
