"use client";

import { useAudioInterview } from "@/hooks/useAudioInterview";
import { Mic, MicOff, Loader2, Volume2, AlertCircle } from "lucide-react";
import { useEffect } from "react";

export default function AudioInterviewPage() {
    const {
        startSession,
        stopSession,
        audioState,
        transcript,
        interactions,
        errorMsg,
        isSupported
    } = useAudioInterview();

    // Warn user if Web Speech is not supported
    if (!isSupported) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center p-6 bg-background h-full w-full">
                <AlertCircle className="w-16 h-16 text-red-500 mb-4" />
                <h2 className="text-2xl font-bold">Browser Not Supported</h2>
                <p className="mt-2 text-foreground/70 text-center max-w-md">
                    The Web Speech API is required for this feature. Please use Google Chrome, Microsoft Edge, or Safari on desktop or mobile.
                </p>
            </div>
        );
    }

    // Helper to render the pulsating radar based on state
    const renderVisualizer = () => {
        switch (audioState) {
            case "listening":
                return (
                    <div className="relative flex items-center justify-center mb-12">
                        <div className="absolute w-48 h-48 bg-primary/20 rounded-full animate-ping delay-75"></div>
                        <div className="absolute w-32 h-32 bg-primary/40 rounded-full animate-ping"></div>
                        <div className="relative z-10 w-24 h-24 bg-primary text-white rounded-full flex items-center justify-center shadow-[0_0_40px_rgba(139,92,246,0.6)]">
                            <Mic className="w-10 h-10 animate-pulse" />
                        </div>
                    </div>
                );
            case "thinking":
                return (
                    <div className="relative flex items-center justify-center mb-12">
                        <div className="relative z-10 w-24 h-24 bg-surface-hover border-2 border-primary text-primary rounded-full flex items-center justify-center shadow-lg">
                            <Loader2 className="w-10 h-10 animate-spin" />
                        </div>
                    </div>
                );

            default:
                return (
                    <div className="relative flex items-center justify-center mb-12">
                        <button
                            onClick={startSession}
                            className="relative z-10 w-24 h-24 bg-surface-hover text-foreground/50 hover:bg-primary/10 hover:text-primary rounded-full flex items-center justify-center transition-all duration-300 shadow-md group"
                        >
                            <MicOff className="w-10 h-10 group-hover:scale-110 transition-transform" />
                        </button>
                    </div>
                );
        }
    };

    const statusText = {
        idle: "Ready to begin",
        listening: "Listening for questions...",
        thinking: "Generating answer...",
        error: "An error occurred",
    }[audioState];

    return (
        <div className="flex-1 flex flex-col h-full bg-background text-foreground relative overflow-hidden">
            {/* Immersive Background Gradients */}
            <div className={`absolute inset-0 pointer-events-none transition-opacity duration-1000 ${audioState !== 'idle' ? 'opacity-100' : 'opacity-0'}`}>
                {audioState === 'listening' && <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-br from-primary/5 to-transparent"></div>}
            </div>

            {/* Header */}
            <header className="flex items-center justify-center p-6 border-b border-border/50 z-10">
                <h1 className="text-xl font-bold tracking-tight">Audio Interview Room</h1>
            </header>

            {/* Main Content (Visualizer & Transcripts) */}
            <main className="flex-1 flex flex-col items-center justify-center p-8 z-10">

                {renderVisualizer()}

                <div className="text-sm font-semibold text-foreground/50 uppercase tracking-widest mb-6">
                    {statusText}
                </div>

                {errorMsg && (
                    <div className="bg-red-500/10 text-red-500 px-6 py-3 rounded-xl border border-red-500/20 mb-6 text-center max-w-lg">
                        {errorMsg}
                    </div>
                )}

                {/* Text Cards */}
                <div className="w-full max-w-4xl space-y-6 overflow-y-auto pb-8">
                    {interactions.map((interaction) => (
                        <div key={interaction.id} className="bg-surface-hover border border-border p-6 rounded-3xl shadow-sm space-y-4">
                            <div>
                                <span className="text-xs font-bold text-foreground/50 uppercase">Detected Question:</span>
                                <p className="text-lg leading-relaxed text-foreground mt-1">"{interaction.question}"</p>
                            </div>
                            {interaction.answer ? (
                                <div className="bg-primary/5 rounded-2xl p-4 border border-primary/20">
                                    <span className="text-xs font-bold text-primary uppercase">Copilot Suggestion:</span>
                                    <p className="text-md leading-relaxed text-foreground mt-1 whitespace-pre-wrap">{interaction.answer}</p>
                                </div>
                            ) : (
                                <div className="animate-pulse flex items-center gap-2 text-primary/70 bg-primary/5 rounded-2xl p-4 border border-primary/20">
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    <span className="text-sm font-semibold">Generating suggested answer...</span>
                                </div>
                            )}
                        </div>
                    ))}

                    {transcript && (
                        <div className="bg-background border border-dashed border-border p-4 rounded-2xl opacity-70">
                            <span className="text-xs font-bold text-foreground/50 uppercase">Live Transcript...</span>
                            <p className="text-md italic text-foreground mt-1">{transcript}</p>
                        </div>
                    )}
                </div>

            </main>

            {/* Footer Controls */}
            <footer className="p-8 flex justify-center z-10 border-t border-border/50 bg-background/50 backdrop-blur-sm relative">
                {audioState === "idle" || audioState === "error" ? (
                    <button
                        onClick={startSession}
                        className="px-10 py-4 bg-primary hover:bg-primary-hover text-white rounded-full font-bold text-lg transition-all shadow-lg hover:shadow-primary/50"
                    >
                        Start Interview
                    </button>
                ) : (
                    <button
                        onClick={stopSession}
                        className="px-8 py-3 bg-red-500 hover:bg-red-600 text-white rounded-full font-bold transition-all shadow-lg hover:shadow-red-500/50"
                    >
                        End Interview
                    </button>
                )}
            </footer>
        </div>
    );
}
