"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { NEXT_PUBLIC_API_URL } from "@/lib/config";
import { getToken } from "@/lib/api";
import { useSpeechRecognition } from "./useSpeechRecognition";
import { useWhisperRecognition } from "./useWhisperRecognition";

export type AudioState = "idle" | "listening" | "thinking" | "error";

export type InterviewInteraction = {
    id: string;
    question: string;
    answer: string;
};

export function useAudioInterview() {
    const [sessionLanguage, setSessionLanguage] = useState("auto");
    const [aboutText, setAboutText] = useState<string | null>(null);
    const [audioState, setAudioState] = useState<AudioState>("idle");
    const [transcript, setTranscript] = useState("");
    const [interactions, setInteractions] = useState<InterviewInteraction[]>([]);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    const abortControllerRef = useRef<AbortController | null>(null);
    const audioStateRef = useRef<AudioState>("idle");
    const stoppedRef = useRef(false);

    useEffect(() => {
        if (typeof window !== "undefined") {
            const lang = localStorage.getItem("interview_language") || "auto";
            setSessionLanguage(lang);
            setAboutText(localStorage.getItem("interview_about_text") || null);
        }
    }, []);

    // Mantém ref do audioState para evitar closures stale em callbacks
    useEffect(() => {
        audioStateRef.current = audioState;
    }, [audioState]);

    const isAutoMode = sessionLanguage === "auto";

    /*
     * handleQuestionDetected
     * Recebe a pergunta transcrita e o idioma detectado.
     * No modo Whisper, o idioma vem do Whisper/Lingua.
     * No modo Web Speech, o idioma é o sessionLanguage.
     */
    const handleQuestionDetected = useCallback(async (finalQuestion: string, detectedLanguage?: string) => {
        if (!finalQuestion.trim()) return;
        if (audioStateRef.current === "thinking") return;
        if (stoppedRef.current) return;

        const interactionId = Date.now().toString();
        setInteractions(prev => [...prev, { id: interactionId, question: finalQuestion, answer: "" }]);

        setAudioState("thinking");
        setErrorMsg(null);

        const controller = new AbortController();
        abortControllerRef.current = controller;

        // Idioma: usa o que o Whisper detectou, NÃO faz fallback para 'auto'
        const langToSend = (detectedLanguage && detectedLanguage !== "auto") ? detectedLanguage : sessionLanguage;
        console.log(`🌐 Language to send: ${langToSend} (detected: ${detectedLanguage}, session: ${sessionLanguage})`);

        try {
            const token = getToken();
            const body: Record<string, any> = {
                question: finalQuestion,
                language: langToSend
            };

            // Send about_text when available (alternative to CV)
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

            // If stopped during streaming, cancel the reader
            if (stoppedRef.current) {
                try { reader.cancel(); } catch (_) {}
                return;
            }

            setAudioState("listening");

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
    }, [sessionLanguage, aboutText]);

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
        silenceThresholdMs: 2500
    });

    // Sync transcript com o modo ativo
    useEffect(() => {
        const activeTranscript = isAutoMode ? whisper.transcript : speech.transcript;
        const isActive = isAutoMode ? whisper.isListening : speech.isListening;

        if (isActive && audioState !== "listening" && audioState !== "thinking") {
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
        setAudioState("listening");
        setErrorMsg(null);
        setTranscript("");

        if (isAutoMode) {
            whisper.startListening();
        } else {
            speech.startListening();
        }
    }, [isAutoMode, whisper, speech]);

    const stopSession = useCallback(() => {
        // 1. Marca como parado para impedir qualquer processamento
        stoppedRef.current = true;

        // 2. Para microfone
        if (isAutoMode) {
            whisper.stopListening();
        } else {
            speech.stopListening();
        }

        // 3. Aborta qualquer geração em andamento
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
        }

        // 4. Marca interações sem resposta como interrompidas
        setInteractions(prev => prev.map(interaction =>
            interaction.answer === ""
                ? { ...interaction, answer: "[Stopped]" }
                : interaction
        ));

        // 5. Limpa estado
        setAudioState("idle");
        setTranscript("");
        setErrorMsg(null);
        console.log("🛑 Interview stopped completely");
    }, [isAutoMode, whisper, speech]);

    return {
        startSession,
        stopSession,
        audioState,
        transcript,
        interactions,
        errorMsg,
        language: sessionLanguage,
        isAutoMode,
        isProcessing: whisper.isProcessing,
        isSupported: isAutoMode ? whisper.isSupported : speech.isSupported
    };
}
