"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useVAD } from "./useVAD";

type WhisperRecognitionParams = {
    onQuestionDetected?: (question: string, language: string) => void;
    apiBaseUrl?: string;
    /** Seconds of absolute silence before sending to Whisper. Default 5 */
    silenceConfirmSeconds?: number;
};

/*
 * useWhisperRecognition (VAD + Whisper + 5s silence rule)
 * --------------------------------------------------------
 * 1. VAD detects speech start → live preview via Web Speech API
 * 2. VAD captures audio segment on speech end → buffers it
 * 3. Starts a 5-second silence timer
 * 4. If new speech before 5s → resets timer, appends audio
 * 5. After 5s of confirmed silence → sends all buffered audio to Whisper
 * 6. Whisper returns transcript + language → fires onQuestionDetected
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
const SpeechRecognition = typeof window !== "undefined" &&
    ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Convert Float32Array (PCM 16kHz) to WAV blob for Whisper API */
function float32ToWavBlob(float32: Float32Array, sampleRate: number = 16000): Blob {
    const length = float32.length;
    const buffer = new ArrayBuffer(44 + length * 2);
    const view = new DataView(buffer);

    const writeString = (offset: number, str: string) => {
        for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    };
    writeString(0, "RIFF");
    view.setUint32(4, 36 + length * 2, true);
    writeString(8, "WAVE");
    writeString(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, "data");
    view.setUint32(40, length * 2, true);

    let offset = 44;
    for (let i = 0; i < length; i++) {
        const s = Math.max(-1, Math.min(1, float32[i]));
        view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        offset += 2;
    }

    return new Blob([buffer], { type: "audio/wav" });
}

/** Concatenate multiple Float32Arrays into one */
function concatFloat32Arrays(arrays: Float32Array[]): Float32Array {
    const totalLength = arrays.reduce((sum, a) => sum + a.length, 0);
    const result = new Float32Array(totalLength);
    let offset = 0;
    for (const arr of arrays) {
        result.set(arr, offset);
        offset += arr.length;
    }
    return result;
}

