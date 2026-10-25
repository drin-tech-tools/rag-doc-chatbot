"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthShell } from "@/app/components/AuthShell";

export default function SetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/set-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not set password");
        setLoading(false);
        return;
      }
      router.replace(data.redirectTo ?? "/mfa/setup");
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not set password");
      setLoading(false);
    }
  }

  return (
    <AuthShell>
      <h1>Choose a password</h1>
      <p className="muted">
        You were invited to RAG Doc Chatbot. Set a password (min 10 characters), then enroll MFA.
      </p>
      <form onSubmit={onSubmit} className="card" style={{ display: "grid", gap: 12, maxWidth: 420 }}>
        <label className="muted">
          New password
          <input
            type="password"
            autoComplete="new-password"
            minLength={10}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{ display: "block", width: "100%", marginTop: 4 }}
          />
        </label>
        <label className="muted">
          Confirm password
          <input
            type="password"
            autoComplete="new-password"
            minLength={10}
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            style={{ display: "block", width: "100%", marginTop: 4 }}
          />
        </label>
        {error && <p style={{ color: "#f87171", margin: 0 }}>{error}</p>}
        <button type="submit" disabled={loading}>
          {loading ? "Saving…" : "Continue to MFA setup"}
        </button>
      </form>
    </AuthShell>
  );
}
