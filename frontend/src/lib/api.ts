import { NEXT_PUBLIC_API_URL } from "./config";

export function getToken() {
    if (typeof window !== "undefined") {
        return localStorage.getItem("access_token");
    }
    return null;
}

export function setToken(token: string) {
    if (typeof window !== "undefined") {
        localStorage.setItem("access_token", token);
    }
}

export function removeToken() {
    if (typeof window !== "undefined") {
        localStorage.removeItem("access_token");
    }
}

export async function fetchApi(endpoint: string, options: RequestInit = {}) {
    const token = getToken();

    const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...(options.headers as Record<string, string>),
    };

    if (token) {
        headers["Authorization"] = `Bearer ${token}`;
    }

    const response = await fetch(`${NEXT_PUBLIC_API_URL}${endpoint}`, {
        ...options,
        headers,
    });

    if (!response.ok) {
        let errorMessage = "API falhou";
        try {
            const errData = await response.json();
            errorMessage = errData.detail || errorMessage;
        } catch {
            // Ignora erro de parse se não for json
        }
        throw new Error(typeof errorMessage === "string" ? errorMessage : JSON.stringify(errorMessage));
    }

    return response.json();
}
