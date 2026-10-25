"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthShell } from "@/app/components/AuthShell";

export default function MfaSetupPage() {
  const router = useRouter();
  const [factorId, setFactorId] = useState("");
  const [qrCode, setQrCode] = useState("");
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/auth/mfa/enroll", { method: "POST" });
      const data = await res.json();
      if (cancelled) return;
      if (!res.ok) {
        setError(data.error ?? "Could not start MFA enrollment");
        return;
      }
      setFactorId(data.factorId);
      setQrCode(data.qrCode);
      setSecret(data.secret);
    })().catch((e) => {
      if (!cancelled) setError(e instanceof Error ? e.message : "Enrollment failed");
    });
    return () => {
      cancelled = true;
    };
  }, []);

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
      <h1>Set up two-factor authentication</h1>
      <p className="muted">
        Scan the QR code with an authenticator app (Google Authenticator, 1Password, Authy, …), then
        enter a 6-digit code. MFA is required for every account.
      </p>
      <div className="card" style={{ maxWidth: 420 }}>
        {qrCode ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={qrCode}
            alt="TOTP QR code"
            width={200}
            height={200}
            style={{ background: "#fff", borderRadius: 8, padding: 8 }}
          />
        ) : (
          <p className="muted">Generating QR code…</p>
        )}
        {secret && (
          <p className="muted" style={{ wordBreak: "break-all" }}>
            Manual secret: <code>{secret}</code>
          </p>
        )}
        <form onSubmit={onSubmit} style={{ display: "grid", gap: 12, marginTop: 12 }}>
          <label className="muted">
            Verification code
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
            {loading ? "Verifying…" : "Enable MFA"}
          </button>
        </form>
        <p className="muted" style={{ marginTop: 16 }}>
          <a href="/api/auth/logout">Sign out</a>
        </p>
      </div>
    </AuthShell>
  );
}
