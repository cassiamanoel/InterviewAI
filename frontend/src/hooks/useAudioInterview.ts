"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { NEXT_PUBLIC_API_URL } from "@/lib/config";
import { getToken } from "@/lib/api";
import { useSpeechRecognition } from "./useSpeechRecognition";
import { useWhisperRecognition } from "./useWhisperRecognition";
import { useVAD } from "./useVAD";

export type AudioState = "idle" | "listening" | "thinking" | "reading" | "error";

export type InterviewInteraction = {
    id: string;
    question: string;
    answer: string;
};

// 3 seconds of silence required before mic resumes after answer
const SILENCE_REQUIRED_MS = 3000;

export function useAudioInterview() {
    const [sessionLanguage, setSessionLanguage] = useState("auto");
    const [aboutText, setAboutText] = useState<string | null>(null);
    const [audioState, setAudioState] = useState<AudioState>("idle");
    const [transcript, setTranscript] = useState("");
    const [interactions, setInteractions] = useState<InterviewInteraction[]>([]);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [readingCountdown, setReadingCountdown] = useState(0);

    const abortControllerRef = useRef<AbortController | null>(null);
    const audioStateRef = useRef<AudioState>("idle");
    const stoppedRef = useRef(false);

    // Silence tracking for post-answer reading pause
    const silenceAccumulatedRef = useRef(0);
    const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        if (typeof window !== "undefined") {
            const lang = localStorage.getItem("interview_language") || "auto";
            setSessionLanguage(lang);
            setAboutText(localStorage.getItem("interview_about_text") || null);
        }
    }, []);

    useEffect(() => {
        audioStateRef.current = audioState;
    }, [audioState]);

    const isAutoMode = sessionLanguage === "auto";

    // ========================
    // MIC PAUSE / RESUME
    // ========================
    const pauseMicRef = useRef<(() => void) | null>(null);
    const resumeMicRef = useRef<(() => void) | null>(null);

    // ========================
    // POST-ANSWER SILENCE VAD
    // ========================
    // Dedicated VAD instance that runs ONLY during "reading" state.
    // It monitors ambient sound — when 3s of continuous silence is
    // detected (no speech events), it resumes the main mic.

    const handlePostAnswerSpeechStart = useCallback(() => {
        // Someone is talking (candidate reading aloud) → reset silence counter
        silenceAccumulatedRef.current = 0;
        setReadingCountdown(Math.ceil(SILENCE_REQUIRED_MS / 1000));
    }, []);

    const handlePostAnswerSpeechEnd = useCallback(() => {
        // Speech ended → silence counter will accumulate via the interval
    }, []);

    const postAnswerVAD = useVAD({
        onSpeechStart: handlePostAnswerSpeechStart,
        onSpeechEnd: handlePostAnswerSpeechEnd,
        positiveSpeechThreshold: 0.4,  // More sensitive to catch reading aloud
        negativeSpeechThreshold: 0.25,
        minSpeechMs: 150,
        redemptionMs: 200,
    });

    const stopReadingMonitor = useCallback(() => {
        if (countdownIntervalRef.current) {
            clearInterval(countdownIntervalRef.current);
            countdownIntervalRef.current = null;
        }
        postAnswerVAD.stopListening();
        silenceAccumulatedRef.current = 0;
        setReadingCountdown(0);
    }, [postAnswerVAD]);

    const startReadingMonitor = useCallback(async () => {
        if (stoppedRef.current) return;

        setAudioState("reading");
        silenceAccumulatedRef.current = 0;
        setReadingCountdown(Math.ceil(SILENCE_REQUIRED_MS / 1000));

        try {
            await postAnswerVAD.startListening();

            // Poll silence accumulation every 200ms.
            // onSpeechStart callback resets silenceAccumulatedRef to 0,
            // so we just keep incrementing here — any speech resets it.
            countdownIntervalRef.current = setInterval(() => {
                if (stoppedRef.current) {
                    stopReadingMonitor();
                    return;
                }

                silenceAccumulatedRef.current += 200;

                const remaining = Math.ceil((SILENCE_REQUIRED_MS - silenceAccumulatedRef.current) / 1000);
                setReadingCountdown(Math.max(0, remaining));

                if (silenceAccumulatedRef.current >= SILENCE_REQUIRED_MS) {
                    stopReadingMonitor();
                    if (!stoppedRef.current) {
                        resumeMicRef.current?.();
                        setAudioState("listening");
                        console.log("🎤 3s silence (VAD) — mic resumed");
                    }
                }
            }, 200);

        } catch (e: unknown) {
            console.error("Reading monitor error:", e);
            // Fallback: resume after fixed 3s
            stopReadingMonitor();
            setTimeout(() => {
                if (!stoppedRef.current) {
                    resumeMicRef.current?.();
                    setAudioState("listening");
                }
            }, SILENCE_REQUIRED_MS);
        }
    }, [postAnswerVAD, stopReadingMonitor]);

    const skipReadingPause = useCallback(() => {
        stopReadingMonitor();
        if (!stoppedRef.current) {
            resumeMicRef.current?.();
            setAudioState("listening");
            console.log("🎤 Reading skipped manually — mic resumed");
        }
    }, [stopReadingMonitor]);

    // ========================
    // QUESTION HANDLER
    // ========================
    const handleQuestionDetected = useCallback(async (finalQuestion: string, detectedLanguage?: string) => {
        if (!finalQuestion.trim()) return;
        if (audioStateRef.current === "thinking" || audioStateRef.current === "reading") return;
        if (stoppedRef.current) return;

        // 1. Pause mic immediately
        pauseMicRef.current?.();

        const interactionId = Date.now().toString();
        setInteractions(prev => [...prev, { id: interactionId, question: finalQuestion, answer: "" }]);

        setAudioState("thinking");
        setErrorMsg(null);

        const controller = new AbortController();
        abortControllerRef.current = controller;

        const langToSend = (detectedLanguage && detectedLanguage !== "auto") ? detectedLanguage : sessionLanguage;
        console.log(`🌐 Language to send: ${langToSend} (detected: ${detectedLanguage}, session: ${sessionLanguage})`);

        try {
            const token = getToken();
            const body: Record<string, unknown> = {
                question: finalQuestion,
                language: langToSend
            };

            if (aboutText) {
                body.about_text = aboutText;
            }

            const response = await fetch(`${NEXT_PUBLIC_API_URL}/interview/ask?stream=true`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${token}`
                },
                body: JSON.stringify(body),
                signal: controller.signal
            });

            if (!response.ok) throw new Error("Failed to contact RAG engine");
            if (!response.body) throw new Error("Stream not supported");

            const reader = response.body.getReader();
            const decoder = new TextDecoder("utf-8");
            let done = false;
            let fullContent = "";

            while (!done && !stoppedRef.current) {
                const { value, done: readerDone } = await reader.read();
                done = readerDone;

                if (value) {
                    const chunk = decoder.decode(value, { stream: true });
                    const lines = chunk.split("\n");
                    for (const line of lines) {
                        if (stoppedRef.current) break;
                        if (line.startsWith("data: ")) {
                            const dataStr = line.replace("data: ", "").trim();
                            if (dataStr === "[DONE]") { done = true; break; }
                            try {
                                const parsed = JSON.parse(dataStr);
                                if (parsed.type === "chunk") {
                                    fullContent += parsed.content;
                                    setInteractions(prev => prev.map(interaction =>
                                        interaction.id === interactionId
                                            ? { ...interaction, answer: fullContent }
                                            : interaction
                                    ));
                                } else if (parsed.type === "error") {
                                    throw new Error(parsed.message);
                                }
                            } catch { /* ignore parse error */ }
                        }
                    }
                }
            }

            if (stoppedRef.current) {
                try { reader.cancel(); } catch { /* ignore */ }
                return;
            }

            // 2. Response complete → start VAD silence monitor
            startReadingMonitor();

        } catch (err: unknown) {
            if (err instanceof Error && err.name === "AbortError") {
                console.log("Request Aborted");
            } else if (!stoppedRef.current) {
                setErrorMsg(err instanceof Error ? err.message : "Pipeline error");
                setAudioState("error");
            }
        } finally {
            abortControllerRef.current = null;
        }
    }, [sessionLanguage, aboutText, startReadingMonitor]);

    // ========================
    // MODO AUTO → Whisper + VAD
    // ========================
    const whisper = useWhisperRecognition({
        onQuestionDetected: handleQuestionDetected,
        apiBaseUrl: NEXT_PUBLIC_API_URL
    });

    // ========================
    // MODO FIXO → Web Speech + VAD
    // ========================
    const speech = useSpeechRecognition({
        language: sessionLanguage,
        onQuestionDetected: (q) => handleQuestionDetected(q, sessionLanguage),
    });

    // Wire up pause/resume refs
    useEffect(() => {
        if (isAutoMode) {
            pauseMicRef.current = whisper.stopListening;
            resumeMicRef.current = whisper.startListening;
        } else {
            pauseMicRef.current = speech.stopListening;
            resumeMicRef.current = speech.startListening;
        }
    }, [isAutoMode, whisper.stopListening, whisper.startListening, speech.stopListening, speech.startListening]);

    // Sync transcript
    useEffect(() => {
        const activeTranscript = isAutoMode ? whisper.transcript : speech.transcript;
        const isActive = isAutoMode ? whisper.isListening : speech.isListening;

        if (isActive && audioState !== "listening" && audioState !== "thinking" && audioState !== "reading") {
            setAudioState("listening");
        }
        setTranscript(activeTranscript);
    }, [
        whisper.isListening, whisper.transcript,
        speech.isListening, speech.transcript,
        audioState, isAutoMode
    ]);

    const startSession = useCallback(() => {
        stoppedRef.current = false;
        stopReadingMonitor();
        setAudioState("listening");
        setErrorMsg(null);
        setTranscript("");

        if (isAutoMode) {
            whisper.startListening();
        } else {
            speech.startListening();
        }
    }, [isAutoMode, whisper, speech, stopReadingMonitor]);

    const stopSession = useCallback(() => {
        stoppedRef.current = true;

        stopReadingMonitor();

        if (isAutoMode) {
            whisper.stopListening();
        } else {
            speech.stopListening();
        }

        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
        }

        setInteractions(prev => prev.map(interaction =>
            interaction.answer === ""
                ? { ...interaction, answer: "[Stopped]" }
                : interaction
        ));

        setAudioState("idle");
        setTranscript("");
        setErrorMsg(null);
        console.log("🛑 Interview stopped completely");
    }, [isAutoMode, whisper, speech, stopReadingMonitor]);

    return {
        startSession,
        stopSession,
        skipReadingPause,
        audioState,
        transcript,
        interactions,
        errorMsg,
        readingCountdown,
        language: sessionLanguage,
        isAutoMode,
        isProcessing: whisper.isProcessing,
        isSupported: isAutoMode ? whisper.isSupported : speech.isSupported
    };
}
