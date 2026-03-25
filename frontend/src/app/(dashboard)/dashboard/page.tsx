"use client";

import { UploadCloud, FileText, CheckCircle, Languages, Loader2, User, Mic } from "lucide-react";
import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { getToken } from "@/lib/api";
import { NEXT_PUBLIC_API_URL } from "@/lib/config";

export default function DashboardPage() {
    const router = useRouter();
    const [file, setFile] = useState<File | null>(null);
    const [aboutText, setAboutText] = useState("");
    const [language, setLanguage] = useState<string>("auto");
    const [loading, setLoading] = useState(false);
    const [uploadSuccess, setUploadSuccess] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Validation: at least one of aboutText or file must be provided
    const hasAboutText = aboutText.trim().length > 0;
    const hasFile = file !== null;
    const isValid = hasAboutText || hasFile;
    const canStartInterview = isValid && (uploadSuccess || !hasFile);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            setFile(e.target.files[0]);
            setUploadSuccess(false);
            setError(null);
        }
    };

    const handleRemoveFile = () => {
        setFile(null);
        setUploadSuccess(false);
        setError(null);
    };

    const handleUpload = async () => {
        if (!file) return;

        setLoading(true);
        setError(null);
        setUploadSuccess(false);

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

            setUploadSuccess(true);
        } catch (err: any) {
            setError(err.message || "An unexpected error occurred.");
        } finally {
            setLoading(false);
        }
    };

    const startInterview = () => {
        if (!isValid) return;

        // Store settings for Interview Room
        if (typeof window !== "undefined") {
            localStorage.setItem("interview_language", language);
            if (hasAboutText) {
                localStorage.setItem("interview_about_text", aboutText.trim());
            } else {
                localStorage.removeItem("interview_about_text");
            }
        }

        router.push("/interview");
    };

    // Determine what action button to show
    const needsUpload = hasFile && !uploadSuccess;

    return (
        <div className="flex-1 flex flex-col items-center justify-center p-6 bg-background">
            <div className="max-w-xl w-full">
                {/* Header */}
                <div className="text-center mb-10 animate-in slide-in-from-top-8 duration-500">
                    <h1 className="text-4xl font-extrabold tracking-tight text-foreground">
                        Prepare for your <span className="text-gradient">Interview</span>
                    </h1>
                    <p className="mt-3 text-foreground/70">
                        Tell us about yourself or upload your resume, then select a language.
                    </p>
                </div>

                {/* Card Principal */}
                <div className="glass-panel p-8 rounded-3xl space-y-8 animate-in zoom-in-95 duration-500 delay-150 fill-mode-both">

                    {/* Section 1: About You */}
                    <div className="space-y-4">
                        <h2 className="text-xl font-semibold flex items-center gap-2">
                            <User className="w-5 h-5 text-primary" />
                            1. About You
                            {!hasFile && (
                                <span className="text-xs font-normal text-red-400 ml-1">
                                    (required if no resume attached)
                                </span>
                            )}
                        </h2>

                        <textarea
                            value={aboutText}
                            onChange={(e) => setAboutText(e.target.value)}
                            placeholder="Describe your experience, skills, and background. E.g.: 'I'm a Senior Backend Engineer with 5 years of experience in Python, FastAPI, and AWS...'"
                            rows={4}
                            maxLength={5000}
                            className="w-full p-4 rounded-2xl border border-border bg-background/50 text-foreground placeholder:text-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary resize-none transition-all"
                        />
                        <div className="text-xs text-foreground/40 text-right">
                            {aboutText.length}/5000
                        </div>
                    </div>

                    {/* Divider */}
                    <div className="flex items-center gap-4">
                        <div className="flex-1 h-px bg-border" />
                        <span className="text-sm font-medium text-foreground/50 uppercase">or</span>
                        <div className="flex-1 h-px bg-border" />
                    </div>

                    {/* Section 2: Resume Upload */}
                    <div className="space-y-4">
                        <h2 className="text-xl font-semibold flex items-center gap-2">
                            <FileText className="w-5 h-5 text-primary" />
                            2. Resume / CV
                            {!hasAboutText && (
                                <span className="text-xs font-normal text-red-400 ml-1">
                                    (required if "About You" is empty)
                                </span>
                            )}
                        </h2>

                        <div className={`border-2 border-dashed rounded-2xl p-8 text-center transition-all ${uploadSuccess ? 'border-green-500 bg-green-500/5' : 'border-border hover:border-primary/50 bg-background/50'}`}>
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
                                {uploadSuccess ? (
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

                            {file && !uploadSuccess && (
                                <button
                                    onClick={(e) => { e.preventDefault(); handleRemoveFile(); }}
                                    className="mt-2 text-xs text-red-400 hover:text-red-500 transition-colors"
                                >
                                    Remove file
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Section 3: Language Selection */}
                    <div className="space-y-4">
                        <h2 className="text-xl font-semibold flex items-center gap-2">
                            <Languages className="w-5 h-5 text-secondary" />
                            3. Interview Language
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

                        <p className="text-xs text-foreground/40">
                            {language === "auto"
                                ? "The system will detect the language of your speech and respond in the same language."
                                : "The system will always respond in the selected language, regardless of what language you speak."
                            }
                        </p>
                    </div>

                    {/* Validation message */}
                    {!isValid && (
                        <div className="bg-amber-500/10 text-amber-500 text-sm p-3 rounded-lg border border-amber-500/20">
                            Please fill in the "About You" field or attach a resume to continue.
                        </div>
                    )}

                    {/* Error */}
                    {error && (
                        <div className="bg-red-500/10 text-red-500 text-sm p-3 rounded-lg border border-red-500/20">
                            {error}
                        </div>
                    )}

                    {/* Actions */}
                    <div className="pt-4 flex flex-col sm:flex-row gap-3">
                        {needsUpload ? (
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
                                disabled={!canStartInterview}
                                className="flex-1 py-4 bg-green-500 hover:bg-green-600 text-white rounded-xl font-bold transition-all shadow-lg shadow-green-500/30 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed animate-in slide-in-from-bottom-4"
                            >
                                <Mic className="w-5 h-5" />
                                Start Interview
                            </button>
                        )}
                    </div>

                </div>
            </div>
        </div>
    );
}
