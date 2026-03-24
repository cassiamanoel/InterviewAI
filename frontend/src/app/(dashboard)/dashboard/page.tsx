"use client";

import { UploadCloud, FileText, CheckCircle, Languages, Loader2 } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { fetchApi, getToken } from "@/lib/api";
import { NEXT_PUBLIC_API_URL } from "@/lib/config";

export default function DashboardPage() {
    const router = useRouter();
    const [file, setFile] = useState<File | null>(null);
    const [language, setLanguage] = useState<string>("auto");
    const [loading, setLoading] = useState(false);
    const [success, setSuccess] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            setFile(e.target.files[0]);
            setSuccess(false);
            setError(null);
        }
    };

    const handleUpload = async () => {
        if (!file) return;

        setLoading(true);
        setError(null);
        setSuccess(false);

        try {
            const token = getToken();
            const formData = new FormData();
            formData.append("file", file);

            const response = await fetch(`${NEXT_PUBLIC_API_URL}/cv/upload`, {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${token}`
                },
                body: formData,
            });

            if (!response.ok) {
                throw new Error("Failed to upload CV. Please try again.");
            }

            setSuccess(true);

            // Armazena o idioma para a próxima tela
            if (typeof window !== "undefined") {
                localStorage.setItem("interview_language", language);
            }

        } catch (err: any) {
            setError(err.message || "An unexpected error occurred.");
        } finally {
            setLoading(false);
        }
    };

    const startInterview = () => {
        router.push("/interview");
    };

    return (
        <div className="flex-1 flex flex-col items-center justify-center p-6 bg-background">
            <div className="max-w-xl w-full">
                {/* Header */}
                <div className="text-center mb-10 animate-in slide-in-from-top-8 duration-500">
                    <h1 className="text-4xl font-extrabold tracking-tight text-foreground">
                        Prepare for your <span className="text-gradient">Interview</span>
                    </h1>
                    <p className="mt-3 text-foreground/70">
                        Upload your resume and select the interview language to get started.
                    </p>
                </div>

                {/* Card Principal */}
                <div className="glass-panel p-8 rounded-3xl space-y-8 animate-in zoom-in-95 duration-500 delay-150 fill-mode-both">

                    {/* Sessão de Upload */}
                    <div className="space-y-4">
                        <h2 className="text-xl font-semibold flex items-center gap-2">
                            <FileText className="w-5 h-5 text-primary" />
                            1. Resume / CV
                        </h2>

                        <div className={`border-2 border-dashed rounded-2xl p-8 text-center transition-all ${success ? 'border-green-500 bg-green-500/5' : 'border-border hover:border-primary/50 bg-background/50'}`}>
                            <input
                                type="file"
                                id="cv-upload"
                                className="hidden"
                                accept=".txt,.pdf,.docx"
                                onChange={handleFileChange}
                            />
                            <label
                                htmlFor="cv-upload"
                                className="cursor-pointer flex flex-col items-center justify-center gap-3"
                            >
                                {success ? (
                                    <CheckCircle className="w-12 h-12 text-green-500" />
                                ) : (
                                    <UploadCloud className="w-12 h-12 text-foreground/40" />
                                )}

                                <div className="text-sm font-medium">
                                    {file ? (
                                        <span className="text-primary">{file.name}</span>
                                    ) : (
                                        <span>Click to browse <span className="text-foreground/50 font-normal">(.pdf, .txt, .docx)</span></span>
                                    )}
                                </div>
                            </label>
                        </div>
                    </div>

                    {/* Sessão de Idioma */}
                    <div className="space-y-4">
                        <h2 className="text-xl font-semibold flex items-center gap-2">
                            <Languages className="w-5 h-5 text-secondary" />
                            2. Interview Language
                        </h2>

                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            {[
                                { code: "auto", label: "Auto Detect" },
                                { code: "en-US", label: "English" },
                                { code: "pt-BR", label: "Portuguese" },
                                { code: "es-ES", label: "Spanish" },
                            ].map((lang) => (
                                <button
                                    key={lang.code}
                                    onClick={() => setLanguage(lang.code)}
                                    className={`p-3 rounded-xl border font-medium transition-all ${language === lang.code ? 'border-secondary bg-secondary/10 text-secondary' : 'border-border bg-background hover:bg-surface-hover hover:border-foreground/30'}`}
                                >
                                    {lang.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Erro Geral */}
                    {error && (
                        <div className="bg-red-500/10 text-red-500 text-sm p-3 rounded-lg border border-red-500/20">
                            {error}
                        </div>
                    )}

                    {/* Ações */}
                    <div className="pt-4 flex flex-col sm:flex-row gap-3">
                        {!success ? (
                            <button
                                onClick={handleUpload}
                                disabled={!file || loading}
                                className="flex-1 py-4 bg-primary hover:bg-primary-hover text-white rounded-xl font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                            >
                                {loading && <Loader2 className="w-5 h-5 animate-spin" />}
                                {loading ? "Processing CV..." : "Upload & Prepare"}
                            </button>
                        ) : (
                            <button
                                onClick={startInterview}
                                className="flex-1 py-4 bg-green-500 hover:bg-green-600 text-white rounded-xl font-bold transition-all shadow-lg shadow-green-500/30 flex items-center justify-center gap-2 animate-in slide-in-from-bottom-4"
                            >
                                Start Voice Interview Configuration →
                            </button>
                        )}
                    </div>

                </div>
            </div>
        </div>
    );
}
