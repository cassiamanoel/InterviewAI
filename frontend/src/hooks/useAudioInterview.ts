"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { NEXT_PUBLIC_API_URL } from "@/lib/config";
import { getToken } from "@/lib/api";
import { useSpeechRecognition } from "./useSpeechRecognition";

export type AudioState = "idle" | "listening" | "thinking" | "error";

export type InterviewInteraction = {
    id: string;
    question: string;
    answer: string;
};

export function useAudioInterview() {
    const [sessionLanguage, setSessionLanguage] = useState("en-US");
    const [audioState, setAudioState] = useState<AudioState>("idle");
    const [transcript, setTranscript] = useState("");
    const [interactions, setInteractions] = useState<InterviewInteraction[]>([]);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    const abortControllerRef = useRef<AbortController | null>(null);

    useEffect(() => {
        if (typeof window !== "undefined") {
            const lang = localStorage.getItem("interview_language") || "en-US";
            setSessionLanguage(lang);
        }
    }, []);

    const handleQuestionDetected = useCallback(async (finalQuestion: string) => {
        if (!finalQuestion.trim()) return;
        if (audioState === "thinking") return; // Prevent overlapping submits

        // Add new interaction placeholder
        const interactionId = Date.now().toString();
        setInteractions(prev => [...prev, { id: interactionId, question: finalQuestion, answer: "" }]);

        // We DO NOT stop listening! Copilot must keep listening to the meeting!
        // But for visual feedback, we mark state as thinking.
        setAudioState("thinking");
        setErrorMsg(null);

        const controller = new AbortController();
        abortControllerRef.current = controller;

        try {
            const token = getToken();
            const response = await fetch(`${NEXT_PUBLIC_API_URL}/interview/ask?stream=true`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${token}`
                },
                body: JSON.stringify({ question: finalQuestion }),
                signal: controller.signal
            });

            if (!response.ok) throw new Error("Failed to contact RAG engine");
            if (!response.body) throw new Error("Stream not supported");

            const reader = response.body.getReader();
            const decoder = new TextDecoder("utf-8");
            let done = false;
            let fullContent = "";

            while (!done) {
                const { value, done: readerDone } = await reader.read();
                done = readerDone;

                if (value) {
                    const chunk = decoder.decode(value, { stream: true });
                    const lines = chunk.split("\n");
                    for (const line of lines) {
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

            // Generation complete. Back to listening state visually.
            setAudioState("listening");

        } catch (err: any) {
            if (err.name === "AbortError") {
                console.log("Copilot Request Aborted");
            } else {
                setErrorMsg(err.message || "Pipeline error");
                setAudioState("error");
            }
        } finally {
            abortControllerRef.current = null;
        }
    }, [audioState]);

    const speech = useSpeechRecognition({
        language: sessionLanguage,
        onQuestionDetected: handleQuestionDetected,
        silenceThresholdMs: 2500 // 2.5 seconds of silence
    });

    // Sync internal transcript with speech transcript
    useEffect(() => {
        if (speech.isListening && audioState !== "listening" && audioState !== "thinking") {
            setAudioState("listening");
        }
        setTranscript(speech.transcript);
    }, [speech.isListening, speech.transcript, audioState]);

    const startSession = useCallback(() => {
        setAudioState("listening");
        setErrorMsg(null);
        setTranscript("");
        speech.startListening();
    }, [speech]);

    const stopSession = useCallback(() => {
        speech.stopListening();
        if (abortControllerRef.current) abortControllerRef.current.abort();
        setAudioState("idle");
    }, [speech]);

    return {
        startSession,
        stopSession,
        audioState,
        transcript,
        interactions,
        errorMsg,
        language: sessionLanguage,
        isSupported: speech.isSupported
    };
}
