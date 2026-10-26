"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

type Source = { n: number; document: string; page: number; similarity: number; snippet: string };
type Msg = { role: "user" | "assistant"; text: string; sources?: Source[] };
type Me = { email?: string; role: string; canManageUsers: boolean };
type DocOption = { documentId: string; name: string; pages?: number; chunks?: number };

/** Decode base64(UTF-8 JSON) from X-Rag-Sources (atob alone is Latin-1, not UTF-8-safe). */
function decodeRagSourcesHeader(header: string): Source[] {
  const binary = atob(header);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return JSON.parse(new TextDecoder().decode(bytes)) as Source[];
}

export default function Home() {
  const [me, setMe] = useState<Me | null>(null);
  const [docs, setDocs] = useState<DocOption[]>([]);
  const [doc, setDoc] = useState<DocOption | null>(null);
  const [uploading, setUploading] = useState(false);
  const [question, setQuestion] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function refreshDocs(selectId?: string) {
    try {
      const res = await fetch("/api/documents");
      if (!res.ok) return;
      const data = (await res.json()) as { documents?: DocOption[] };
      const list = data.documents ?? [];
      setDocs(list);
      setDoc((current) => {
        const preferredId = selectId ?? current?.documentId;
        if (preferredId) {
          const match = list.find((d) => d.documentId === preferredId);
          if (match) return { ...match, pages: current?.pages, chunks: current?.chunks };
        }
        return list[0] ?? null;
      });
    } catch {
      /* ignore list failures — upload/chat still work */
    }
  }

  useEffect(() => {
    fetch("/api/me")
      .then(async (res) => {
        if (!res.ok) return;
        setMe(await res.json());
      })
      .catch(() => {});
    void refreshDocs();
  }, []);

  async function upload(file: File) {
    setUploading(true);
    setError("");
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/upload", { method: "POST", body: fd });
    const data = await res.json();
    setUploading(false);
    if (!res.ok) return setError(data.error);
    const uploaded: DocOption = {
      documentId: data.documentId,
      name: data.name,
      pages: data.pages,
      chunks: data.chunks,
    };
    // Immediately select the just-uploaded doc so the next question scopes to it.
    setDoc(uploaded);
    setDocs((prev) => [uploaded, ...prev.filter((d) => d.documentId !== uploaded.documentId)]);
    await refreshDocs(uploaded.documentId);
  }

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    if (!question.trim()) return;
    const q = question;
    setQuestion("");
    setError("");
    setMsgs((m) => [...m, { role: "user", text: q }, { role: "assistant", text: "" }]);
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, documentId: doc?.documentId ?? null }),
      });

      const contentType = res.headers.get("content-type") ?? "";

      if (contentType.includes("application/json")) {
        const data = await res.json();
        setLoading(false);
        if (!res.ok) {
          setMsgs((m) => m.slice(0, -1));
          return setError(data.error ?? "Chat failed");
        }
        setMsgs((m) => {
          const next = [...m];
          next[next.length - 1] = { role: "assistant", text: data.answer, sources: data.sources };
          return next;
        });
        return;
      }

      if (!res.ok) {
        setLoading(false);
        setMsgs((m) => m.slice(0, -1));
        return setError(`Chat failed (${res.status})`);
      }

      let sources: Source[] = [];
      const sourcesHeader = res.headers.get("X-Rag-Sources");
      if (sourcesHeader) {
        try {
          sources = decodeRagSourcesHeader(sourcesHeader);
        } catch {
          /* ignore malformed header */
        }
      }

      setMsgs((m) => {
        const next = [...m];
        next[next.length - 1] = { role: "assistant", text: "", sources };
        return next;
      });

      const reader = res.body?.getReader();
      if (!reader) {
        setLoading(false);
        return setError("No response body");
      }

      const decoder = new TextDecoder();
      let full = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        full += decoder.decode(value, { stream: true });
        const text = full;
        setMsgs((m) => {
          const next = [...m];
          next[next.length - 1] = { role: "assistant", text, sources };
          return next;
        });
      }

      setLoading(false);
      if (/\[Error\].*timed out/i.test(full)) {
        setError(full.replace(/^[\s\S]*\[Error\]\s*/, "").trim() || "Chat timed out");
      }
    } catch (err: unknown) {
      setLoading(false);
      setMsgs((m) => m.slice(0, -1));
      setError(err instanceof Error ? err.message : "Chat failed");
    }
  }

  return (
    <main>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div>
          <h1>RAG Doc Chatbot</h1>
          <p className="muted" style={{ margin: 0 }}>
            Upload a PDF, then ask questions. Answers cite the source pages.
            {me?.email ? ` Signed in as ${me.email} (${me.role}).` : ""}
          </p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          {me?.canManageUsers && (
            <Link href="/admin/users">
              <button type="button">Users</button>
            </Link>
          )}
          <a href="/api/auth/logout">
            <button type="button">Log out</button>
          </a>
        </div>
      </div>

      <div className="card">
        <input
          type="file"
          accept="application/pdf"
          disabled={uploading}
          onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
        />
        <label className="muted" style={{ display: "block", marginTop: 12 }}>
          Document for questions
          <select
            value={doc?.documentId ?? ""}
            onChange={(e) => {
              const id = e.target.value;
              if (!id) {
                setDoc(null);
                return;
              }
              const match = docs.find((d) => d.documentId === id);
              setDoc(match ?? { documentId: id, name: id });
            }}
            style={{ display: "block", width: "100%", marginTop: 4 }}
          >
            <option value="">
              {me?.role === "admin"
                ? "All indexed documents"
                : "All of your documents"}
            </option>
            {docs.map((d) => (
              <option key={d.documentId} value={d.documentId}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <p className="muted">
          {uploading
            ? "Parsing, chunking and embedding…"
            : doc
              ? `${doc.name} selected${
                  doc.pages != null && doc.chunks != null
                    ? ` (${doc.pages} pages, ${doc.chunks} chunks)`
                    : ""
                }`
              : me?.role === "admin"
                ? "No document selected (questions search all indexed docs)."
                : "No document selected (questions search your documents only)."}
        </p>
      </div>

      <div className="card">
        {msgs.length === 0 && <p className="muted">Ask something like “Summarize the key findings.”</p>}
        {msgs.map((m, i) => (
          <div key={i} className="msg">
            <strong className={m.role === "user" ? "user" : ""}>
              {m.role === "user" ? "You" : "Assistant"}:
            </strong>{" "}
            {m.text || (m.role === "assistant" && loading ? "…" : "")}
            {m.sources?.map((s) => (
              <div key={s.n} className="src">
                [{s.n}] {s.document}, page {s.page} (score {s.similarity.toFixed(2)}): {s.snippet}…
              </div>
            ))}
          </div>
        ))}
        {loading && msgs[msgs.length - 1]?.text === "" && <p className="muted">Thinking…</p>}
        {error && <p style={{ color: "#f87171" }}>{error}</p>}
        <form onSubmit={ask} className="row">
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask a question about your document"
          />
          <button disabled={loading}>Ask</button>
        </form>
      </div>
    </main>
  );
}