export function useWhisperRecognition({
    onQuestionDetected,
    apiBaseUrl = "http://localhost:8000",
    silenceConfirmSeconds = 5,
}: WhisperRecognitionParams = {}) {

    const [isListening, setIsListening] = useState(false);
    const [transcript, setTranscript] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);

    const isListeningRef = useRef(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const recognitionRef = useRef<any>(null);
    const liveBufferRef = useRef("");

    // Silence confirmation: accumulate audio segments, wait 5s silence
    const audioSegmentsRef = useRef<Float32Array[]>([]);
    const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);

    const onQuestionDetectedRef = useRef(onQuestionDetected);
    useEffect(() => {
        onQuestionDetectedRef.current = onQuestionDetected;
    }, [onQuestionDetected]);

    // ========================
    // WHISPER: send audio
    // ========================
    const sendToWhisper = useCallback(async (audioData: Float32Array, fallbackText: string) => {
        if (audioData.length < 4800) {
            if (fallbackText.trim().length >= 2 && onQuestionDetectedRef.current) {
                onQuestionDetectedRef.current(fallbackText, "auto");
            }
            return;
        }

        setIsProcessing(true);

        try {
            const token = localStorage.getItem("access_token") || "";
            const wavBlob = float32ToWavBlob(audioData);

            const formData = new FormData();
            formData.append("audio", wavBlob, "recording.wav");

            const response = await fetch(`${apiBaseUrl}/api/transcribe`, {
                method: "POST",
                headers: { Authorization: `Bearer ${token}` },
                body: formData
            });

            if (!response.ok) {
                console.error(`Whisper error ${response.status}, using WebSpeech fallback`);
                if (fallbackText.trim().length >= 2 && onQuestionDetectedRef.current) {
                    onQuestionDetectedRef.current(fallbackText, "auto");
                }
                return;
            }

            const data = await response.json();
            const whisperText = data.transcript?.trim() || "";
            const detectedLang = data.language || "auto";

            const finalText = whisperText.length >= 2 ? whisperText : fallbackText;

            if (finalText.trim().length >= 2 && onQuestionDetectedRef.current) {
                console.log(`🎙️ Final (Whisper): "${finalText}" [${detectedLang}]`);
                onQuestionDetectedRef.current(finalText, detectedLang);
            }

        } catch (e: unknown) {
            console.error("Whisper fetch error:", e);
            if (fallbackText.trim().length >= 2 && onQuestionDetectedRef.current) {
                onQuestionDetectedRef.current(fallbackText, "auto");
            }
        } finally {
            setIsProcessing(false);
        }
    }, [apiBaseUrl]);

    // ========================
    // SILENCE CONFIRMATION
    // ========================
    const clearSilenceTimer = useCallback(() => {
        if (silenceTimerRef.current) {
            clearTimeout(silenceTimerRef.current);
            silenceTimerRef.current = null;
        }
    }, []);

    const startSilenceTimer = useCallback(() => {
        clearSilenceTimer();

        silenceTimerRef.current = setTimeout(() => {
            // 5s of silence confirmed — send all accumulated audio
            const segments = audioSegmentsRef.current;
            audioSegmentsRef.current = [];

            if (segments.length === 0) return;

            const fullAudio = concatFloat32Arrays(segments);
            const fallbackText = liveBufferRef.current.trim();
            liveBufferRef.current = "";
            setTranscript("");

            // Stop Web Speech preview
            if (recognitionRef.current) {
                try { recognitionRef.current.abort(); } catch { /* ignore */ }
                recognitionRef.current = null;
            }

            console.log(`⏱️ ${silenceConfirmSeconds}s silence confirmed — sending ${(fullAudio.length / 16000).toFixed(1)}s of audio`);
            sendToWhisper(fullAudio, fallbackText);
        }, silenceConfirmSeconds * 1000);
    }, [silenceConfirmSeconds, sendToWhisper, clearSilenceTimer]);

    // ========================
    // VAD CALLBACKS
    // ========================
    const handleSpeechStart = useCallback(() => {
        console.log("🟢 VAD: speech started");
        // Cancel any pending silence timer — person is still talking
        clearSilenceTimer();

        // Start Web Speech API for live preview (if not already running)
        if (SpeechRecognition && !recognitionRef.current) {
            const recognition = new SpeechRecognition();
            recognition.continuous = true;
            recognition.interimResults = true;
            recognition.lang = "pt-BR";
            recognitionRef.current = recognition;

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
            };

            recognition.onend = () => {
                recognitionRef.current = null;
            };

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            recognition.onerror = (event: any) => {
                if (event.error !== "no-speech" && event.error !== "aborted") {
                    console.error("SpeechRecognition error:", event.error);
                }
            };

            try { recognition.start(); } catch { /* ignore */ }
        }
    }, [clearSilenceTimer]);

    const handleSpeechEnd = useCallback((audio: Float32Array) => {
        console.log(`🔴 VAD: speech segment ended (${(audio.length / 16000).toFixed(1)}s)`);

        // Buffer this segment — don't send yet
        audioSegmentsRef.current.push(audio);

        // Start/restart the 5s silence confirmation timer
        startSilenceTimer();
    }, [startSilenceTimer]);

    const handleVADMisfire = useCallback(() => {
        console.log("⚡ VAD: misfire (too short)");
        // Don't clear timer or buffer — just ignore this tiny segment
    }, []);

    // ========================
    // VAD INSTANCE
    // ========================
    const vad = useVAD({
        onSpeechStart: handleSpeechStart,
        onSpeechEnd: handleSpeechEnd,
        onVADMisfire: handleVADMisfire,
        positiveSpeechThreshold: 0.5,
        negativeSpeechThreshold: 0.35,
        minSpeechMs: 300,
        redemptionMs: 300,
    });

    // ========================
    // START / STOP
    // ========================
    const startListening = useCallback(async () => {
        if (isListeningRef.current) return;

        try {
            await vad.startListening();
            isListeningRef.current = true;
            setIsListening(true);
            setError(null);
            setTranscript("");
            liveBufferRef.current = "";
            audioSegmentsRef.current = [];
            clearSilenceTimer();
            console.log("🎤 Whisper+VAD mode started");
        } catch (e: unknown) {
            console.error("Start error:", e);
            setError(`Mic unavailable: ${e instanceof Error ? e.message : String(e)}`);
            isListeningRef.current = false;
            setIsListening(false);
        }
    }, [vad, clearSilenceTimer]);

    const stopListening = useCallback(() => {
        isListeningRef.current = false;
        setIsListening(false);

        clearSilenceTimer();
        audioSegmentsRef.current = [];
        vad.stopListening();

        if (recognitionRef.current) {
            try { recognitionRef.current.abort(); } catch { /* ignore */ }
            recognitionRef.current = null;
        }

        liveBufferRef.current = "";
        setTranscript("");
        console.log("🛑 Whisper+VAD mode stopped");
    }, [vad, clearSilenceTimer]);

    return {
        isListening,
        transcript,
        error,
        isProcessing,
        startListening,
        stopListening,
        isSupported: vad.isSupported,
    };
}
