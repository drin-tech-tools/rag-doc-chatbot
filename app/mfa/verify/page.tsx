"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { AuthShell } from "@/app/components/AuthShell";

export default function MfaVerifyPage() {
  const router = useRouter();
  const [factorId, setFactorId] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const { data, error: listErr } = await supabase.auth.mfa.listFactors();
      if (cancelled) return;
      if (listErr) {
        setError(listErr.message);
        return;
      }
      const totp = data.totp.find((f) => f.status === "verified") ?? data.totp[0];
      if (!totp) {
        router.replace("/mfa/setup");
        return;
      }
      setFactorId(totp.id);
    })().catch((e) => {
      if (!cancelled) setError(e instanceof Error ? e.message : "Could not load factors");
    });
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!factorId || !code.trim()) return;
    setLoading(true);
    setError("");
    try {
      const challengeRes = await fetch("/api/auth/mfa/challenge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ factorId }),
      });
      const challenge = await challengeRes.json();
      if (!challengeRes.ok) {
        setError(challenge.error ?? "Challenge failed");
        setLoading(false);
        return;
      }

      const verifyRes = await fetch("/api/auth/mfa/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          factorId,
          challengeId: challenge.challengeId,
          code: code.trim(),
        }),
      });
      const verified = await verifyRes.json();
      if (!verifyRes.ok) {
        setError(verified.error ?? "Invalid code");
        setLoading(false);
        return;
      }
      router.replace(verified.redirectTo ?? "/");
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Verification failed");
      setLoading(false);
    }
  }

  return (
    <AuthShell>
      <h1>Two-factor verification</h1>
      <p className="muted">Enter the 6-digit code from your authenticator app.</p>
      <form onSubmit={onSubmit} className="card" style={{ display: "grid", gap: 12, maxWidth: 420 }}>
        <label className="muted">
          Authentication code
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
            style={{ display: "block", width: "100%", marginTop: 4 }}
          />
        </label>
        {error && <p style={{ color: "#f87171", margin: 0 }}>{error}</p>}
        <button type="submit" disabled={loading || !factorId}>
          {loading ? "Verifying…" : "Verify"}
        </button>
        <p className="muted" style={{ margin: 0 }}>
          Lost your device? Ask an admin to reset MFA. <a href="/api/auth/logout">Sign out</a>
        </p>
      </form>
    </AuthShell>
  );
}
