"use client";

import { useState, useRef, useCallback, useEffect } from "react";

type WhisperRecognitionParams = {
    onQuestionDetected?: (question: string, language: string) => void;
    silenceThresholdMs?: number;
    apiBaseUrl?: string;
};

/*
 * useWhisperRecognition
 * ---------------------
 * Usa MediaRecorder para capturar áudio real e envia para o backend (OpenAI Whisper).
 * O Whisper transcreve fielmente em qualquer idioma sem traduzir.
 * O backend retorna o transcript + o idioma dominante detectado.
 * 
 * Diferença crítica vs Web Speech API:
 * - Web Speech API: distorce fala estrangeira com lang fixo
 * - Whisper: transcreve exatamente o que foi dito, em qualquer idioma
 */
export function useWhisperRecognition({
    onQuestionDetected,
    silenceThresholdMs = 3000,
    apiBaseUrl = "http://localhost:8000"
}: WhisperRecognitionParams = {}) {

    const [isListening, setIsListening] = useState(false);
    const [transcript, setTranscript] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);

    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const isListeningRef = useRef(false);

    // Ref estável para o callback
    const onQuestionDetectedRef = useRef(onQuestionDetected);
    useEffect(() => {
        onQuestionDetectedRef.current = onQuestionDetected;
    }, [onQuestionDetected]);

    const sendToWhisper = useCallback(async (audioBlob: Blob) => {
        if (audioBlob.size < 1000) return; // Silêncio / muito curto

        setIsProcessing(true);

        try {
            const token = localStorage.getItem("auth_token") || "";
            const formData = new FormData();
            formData.append("audio", audioBlob, "recording.webm");

            const response = await fetch(`${apiBaseUrl}/api/transcribe`, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${token}`
                },
                body: formData
            });

            if (!response.ok) {
                throw new Error(`Transcription failed: ${response.status}`);
            }

            const data = await response.json();
            const { transcript: text, language } = data;

            if (!text || text.trim().length < 2) return;

            console.log(`🎙️ Whisper: "${text}" (lang: ${language})`);
            setTranscript(text);

            if (onQuestionDetectedRef.current) {
                onQuestionDetectedRef.current(text, language);
            }

            setTranscript("");

        } catch (e: any) {
            console.error("Whisper transcription error:", e);
            setError(`Transcription error: ${e.message}`);
        } finally {
            setIsProcessing(false);
        }
    }, [apiBaseUrl]);

    const resetSilenceTimer = useCallback(() => {
        if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);

        silenceTimerRef.current = setTimeout(() => {
            if (!mediaRecorderRef.current || mediaRecorderRef.current.state !== "recording") return;

            // Para a gravação para obter o blob final
            mediaRecorderRef.current.stop();
        }, silenceThresholdMs);
    }, [silenceThresholdMs]);

    const startListening = useCallback(async () => {
        if (isListeningRef.current) return;

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            streamRef.current = stream;

            // Tenta webm/opus (Chrome), fallback para ogg/opus (Firefox)
            const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
                ? "audio/webm;codecs=opus"
                : MediaRecorder.isTypeSupported("audio/ogg;codecs=opus")
                    ? "audio/ogg;codecs=opus"
                    : "audio/webm";

            const mediaRecorder = new MediaRecorder(stream, { mimeType });
            mediaRecorderRef.current = mediaRecorder;
            audioChunksRef.current = [];

            mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) {
                    audioChunksRef.current.push(e.data);
                    resetSilenceTimer();
                }
            };

            mediaRecorder.onstop = async () => {
                const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
                audioChunksRef.current = [];

                await sendToWhisper(audioBlob);

                // Se ainda queremos ouvir, reinicia a gravação
                if (isListeningRef.current && streamRef.current) {
                    const newRecorder = new MediaRecorder(streamRef.current, { mimeType });
                    mediaRecorderRef.current = newRecorder;

                    newRecorder.ondataavailable = mediaRecorder.ondataavailable;
                    newRecorder.onstop = mediaRecorder.onstop;

                    newRecorder.start(500); // chunks a cada 500ms
                    resetSilenceTimer();
                }
            };

            isListeningRef.current = true;
            setIsListening(true);
            setError(null);

            mediaRecorder.start(500); // chunks a cada 500ms
            resetSilenceTimer();

            console.log(`🎤 Whisper mode started (${mimeType})`);

        } catch (e: any) {
            console.error("MediaRecorder error:", e);
            setError(`Microfone indisponível: ${e.message}`);
            isListeningRef.current = false;
            setIsListening(false);
        }
    }, [sendToWhisper, resetSilenceTimer]);

    const stopListening = useCallback(() => {
        isListeningRef.current = false;
        setIsListening(false);

        if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);

        if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
            mediaRecorderRef.current.stop();
        }

        if (streamRef.current) {
            streamRef.current.getTracks().forEach(t => t.stop());
            streamRef.current = null;
        }

        console.log("🛑 Whisper mode stopped");
    }, []);

    return {
        isListening,
        transcript,
        error,
        isProcessing,
        startListening,
        stopListening,
        isSupported: typeof window !== "undefined" && !!window.MediaRecorder
    };
}
