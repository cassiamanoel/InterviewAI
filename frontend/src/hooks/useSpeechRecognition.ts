"use client";

import { useState, useEffect, useRef, useCallback } from "react";

const SpeechRecognition = typeof window !== "undefined" && ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

type SpeechRecognitionHookParams = {
    language?: string;
    onQuestionDetected?: (question: string) => void;
    silenceThresholdMs?: number;
};

export function useSpeechRecognition({
    language = "en-US",
    onQuestionDetected,
    silenceThresholdMs = 2500
}: SpeechRecognitionHookParams = {}) {
    const [isListening, setIsListening] = useState(false);
    const [transcript, setTranscript] = useState("");
    const [error, setError] = useState<string | null>(null);

    const recognitionRef = useRef<any>(null);
    const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);
    const currentBufferRef = useRef<string>("");

    // Track intentional listening state for stale closures inside useEffect
    const isListeningRef = useRef<boolean>(false);

    // Track the latest callback to avoid dependencies re-firing the engine
    const onQuestionDetectedRef = useRef(onQuestionDetected);
    useEffect(() => {
        onQuestionDetectedRef.current = onQuestionDetected;
    }, [onQuestionDetected]);

    const isQuestion = (text: string) => {
        if (!text) return false;
        const lower = text.toLowerCase().trim();

        if (lower.includes('?')) return true;

        const keywords = [
            "what", "how", "why", "where", "when", "who", "which",
            "tell me about", "explain", "describe", "give me an example", "how would you",
            "can you", "could you", "do you", "have you", "what are",
            "o que", "como", "por que", "onde", "quando", "quem", "qual",
            "me conte", "me fale", "explique", "descreva", "dê um exemplo",
            "você pode", "poderia", "você já", "você tem",
            "qué", "dónde", "cuándo", "quién", "cuál",
            "cuéntame", "háblame", "explica", "describe", "dame un ejemplo",
            "puedes", "podrías", "tienes", "has", "tuviste"
        ];

        return keywords.some(k => lower.includes(k) || lower.startsWith(k));
    };

    useEffect(() => {
        if (!SpeechRecognition) {
            setError("Web Speech API is not supported. Use Google Chrome.");
            return;
        }

        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        
        // Mapeamento de idiomas e suporte a Auto-Detect
        // IMPORTANTE: Web Speech API NÃO suporta auto-detect.
        // No modo "auto", usamos pt-BR como padrão (idioma principal do usuário).
        // O backend (Lingua) cuida da detecção real do idioma do TEXTO.
        let runLang = language;
        if (language === "auto") {
            runLang = "pt-BR";
        } else if (language === "pt") {
            runLang = "pt-BR";
        } else if (language === "es") {
            runLang = "es-ES";
        }
        
        recognition.lang = runLang;
        recognitionRef.current = recognition;

        recognition.onstart = () => {
            console.log("🎤 Speech recognition started");
            setIsListening(true);
            setError(null);
        };

        recognition.onerror = (event: any) => {
            if (event.error !== "no-speech" && event.error !== "aborted") {
                console.error("Speech Recognition Error:", event.error);
                setError(`Error: ${event.error}`);
                setIsListening(false);
                isListeningRef.current = false;
            }
        };

        recognition.onend = () => {
            console.log("🛑 Speech recognition ended. Intended state:", isListeningRef.current);
            if (isListeningRef.current && recognitionRef.current) {
                try {
                    recognitionRef.current.start();
                } catch (e) {
                    console.error("Failed to auto-restart recognition", e);
                    setIsListening(false);
                    isListeningRef.current = false;
                }
            } else {
                setIsListening(false);
            }
        };

        recognition.onresult = (event: any) => {
            let currentInterim = "";
            let newlyFinalized = "";

            for (let i = event.resultIndex; i < event.results.length; ++i) {
                if (event.results[i].isFinal) {
                    newlyFinalized += event.results[i][0].transcript + " ";
                } else {
                    currentInterim += event.results[i][0].transcript;
                }
            }

            if (newlyFinalized) {
                currentBufferRef.current += newlyFinalized;
            }

            const displayTranscript = currentBufferRef.current + currentInterim;
            setTranscript(displayTranscript);

            if (silenceTimerRef.current) {
                clearTimeout(silenceTimerRef.current);
            }

            if (displayTranscript.trim() !== "") {
                silenceTimerRef.current = setTimeout(() => {
                    const finalBuffer = currentBufferRef.current.trim();

                    if (isQuestion(finalBuffer)) {
                        if (onQuestionDetectedRef.current) {
                            onQuestionDetectedRef.current(finalBuffer);
                        }
                        currentBufferRef.current = "";
                        setTranscript("");
                    } else if (finalBuffer.length > 50) {
                        if (onQuestionDetectedRef.current) {
                            onQuestionDetectedRef.current(finalBuffer);
                        }
                        currentBufferRef.current = "";
                        setTranscript("");
                    }
                }, silenceThresholdMs);
            }
        };

        return () => {
            console.log("🧹 Cleaning up speech recognition", { isListeningRef: isListeningRef.current });
            if (recognitionRef.current) recognitionRef.current.abort();
            if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
        };
        // Removed all volatile functions from dependencies to prevent Chrome microfone stuttering
    }, [language, silenceThresholdMs]);

    const startListening = useCallback(() => {
        if (!recognitionRef.current) return;
        
        // Se já estamos ouvindo segundo nossa ref, não fazemos nada
        if (isListeningRef.current) {
            console.log("⚠️ Já está ouvindo (ref)");
            return;
        }

        currentBufferRef.current = "";
        setTranscript("");
        isListeningRef.current = true;
        
        try {
            // Pequeno hack: abortamos qualquer processamento pendente antes de iniciar 
            // para garantir que a instância esteja limpa
            recognitionRef.current.abort(); 
            
            // Damos um fôlego para o navegador processar o abort
            setTimeout(() => {
                try {
                    if (isListeningRef.current) { // Verifica se ainda queremos ouvir
                        recognitionRef.current.start();
                    }
                } catch (e) {
                    // Se ainda der erro de "already started", ignoramos pois o objetivo era estar iniciado mesmo
                    if (!(e instanceof Error && e.message.includes("already started"))) {
                        console.error("Erro ao iniciar Recognition no timeout", e);
                        isListeningRef.current = false;
                        setIsListening(false);
                    }
                }
            }, 50);
        } catch (e) {
            console.error("Erro crítico no startListening", e);
            isListeningRef.current = false;
            setIsListening(false);
        }
    }, []);

    const stopListening = useCallback(() => {
        if (recognitionRef.current && isListeningRef.current) {
            isListeningRef.current = false;
            recognitionRef.current.stop();
            setIsListening(false);
            if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
        }
    }, []);

    return {
        isListening,
        transcript,
        error,
        startListening,
        stopListening,
        isSupported: !!SpeechRecognition
    };
}
