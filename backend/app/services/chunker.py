from typing import List

def chunk_text(
    text: str,
    chunk_size: int = 1200,
    overlap: int = 200
) -> List[str]:

    text = (text or "").strip()
    if not text:
        return []

    if overlap >= chunk_size:
        raise ValueError("overlap deve ser menor que chunk_size")

    chunks: List[str] = []
    start = 0
    n = len(text)

    while start < n:
        end = min(start + chunk_size, n)

        chunk = text[start:end].strip()

        if chunk:
            chunks.append(chunk)

        if end == n:
            break

        start = end - overlap

    return chunks