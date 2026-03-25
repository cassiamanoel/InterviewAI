"use client";

import { useState, useRef, useCallback, useEffect } from "react";

type WhisperRecognitionParams = {
    onQuestionDetected?: (question: string, language: string) => void;
    silenceThresholdMs?: number;
    apiBaseUrl?: string;
};

/*
 * useWhisperRecognition (HYBRID MODE)
 * ------------------------------------
 * MELHOR DOS DOIS MUNDOS:
 * 
 * 1. Web Speech API → transcrição instantânea na tela (tempo real, como antes)
 * 2. MediaRecorder → grava o áudio real em paralelo
 * 3. Quando silêncio é detectado → envia áudio gravado ao Whisper
 * 4. Whisper → transcrição precisa e fiel + detecção de idioma
 * 5. Resultado Whisper é usado como pergunta final para a IA
 *
 * O usuário vê texto aparecendo IMEDIATAMENTE enquanto fala,
 * e a IA recebe a transcrição CORRETA do Whisper.
 */

const SpeechRecognition = typeof window !== "undefined" &&
    ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

export function useWhisperRecognition({
    onQuestionDetected,
    silenceThresholdMs = 2500,
    apiBaseUrl = "http://localhost:8000"
}: WhisperRecognitionParams = {}) {

    const [isListening, setIsListening] = useState(false);
    const [transcript, setTranscript] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);

    const isListeningRef = useRef(false);

    // === WEB SPEECH API (live preview) ===
    const recognitionRef = useRef<any>(null);
    const liveBufferRef = useRef("");

    // === MEDIA RECORDER (audio for Whisper) ===
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const streamRef = useRef<MediaStream | null>(null);
    const mimeTypeRef = useRef("audio/webm");

    // === SILENCE DETECTION ===
    const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);

    const onQuestionDetectedRef = useRef(onQuestionDetected);
    useEffect(() => {
        onQuestionDetectedRef.current = onQuestionDetected;
    }, [onQuestionDetected]);

    // ========================
    // WHISPER: envio final
    // ========================
    const sendFinalToWhisper = useCallback(async (audioBlob: Blob, fallbackText: string) => {
        if (audioBlob.size < 2000) {
            // Áudio muito curto — se temos texto do WebSpeech, usamos como fallback
            if (fallbackText.trim().length >= 2 && onQuestionDetectedRef.current) {
                onQuestionDetectedRef.current(fallbackText, "auto");
            }
            return;
        }

        setIsProcessing(true);

        try {
            const token = localStorage.getItem("access_token") || "";
            const formData = new FormData();
            const ext = mimeTypeRef.current.includes("ogg") ? "ogg" : "webm";
            formData.append("audio", audioBlob, `recording.${ext}`);

            const response = await fetch(`${apiBaseUrl}/api/transcribe`, {
                method: "POST",
                headers: { Authorization: `Bearer ${token}` },
                body: formData
            });

            if (!response.ok) {
                // Fallback: usa o texto do WebSpeech se Whisper falhar
                console.error(`Whisper error ${response.status}, using WebSpeech fallback`);
                if (fallbackText.trim().length >= 2 && onQuestionDetectedRef.current) {
                    onQuestionDetectedRef.current(fallbackText, "auto");
                }
                return;
            }

            const data = await response.json();
            const whisperText = data.transcript?.trim() || "";
            const detectedLang = data.language || "auto";

            // Usa Whisper se tiver resultado, senão fallback do WebSpeech
            const finalText = whisperText.length >= 2 ? whisperText : fallbackText;

            if (finalText.trim().length >= 2 && onQuestionDetectedRef.current) {
                console.log(`🎙️ Final (Whisper): "${finalText}" [${detectedLang}]`);
                onQuestionDetectedRef.current(finalText, detectedLang);
            }

        } catch (e: any) {
            console.error("Whisper fetch error:", e);
            // Fallback
            if (fallbackText.trim().length >= 2 && onQuestionDetectedRef.current) {
                onQuestionDetectedRef.current(fallbackText, "auto");
            }
        } finally {
            setIsProcessing(false);
        }
    }, [apiBaseUrl]);

    // ========================
    // SILENCE TIMER
    // ========================
    const resetSilenceTimer = useCallback(() => {
        if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);

        silenceTimerRef.current = setTimeout(() => {
            if (!isListeningRef.current) return;

            const liveText = liveBufferRef.current.trim();

            // Para o MediaRecorder para obter o blob final
            if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
                // O onstop handler vai processar o envio ao Whisper
                mediaRecorderRef.current.stop();
            } else if (liveText.length >= 2) {
                // Se MediaRecorder já parou mas temos texto do WebSpeech
                if (onQuestionDetectedRef.current) {
                    onQuestionDetectedRef.current(liveText, "auto");
                }
                liveBufferRef.current = "";
                setTranscript("");
            }
        }, silenceThresholdMs);
    }, [silenceThresholdMs]);

    // ========================
    // START
    // ========================
    const startListening = useCallback(async () => {
        if (isListeningRef.current) return;

        try {
            // 1. Iniciar MediaRecorder (áudio real para Whisper)
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            streamRef.current = stream;

            const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
                ? "audio/webm;codecs=opus"
                : MediaRecorder.isTypeSupported("audio/ogg;codecs=opus")
                    ? "audio/ogg;codecs=opus"
                    : "audio/webm";

            mimeTypeRef.current = mimeType;

            const recorder = new MediaRecorder(stream, { mimeType });
            mediaRecorderRef.current = recorder;
            audioChunksRef.current = [];

            recorder.ondataavailable = (e) => {
                if (e.data.size > 0) {
                    audioChunksRef.current.push(e.data);
                }
            };

            recorder.onstop = async () => {
                const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
                audioChunksRef.current = [];

                const fallbackText = liveBufferRef.current.trim();
                liveBufferRef.current = "";
                setTranscript("");

                // Envia ao Whisper para transcrição fiel + detecção de idioma
                await sendFinalToWhisper(audioBlob, fallbackText);

                // Reinicia gravação se ainda estiver ouvindo
                if (isListeningRef.current && streamRef.current) {
                    const newRecorder = new MediaRecorder(streamRef.current, { mimeType });
                    mediaRecorderRef.current = newRecorder;
                    newRecorder.ondataavailable = recorder.ondataavailable;
                    newRecorder.onstop = recorder.onstop;
                    newRecorder.start(1000);
                }
            };

            recorder.start(1000); // chunks a cada 1s

            // 2. Iniciar Web Speech API (display em tempo real)
            if (SpeechRecognition) {
                const recognition = new SpeechRecognition();
                recognition.continuous = true;
                recognition.interimResults = true;
                // Usa pt-BR como base, Whisper corrige no final
                recognition.lang = "pt-BR";
                recognitionRef.current = recognition;

                liveBufferRef.current = "";

                recognition.onresult = (event: any) => {
                    let finalParts = "";
                    let interimParts = "";

                    for (let i = event.resultIndex; i < event.results.length; ++i) {
                        if (event.results[i].isFinal) {
                            finalParts += event.results[i][0].transcript + " ";
                        } else {
                            interimParts += event.results[i][0].transcript;
                        }
                    }

                    if (finalParts) {
                        liveBufferRef.current += finalParts;
                    }

                    setTranscript(liveBufferRef.current + interimParts);

                    // Reseta silence timer a cada resultado de fala
                    resetSilenceTimer();
                };

                recognition.onend = () => {
                    if (isListeningRef.current && recognitionRef.current) {
                        try { recognitionRef.current.start(); } catch (e) { }
                    }
                };

                recognition.onerror = (event: any) => {
                    if (event.error !== "no-speech" && event.error !== "aborted") {
                        console.error("SpeechRecognition error:", event.error);
                    }
                };

                try {
                    recognition.start();
                } catch (e) { }
            }

            isListeningRef.current = true;
            setIsListening(true);
            setError(null);
            setTranscript("");

            console.log("🎤 Hybrid mode started (WebSpeech live + Whisper final)");

        } catch (e: any) {
            console.error("Start error:", e);
            setError(`Microfone indisponível: ${e.message}`);
            isListeningRef.current = false;
            setIsListening(false);
        }
    }, [sendFinalToWhisper, resetSilenceTimer]);

    // ========================
    // STOP
    // ========================
    const stopListening = useCallback(() => {
        isListeningRef.current = false;
        setIsListening(false);

        if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);

        if (recognitionRef.current) {
            try { recognitionRef.current.abort(); } catch (e) { }
        }

        if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
            mediaRecorderRef.current.stop();
        }

        if (streamRef.current) {
            streamRef.current.getTracks().forEach(t => t.stop());
            streamRef.current = null;
        }

        liveBufferRef.current = "";
        setTranscript("");
        console.log("🛑 Hybrid mode stopped");
    }, []);

    return {
        isListening,
        transcript,
        error,
        isProcessing,
        startListening,
        stopListening,
        isSupported: typeof window !== "undefined" && (!!SpeechRecognition || !!window.MediaRecorder)
    };
}
