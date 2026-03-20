import Link from "next/link";

export default function LandingPage() {
  return (
    <main className="flex-1 flex flex-col items-center justify-center p-8 bg-gradient-to-br from-background to-surface-hover">
      <div className="glass-panel max-w-2xl w-full p-12 rounded-3xl text-center space-y-8 animate-in fade-in zoom-in duration-700">
        <h1 className="text-5xl font-extrabold tracking-tight">
          Welcome to <span className="text-gradient">Interview AI</span>
        </h1>
        <p className="text-lg text-foreground/80 leading-relaxed">
          Prepare for your next technical interview with a state-of-the-art AI. Our RAG-powered engine analyzes your CV and conducts a realistic, real-time interview to hone your skills.
        </p>

        <div className="flex items-center justify-center gap-4 pt-4">
          <Link href="/login" className="px-8 py-3 rounded-full bg-primary hover:bg-primary-hover text-white font-semibold transition-all hover:scale-105 active:scale-95 shadow-lg shadow-primary/30">
            Login
          </Link>
          <Link href="/register" className="px-8 py-3 rounded-full border border-border hover:bg-surface-hover text-foreground font-semibold transition-all hover:scale-105 active:scale-95">
            Create Account
          </Link>
        </div>
      </div>
    </main>
  );
}
