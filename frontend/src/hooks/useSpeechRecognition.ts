"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useVAD } from "./useVAD";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SpeechRecognition = typeof window !== "undefined" && ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

type SpeechRecognitionHookParams = {
    language?: string;
    onQuestionDetected?: (question: string) => void;
    /** Seconds of absolute silence before firing question. Default 5 */
    silenceConfirmSeconds?: number;
};

/*
 * useSpeechRecognition (VAD + Web Speech + 5s silence rule)
 * ----------------------------------------------------------
 * 1. VAD detects speech start → Web Speech API starts
 * 2. VAD detects speech end → buffers transcript, starts 5s timer
 * 3. If new speech before 5s → cancels timer, continues accumulating
 * 4. After 5s confirmed silence → fires onQuestionDetected with full buffer
 */

export function useSpeechRecognition({
    language = "en-US",
    onQuestionDetected,
    silenceConfirmSeconds = 5,
}: SpeechRecognitionHookParams = {}) {
    const [isListening, setIsListening] = useState(false);
    const [transcript, setTranscript] = useState("");
    const [error, setError] = useState<string | null>(null);

    const isListeningRef = useRef(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const recognitionRef = useRef<any>(null);
    const currentBufferRef = useRef("");
    const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);

    const onQuestionDetectedRef = useRef(onQuestionDetected);
    useEffect(() => {
        onQuestionDetectedRef.current = onQuestionDetected;
    }, [onQuestionDetected]);

    const getWebSpeechLang = useCallback((lang: string) => {
        if (lang === "auto") return "pt-BR";
        if (lang === "pt") return "pt-BR";
        if (lang === "es") return "es-ES";
        if (lang === "en") return "en-US";
        return lang;
    }, []);

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
            const finalBuffer = currentBufferRef.current.trim();
            currentBufferRef.current = "";
            setTranscript("");

            // Stop Web Speech preview
            if (recognitionRef.current) {
                try { recognitionRef.current.abort(); } catch { /* ignore */ }
                recognitionRef.current = null;
            }

            if (finalBuffer.length >= 2 && onQuestionDetectedRef.current) {
                console.log(`⏱️ ${silenceConfirmSeconds}s silence confirmed — sending question`);
                onQuestionDetectedRef.current(finalBuffer);
            }
        }, silenceConfirmSeconds * 1000);
    }, [silenceConfirmSeconds, clearSilenceTimer]);

    // ========================
    // WEB SPEECH ENGINE
    // ========================
    const startWebSpeech = useCallback(() => {
        if (!SpeechRecognition || recognitionRef.current) return;

        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = getWebSpeechLang(language);
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
                currentBufferRef.current += finalParts;
            }
            setTranscript(currentBufferRef.current + interimParts);
        };

        recognition.onend = () => {
            recognitionRef.current = null;
        };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        recognition.onerror = (event: any) => {
            if (event.error !== "no-speech" && event.error !== "aborted") {
                console.error("SpeechRecognition error:", event.error);
                setError(`Error: ${event.error}`);
            }
        };

        try { recognition.start(); } catch { /* ignore */ }
    }, [language, getWebSpeechLang]);

    const stopWebSpeech = useCallback(() => {
        if (recognitionRef.current) {
            try { recognitionRef.current.abort(); } catch { /* ignore */ }
            recognitionRef.current = null;
        }
    }, []);

    // ========================
    // VAD CALLBACKS
    // ========================
    const handleSpeechStart = useCallback(() => {
        console.log("🟢 VAD (fixed lang): speech started");
        // Cancel pending silence timer — person is still talking
        clearSilenceTimer();
        startWebSpeech();
    }, [startWebSpeech, clearSilenceTimer]);

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const handleSpeechEnd = useCallback((_audio: Float32Array) => {
        console.log("🔴 VAD (fixed lang): speech segment ended");
        // Don't fire question yet — start 5s silence timer
        // Web Speech stays running to accumulate more if person resumes
        startSilenceTimer();
    }, [startSilenceTimer]);

    const handleVADMisfire = useCallback(() => {
        console.log("⚡ VAD (fixed lang): misfire");
        // Ignore — don't clear timer or buffer
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

        if (!SpeechRecognition) {
            setError("Web Speech API is not supported. Use Google Chrome.");
            return;
        }

        try {
            await vad.startListening();
            isListeningRef.current = true;
            setIsListening(true);
            setError(null);
            setTranscript("");
            currentBufferRef.current = "";
            clearSilenceTimer();
            console.log(`🎤 Speech+VAD mode started (lang: ${language})`);
        } catch (e: unknown) {
            console.error("Start error:", e);
            setError(`Mic unavailable: ${e instanceof Error ? e.message : String(e)}`);
            isListeningRef.current = false;
            setIsListening(false);
        }
    }, [vad, language, clearSilenceTimer]);

    const stopListening = useCallback(() => {
        isListeningRef.current = false;
        setIsListening(false);

        clearSilenceTimer();
        vad.stopListening();
        stopWebSpeech();

        currentBufferRef.current = "";
        setTranscript("");
        console.log("🛑 Speech+VAD mode stopped");
    }, [vad, stopWebSpeech, clearSilenceTimer]);

    return {
        isListening,
        transcript,
        error,
        startListening,
        stopListening,
        isSupported: !!SpeechRecognition && vad.isSupported,
    };
}
