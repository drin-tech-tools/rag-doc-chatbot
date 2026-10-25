"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";

type UserRow = {
  id: string;
  email?: string;
  created_at?: string;
  banned_until?: string | null;
  role: "admin" | "client" | null;
  factors?: { id: string; status: string; factor_type: string }[];
};

export default function AdminUsersPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "client">("client");
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const res = await fetch("/api/admin/users");
    const data = await res.json();
    setLoading(false);
    if (!res.ok) {
      setError(data.error ?? "Failed to load users");
      return;
    }
    setUsers(data.users ?? []);
  }, []);

  useEffect(() => {
    load().catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [load]);

  async function act(body: Record<string, unknown>) {
    setMsg("");
    setError("");
    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Action failed");
      return;
    }
    setMsg("Done.");
    await load();
  }

  async function onInvite(e: FormEvent) {
    e.preventDefault();
    await act({ action: "invite", email, role });
    setEmail("");
  }

  return (
    <main style={{ maxWidth: 960 }}>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
        <h1 style={{ margin: 0 }}>Users</h1>
        <Link href="/" className="muted">
          ← Chat
        </Link>
      </div>
      <p className="muted">Invite-only access. Assign admin or client for this app.</p>

      <form onSubmit={onInvite} className="card row" style={{ flexWrap: "wrap" }}>
        <input
          type="email"
          required
          placeholder="email@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={{ minWidth: 220 }}
        />
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as "admin" | "client")}
          style={{ padding: 10, borderRadius: 8, background: "#0f172a", color: "inherit", border: "1px solid #334155" }}
        >
          <option value="client">client</option>
          <option value="admin">admin</option>
        </select>
        <button type="submit">Invite</button>
      </form>

      {error && <p style={{ color: "#f87171" }}>{error}</p>}
      {msg && <p style={{ color: "#86efac" }}>{msg}</p>}

      <div className="card" style={{ overflowX: "auto" }}>
        {loading ? (
          <p className="muted">Loading…</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr className="muted" style={{ textAlign: "left" }}>
                <th style={{ padding: 8 }}>Email</th>
                <th style={{ padding: 8 }}>Role</th>
                <th style={{ padding: 8 }}>MFA</th>
                <th style={{ padding: 8 }}>Status</th>
                <th style={{ padding: 8 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const banned = !!u.banned_until && new Date(u.banned_until) > new Date();
                const mfaCount = u.factors?.filter((f) => f.status === "verified").length ?? 0;
                return (
                  <tr key={u.id} style={{ borderTop: "1px solid #334155" }}>
                    <td style={{ padding: 8 }}>{u.email ?? u.id}</td>
                    <td style={{ padding: 8 }}>
                      <select
                        value={u.role ?? ""}
                        onChange={(e) =>
                          act({
                            action: "set_role",
                            userId: u.id,
                            role: e.target.value,
                          })
                        }
                        style={{
                          padding: 6,
                          borderRadius: 6,
                          background: "#0f172a",
                          color: "inherit",
                          border: "1px solid #334155",
                        }}
                      >
                        <option value="" disabled>
                          —
                        </option>
                        <option value="client">client</option>
                        <option value="admin">admin</option>
                      </select>
                    </td>
                    <td style={{ padding: 8 }}>{mfaCount ? `${mfaCount} factor(s)` : "none"}</td>
                    <td style={{ padding: 8 }}>{banned ? "disabled" : "active"}</td>
                    <td style={{ padding: 8 }}>
                      <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
                        {banned ? (
                          <button type="button" onClick={() => act({ action: "enable", userId: u.id })}>
                            Enable
                          </button>
                        ) : (
                          <button type="button" onClick={() => act({ action: "disable", userId: u.id })}>
                            Disable
                          </button>
                        )}
                        <button type="button" onClick={() => act({ action: "reset_mfa", userId: u.id })}>
                          Reset MFA
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (confirm(`Remove ${u.email ?? u.id}?`)) {
                              act({ action: "remove", userId: u.id });
                            }
                          }}
                        >
                          Remove
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </main>
  );
}
