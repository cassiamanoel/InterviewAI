"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { NEXT_PUBLIC_API_URL } from "@/lib/config";
import { getToken } from "@/lib/api";
import { useSpeechRecognition } from "./useSpeechRecognition";
import { useWhisperRecognition } from "./useWhisperRecognition";

export type AudioState = "idle" | "listening" | "thinking" | "reading" | "error";

export type InterviewInteraction = {
    id: string;
    question: string;
    answer: string;
};

// 3 seconds of absolute silence required before mic resumes
const SILENCE_REQUIRED_MS = 3000;
// Volume below this RMS threshold counts as silence (0–1 range)
const SILENCE_VOLUME_THRESHOLD = 0.015;
// How often we sample the audio level
const MONITOR_INTERVAL_MS = 100;

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

    // Silence monitor refs
    const silenceMonitorRef = useRef<NodeJS.Timeout | null>(null);
    const silenceAudioCtxRef = useRef<AudioContext | null>(null);
    const silenceStreamRef = useRef<MediaStream | null>(null);
    const silenceStartRef = useRef<number>(0);
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
    // SILENCE MONITOR
    // ========================
    // Uses AudioContext + AnalyserNode to measure ambient volume
    // WITHOUT transcribing anything. Once 3s of continuous silence
    // is detected, it stops and resumes the speech mic.

    const stopSilenceMonitor = useCallback(() => {
        if (silenceMonitorRef.current) {
            clearInterval(silenceMonitorRef.current);
            silenceMonitorRef.current = null;
        }
        if (countdownIntervalRef.current) {
            clearInterval(countdownIntervalRef.current);
            countdownIntervalRef.current = null;
        }
        if (silenceAudioCtxRef.current) {
            silenceAudioCtxRef.current.close().catch(() => {});
            silenceAudioCtxRef.current = null;
        }
        if (silenceStreamRef.current) {
            silenceStreamRef.current.getTracks().forEach(t => t.stop());
            silenceStreamRef.current = null;
        }
        setReadingCountdown(0);
    }, []);

    const startSilenceMonitor = useCallback(async () => {
        if (stoppedRef.current) return;

        setAudioState("reading");
        setReadingCountdown(Math.ceil(SILENCE_REQUIRED_MS / 1000));
        silenceStartRef.current = 0;

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            silenceStreamRef.current = stream;

            const audioCtx = new AudioContext();
            silenceAudioCtxRef.current = audioCtx;

            const source = audioCtx.createMediaStreamSource(stream);
            const analyser = audioCtx.createAnalyser();
            analyser.fftSize = 512;
            source.connect(analyser);

            const dataArray = new Float32Array(analyser.fftSize);
            let consecutiveSilenceMs = 0;

            // Visual countdown: update every second
            countdownIntervalRef.current = setInterval(() => {
                if (stoppedRef.current) return;
                const remaining = Math.ceil((SILENCE_REQUIRED_MS - consecutiveSilenceMs) / 1000);
                setReadingCountdown(Math.max(0, remaining));
            }, 200);

            // Audio level polling
            silenceMonitorRef.current = setInterval(() => {
                if (stoppedRef.current) {
                    stopSilenceMonitor();
                    return;
                }

                analyser.getFloatTimeDomainData(dataArray);

                // Calculate RMS volume
                let sum = 0;
                for (let i = 0; i < dataArray.length; i++) {
                    sum += dataArray[i] * dataArray[i];
                }
                const rms = Math.sqrt(sum / dataArray.length);

                if (rms < SILENCE_VOLUME_THRESHOLD) {
                    // Silence — accumulate
                    consecutiveSilenceMs += MONITOR_INTERVAL_MS;
                } else {
                    // Sound detected — reset
                    consecutiveSilenceMs = 0;
                }

                if (consecutiveSilenceMs >= SILENCE_REQUIRED_MS) {
                    // 3s of absolute silence achieved → resume mic
                    stopSilenceMonitor();
                    if (!stoppedRef.current) {
                        resumeMicRef.current?.();
                        setAudioState("listening");
                        console.log("🎤 3s silence detected — mic resumed");
                    }
                }
            }, MONITOR_INTERVAL_MS);

        } catch (e: any) {
            console.error("Silence monitor error:", e);
            // Fallback: resume mic after fixed 3s if audio monitoring fails
            stopSilenceMonitor();
            setTimeout(() => {
                if (!stoppedRef.current) {
                    resumeMicRef.current?.();
                    setAudioState("listening");
                }
            }, SILENCE_REQUIRED_MS);
        }
    }, [stopSilenceMonitor]);

    const skipReadingPause = useCallback(() => {
        stopSilenceMonitor();
        if (!stoppedRef.current) {
            resumeMicRef.current?.();
            setAudioState("listening");
            console.log("🎤 Reading skipped manually — mic resumed");
        }
    }, [stopSilenceMonitor]);

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
            const body: Record<string, any> = {
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
                            } catch (e) { }
                        }
                    }
                }
            }

            if (stoppedRef.current) {
                try { reader.cancel(); } catch (_) {}
                return;
            }

            // 2. Response complete → start silence monitor (mic stays paused)
            startSilenceMonitor();

        } catch (err: any) {
            if (err.name === "AbortError") {
                console.log("Request Aborted");
            } else if (!stoppedRef.current) {
                setErrorMsg(err.message || "Pipeline error");
                setAudioState("error");
            }
        } finally {
            abortControllerRef.current = null;
        }
    }, [sessionLanguage, aboutText, startSilenceMonitor]);

    // ========================
    // MODO AUTO → Whisper
    // ========================
    const whisper = useWhisperRecognition({
        onQuestionDetected: handleQuestionDetected,
        silenceThresholdMs: 3000,
        apiBaseUrl: NEXT_PUBLIC_API_URL
    });

    // ========================
    // MODO FIXO → Web Speech API
    // ========================
    const speech = useSpeechRecognition({
        language: sessionLanguage,
        onQuestionDetected: (q) => handleQuestionDetected(q, sessionLanguage),
        silenceThresholdMs: 3000
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
        stopSilenceMonitor();
        setAudioState("listening");
        setErrorMsg(null);
        setTranscript("");

        if (isAutoMode) {
            whisper.startListening();
        } else {
            speech.startListening();
        }
    }, [isAutoMode, whisper, speech, stopSilenceMonitor]);

    const stopSession = useCallback(() => {
        stoppedRef.current = true;

        stopSilenceMonitor();

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
    }, [isAutoMode, whisper, speech, stopSilenceMonitor]);

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
