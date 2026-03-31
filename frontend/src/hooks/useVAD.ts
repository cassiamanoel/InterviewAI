"use client";

import { useRef, useState, useCallback, useEffect } from "react";

/**
 * useVAD — Voice Activity Detection via Silero VAD (ONNX)
 *
 * Provides accurate speech start/end detection using a neural model
 * running locally in the browser. Replaces timer-based silence detection.
 *
 * Events:
 *   onSpeechStart()  — user started speaking
 *   onSpeechEnd(audio: Float32Array) — user stopped speaking, includes the audio segment
 *   onVADMisfire()   — very short speech detected (likely noise)
 *
 * The hook manages its own MediaStream and AudioContext.
 */

type UseVADParams = {
    onSpeechStart?: () => void;
    onSpeechEnd?: (audio: Float32Array) => void;
    onVADMisfire?: () => void;
    /** Probability threshold to consider speech (0-1). Default 0.5 */
    positiveSpeechThreshold?: number;
    /** Probability threshold to consider silence (0-1). Default 0.35 */
    negativeSpeechThreshold?: number;
    /** Min speech duration in ms to avoid misfires. Default 250 */
    minSpeechMs?: number;
    /** Grace period in ms before triggering speech end. Default 300 */
    redemptionMs?: number;
    /** Ms of audio to prepend before speech start. Default 300 */
    preSpeechPadMs?: number;
};

export function useVAD({
    onSpeechStart,
    onSpeechEnd,
    onVADMisfire,
    positiveSpeechThreshold = 0.5,
    negativeSpeechThreshold = 0.35,
    minSpeechMs = 250,
    redemptionMs = 300,
    preSpeechPadMs = 300,
}: UseVADParams = {}) {
    const [isListening, setIsListening] = useState(false);
    const [isSpeaking, setIsSpeaking] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const vadRef = useRef<{ start: () => void; pause: () => Promise<void> | void; destroy: () => Promise<void> | void; listening: boolean } | null>(null);
    const isListeningRef = useRef(false);

    // Keep callbacks in refs to avoid re-initialization
    const onSpeechStartRef = useRef(onSpeechStart);
    const onSpeechEndRef = useRef(onSpeechEnd);
    const onVADMisfireRef = useRef(onVADMisfire);

    useEffect(() => { onSpeechStartRef.current = onSpeechStart; }, [onSpeechStart]);
    useEffect(() => { onSpeechEndRef.current = onSpeechEnd; }, [onSpeechEnd]);
    useEffect(() => { onVADMisfireRef.current = onVADMisfire; }, [onVADMisfire]);

    const startListening = useCallback(async () => {
        if (isListeningRef.current) return;

        setLoading(true);
        setError(null);

        try {
            // Dynamic import to avoid SSR issues
            const { MicVAD } = await import("@ricky0123/vad-web");

            const vad = await MicVAD.new({
                positiveSpeechThreshold,
                negativeSpeechThreshold,
                minSpeechMs,
                redemptionMs,
                preSpeechPadMs,
                model: "v5",
                baseAssetPath: "/vad/",
                onnxWASMBasePath: "/vad/",
                onSpeechStart: () => {
                    setIsSpeaking(true);
                    onSpeechStartRef.current?.();
                },
                onSpeechEnd: (audio: Float32Array) => {
                    setIsSpeaking(false);
                    onSpeechEndRef.current?.(audio);
                },
                onVADMisfire: () => {
                    setIsSpeaking(false);
                    onVADMisfireRef.current?.();
                },
            });

            vadRef.current = vad;
            vad.start();

            isListeningRef.current = true;
            setIsListening(true);
            setLoading(false);
            console.log("🧠 VAD started (Silero v5)");

        } catch (e: unknown) {
            console.error("VAD start error:", e);
            setError(e instanceof Error ? e.message : "Failed to initialize VAD");
            setLoading(false);
            isListeningRef.current = false;
            setIsListening(false);
        }
    }, [positiveSpeechThreshold, negativeSpeechThreshold, minSpeechMs, redemptionMs, preSpeechPadMs]);

    const stopListening = useCallback(() => {
        isListeningRef.current = false;
        setIsListening(false);
        setIsSpeaking(false);

        if (vadRef.current) {
            try {
                vadRef.current.pause();
                vadRef.current.destroy();
            } catch (_e) {
                console.error("VAD stop error:", _e);
            }
            vadRef.current = null;
        }
        console.log("🛑 VAD stopped");
    }, []);

    const pauseListening = useCallback(() => {
        if (vadRef.current) {
            try { vadRef.current.pause(); } catch { /* ignore */ }
        }
        setIsListening(false);
        setIsSpeaking(false);
    }, []);

    const resumeListening = useCallback(() => {
        if (vadRef.current) {
            try { vadRef.current.start(); } catch { /* ignore */ }
            isListeningRef.current = true;
            setIsListening(true);
        }
    }, []);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (vadRef.current) {
                try {
                    vadRef.current.pause();
                    vadRef.current.destroy();
                } catch { /* ignore */ }
                vadRef.current = null;
            }
        };
    }, []);

    return {
        isListening,
        isSpeaking,
        loading,
        error,
        startListening,
        stopListening,
        pauseListening,
        resumeListening,
        isSupported: typeof window !== "undefined" && !!window.AudioContext,
    };
}
