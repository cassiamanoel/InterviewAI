import io
import logging
from fastapi import APIRouter, UploadFile, File, HTTPException, Depends
from app.core.config import settings
from app.core.security import get_current_user
from lingua import Language, LanguageDetectorBuilder

logger = logging.getLogger("app")

router = APIRouter(prefix="/api")

# Detector reutilizável
_detector = LanguageDetectorBuilder.from_languages(
    Language.PORTUGUESE, Language.ENGLISH, Language.SPANISH,
    Language.FRENCH, Language.GERMAN, Language.ITALIAN
).with_preloaded_language_models().build()

_LANG_MAP = {
    Language.PORTUGUESE: "pt",
    Language.ENGLISH: "en",
    Language.SPANISH: "es",
    Language.FRENCH: "fr",
    Language.GERMAN: "de",
    Language.ITALIAN: "it",
}

def _detect_dominant_language(text: str) -> str:
    """Detecta o idioma dominante no texto transcrito."""
    if not text.strip():
        return "en"

    # Tenta detecção via Lingua
    try:
        detected = _detector.detect_language_of(text)
        if detected:
            return _LANG_MAP.get(detected, "en")
    except Exception:
        pass

    return "en"


@router.post("/transcribe")
async def transcribe_audio(
    audio: UploadFile = File(...),
    current_user=Depends(get_current_user)
):
    """
    Recebe um blob de áudio e retorna a transcrição fiel (qualquer idioma)
    usando OpenAI Whisper + detecção de idioma dominante via Lingua.
    """
    if not settings.OPENAI_API_KEY:
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY não configurada")

    try:
        audio_bytes = await audio.read()
        
        if len(audio_bytes) < 1000:
            # Áudio muito curto, provavelmente silêncio
            return {"transcript": "", "language": "auto"}

        # Envia para Whisper com transcrição fiel (sem tradução)
        from openai import AsyncOpenAI
        client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)

        # Cria um arquivo em memória com extensão correta
        audio_file = io.BytesIO(audio_bytes)
        audio_file.name = audio.filename or "audio.webm"

        response = await client.audio.transcriptions.create(
            model="whisper-1",
            file=audio_file,
            # response_format="text" retorna só o texto, sem metadados
            response_format="json"
            # NÃO passamos 'language' → Whisper detecta automaticamente e transcreve fielmente
        )

        transcript = response.text.strip()
        
        logger.info(f"Whisper transcribed: '{transcript}'")

        # Detecta idioma dominante no texto transcrito
        detected_lang = _detect_dominant_language(transcript)
        
        logger.info(f"Dominant language detected: {detected_lang}")

        return {
            "transcript": transcript,
            "language": detected_lang
        }

    except Exception as e:
        logger.error(f"Transcription error: {e}")
        raise HTTPException(status_code=500, detail=f"Erro na transcrição: {str(e)}")
