"use client";

import { useAuth } from "@/context/AuthContext";
import { useRouter, usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import { LogOut, Home, Mic, Lock } from "lucide-react";

function useInterviewReady() {
    const [ready, setReady] = useState(false);
    useEffect(() => {
        if (typeof window === "undefined") return;
        const check = () => {
            const hasAbout = (localStorage.getItem("interview_about_text") || "").trim().length > 0;
            const hasLang = (localStorage.getItem("interview_language") || "").length > 0;
            setReady(hasAbout || hasLang);
        };
        check();
        window.addEventListener("storage", check);
        // Re-check on route changes (same tab won't fire storage event)
        const interval = setInterval(check, 500);
        return () => { window.removeEventListener("storage", check); clearInterval(interval); };
    }, []);
    return ready;
}

export default function DashboardLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const { isAuthenticated, loading, logout } = useAuth();
    const router = useRouter();
    const pathname = usePathname();
    const interviewReady = useInterviewReady();

    useEffect(() => {
        if (!loading && !isAuthenticated) {
            router.push("/login");
        }
    }, [loading, isAuthenticated, router]);

    // Redirect away from interview if not ready
    useEffect(() => {
        if (pathname === "/interview" && !interviewReady) {
            router.replace("/dashboard");
        }
    }, [pathname, interviewReady, router]);

    if (loading || !isAuthenticated) return null;

    return (
        <div className="min-h-screen flex bg-background text-foreground">
            {/* Sidebar - Desktop */}
            <aside className="hidden md:flex flex-col w-64 border-r border-border glass-panel z-10">
                <div className="p-6 border-b border-border">
                    <h2 className="text-xl font-bold text-gradient">Interview AI</h2>
                </div>

                <nav className="flex-1 p-4 space-y-2">
                    <Link
                        href="/dashboard"
                        className={`flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-colors ${pathname === '/dashboard' ? 'bg-primary/10 text-primary' : 'hover:bg-surface-hover text-foreground/80'}`}
                    >
                        <Home className="w-5 h-5" />
                        Dashboard
                    </Link>
                    {interviewReady ? (
                        <Link
                            href="/interview"
                            className={`flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-colors ${pathname === '/interview' ? 'bg-primary/10 text-primary' : 'hover:bg-surface-hover text-foreground/80'}`}
                        >
                            <Mic className="w-5 h-5" />
                            Interview Room
                        </Link>
                    ) : (
                        <div
                            className="flex items-center gap-3 px-4 py-3 rounded-xl font-medium text-foreground/30 cursor-not-allowed"
                            title="Fill in your profile on the Dashboard first"
                        >
                            <Lock className="w-5 h-5" />
                            Interview Room
                        </div>
                    )}
                </nav>

                <div className="p-4 border-t border-border">
                    <button
                        onClick={logout}
                        className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-red-500 font-medium hover:bg-red-500/10 transition-colors"
                    >
                        <LogOut className="w-4 h-4" />
                        Logout
                    </button>
                </div>
            </aside>

            {/* Main Content */}
            <main className="flex-1 flex flex-col relative overflow-hidden">
                {/* Mobile Header */}
                <header className="md:hidden flex items-center justify-between p-4 border-b border-border glass-panel z-10">
                    <h2 className="text-lg font-bold text-gradient">Interview AI</h2>
                    <button onClick={logout} className="p-2 text-foreground/70 hover:text-red-500 transition-colors">
                        <LogOut className="w-5 h-5" />
                    </button>
                </header>

                {children}
            </main>
        </div>
    );
}
