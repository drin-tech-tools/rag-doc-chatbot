"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

type Source = { n: number; document: string; page: number; similarity: number; snippet: string };
type Msg = { role: "user" | "assistant"; text: string; sources?: Source[] };
type Me = { email?: string; role: string; canManageUsers: boolean };

/** Decode base64(UTF-8 JSON) from X-Rag-Sources (atob alone is Latin-1, not UTF-8-safe). */
function decodeRagSourcesHeader(header: string): Source[] {
  const binary = atob(header);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return JSON.parse(new TextDecoder().decode(bytes)) as Source[];
}

export default function Home() {
  const [me, setMe] = useState<Me | null>(null);
  const [doc, setDoc] = useState<{ documentId: string; name: string; pages: number; chunks: number } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [question, setQuestion] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/me")
      .then(async (res) => {
        if (!res.ok) return;
        setMe(await res.json());
      })
      .catch(() => {});
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
    setDoc(data);
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
        body: JSON.stringify({ question: q, documentId: doc?.documentId }),
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
      if (full.includes("[Error] Chat timed out")) {
        setError("Chat timed out after 45s. Try a shorter question or try again.");
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
        <p className="muted">
          {uploading
            ? "Parsing, chunking and embedding…"
            : doc
              ? `${doc.name}: ${doc.pages} pages, ${doc.chunks} chunks indexed`
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
