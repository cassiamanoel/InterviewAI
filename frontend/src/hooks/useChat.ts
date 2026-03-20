import { useState, useRef, useCallback } from "react";
import { NEXT_PUBLIC_API_URL } from "@/lib/config";
import { getToken } from "@/lib/api";

export type Message = {
    id: string;
    role: "user" | "ai";
    content: string;
    sources?: any[];
};

export function useChat() {
    const [messages, setMessages] = useState<Message[]>([]);
    const [isTyping, setIsTyping] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const abortControllerRef = useRef<AbortController | null>(null);

    const sendMessage = useCallback(async (question: string) => {
        if (!question.trim()) return;

        // 1. Add user message
        const userMsg: Message = { id: Date.now().toString(), role: "user", content: question };
        setMessages((prev) => [...prev, userMsg]);
        setIsTyping(true);
        setError(null);

        // 2. Setup AI placeholder 
        const aiId = (Date.now() + 1).toString();
        setMessages((prev) => [...prev, { id: aiId, role: "ai", content: "" }]);

        // 3. Setup Abort Controller for Graceful Disconnect
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
                body: JSON.stringify({ question }),
                signal: controller.signal
            });

            if (!response.ok) {
                let errDesc = "Failed to start interview stream";
                try {
                    const errjson = await response.json();
                    errDesc = errjson.detail?.message || errjson.detail || errDesc;
                } catch { }
                throw new Error(errDesc);
            }

            if (!response.body) throw new Error("ReadableStream not supported by browser.");

            const reader = response.body.getReader();
            const decoder = new TextDecoder("utf-8");

            let done = false;

            while (!done) {
                const { value, done: readerDone } = await reader.read();
                done = readerDone;

                if (value) {
                    const chunk = decoder.decode(value, { stream: true });
                    const lines = chunk.split("\n");

                    for (const line of lines) {
                        if (line.startsWith("data: ")) {
                            const dataStr = line.replace("data: ", "").trim();
                            if (dataStr === "[DONE]") {
                                done = true;
                                break;
                            }

                            try {
                                const parsed = JSON.parse(dataStr);

                                if (parsed.type === "chunk") {
                                    setMessages((prev) =>
                                        prev.map((msg) =>
                                            msg.id === aiId
                                                ? { ...msg, content: msg.content + parsed.content }
                                                : msg
                                        )
                                    );
                                } else if (parsed.type === "sources") {
                                    setMessages((prev) =>
                                        prev.map((msg) =>
                                            msg.id === aiId
                                                ? { ...msg, sources: parsed.sources }
                                                : msg
                                        )
                                    );
                                } else if (parsed.type === "error") {
                                    throw new Error(parsed.message);
                                }
                            } catch (e) {
                                // Ignore silent JSON parse errors mid-chunk
                            }
                        }
                    }
                }
            }
        } catch (err: any) {
            if (err.name === "AbortError") {
                console.log("Client aborted the connection.");
            } else {
                setError(err.message || "An error occurred during streaming.");
                // Append error notice
                setMessages((prev) =>
                    prev.map((msg) =>
                        msg.id === aiId && msg.content === ""
                            ? { ...msg, content: "⚠️ Sorry, an error occurred." }
                            : msg
                    )
                );
            }
        } finally {
            setIsTyping(false);
            abortControllerRef.current = null;
        }
    }, []);

    const cancel = useCallback(() => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
            setIsTyping(false);
        }
    }, []);

    return {
        messages,
        sendMessage,
        isTyping,
        error,
        cancel
    };
}
