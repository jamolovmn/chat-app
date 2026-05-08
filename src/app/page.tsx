"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { loginMatrix } from "@/lib/matrix";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      await loginMatrix(username, password);
      router.push("/chat");
    } catch (err: unknown) {
      const e = err as any;
      const msg = e?.data?.error || e?.message || String(err);
      setError(msg || "Username yoki parol noto'g'ri");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-on-surface tracking-tight">Kirish</h1>
        </div>

        <form onSubmit={handleLogin} className="bg-white/80 backdrop-blur-xl rounded-3xl p-6 shadow-sm border border-white/40 space-y-4">
          <div>
            <label className="block text-sm font-medium text-on-surface-variant mb-1.5">Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="test"
              required
              className="w-full bg-surface-container-low rounded-xl px-4 py-3 text-on-surface placeholder:text-outline border border-outline-variant/30 focus:outline-none focus:border-primary-container focus:ring-2 focus:ring-primary-container/20 transition-all"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-on-surface-variant mb-1.5">Parol</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              className="w-full bg-surface-container-low rounded-xl px-4 py-3 text-on-surface placeholder:text-outline border border-outline-variant/30 focus:outline-none focus:border-primary-container focus:ring-2 focus:ring-primary-container/20 transition-all"
            />
          </div>

          {error && (
            <p className="text-error text-sm bg-error-container/30 rounded-lg px-3 py-2">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-primary-container text-on-primary py-3.5 rounded-2xl font-semibold text-base shadow-sm hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-50"
          >
            {loading ? "Ulanmoqda..." : "Kirish"}
          </button>
        </form>
      </div>
    </div>
  );
}
