"use client";
import { useState } from "react";

type Source = { n: number; document: string; page: number; similarity: number; snippet: string };
type Msg = { role: "user" | "assistant"; text: string; sources?: Source[] };

export default function Home() {
  const [doc, setDoc] = useState<{ documentId: string; name: string; pages: number; chunks: number } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [question, setQuestion] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function upload(file: File) {
    setUploading(true); setError("");
    const fd = new FormData(); fd.append("file", file);
    const res = await fetch("/api/upload", { method: "POST", body: fd });
    const data = await res.json();
    setUploading(false);
    if (!res.ok) return setError(data.error);
    setDoc(data);
  }

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    if (!question.trim()) return;
    const q = question; setQuestion(""); setError("");
    setMsgs((m) => [...m, { role: "user", text: q }]);
    setLoading(true);
    const res = await fetch("/api/chat", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: q, documentId: doc?.documentId }),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) return setError(data.error);
    setMsgs((m) => [...m, { role: "assistant", text: data.answer, sources: data.sources }]);
  }

  return (
    <main>
      <h1>📄 RAG Doc Chatbot</h1>
      <p className="muted">Upload a PDF, then ask questions. Answers cite the source pages.</p>

      <div className="card">
        <input type="file" accept="application/pdf" disabled={uploading}
          onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        <p className="muted">
          {uploading ? "Parsing, chunking and embedding…" :
            doc ? `✅ ${doc.name}: ${doc.pages} pages, ${doc.chunks} chunks indexed` : "No document selected (questions search all indexed docs)."}
        </p>
      </div>

      <div className="card">
        {msgs.length === 0 && <p className="muted">Ask something like “Summarize the key findings.”</p>}
        {msgs.map((m, i) => (
          <div key={i} className="msg">
            <strong className={m.role === "user" ? "user" : ""}>{m.role === "user" ? "You" : "Assistant"}:</strong> {m.text}
            {m.sources?.map((s) => (
              <div key={s.n} className="src">[{s.n}] {s.document}, page {s.page} (score {s.similarity.toFixed(2)}): {s.snippet}…</div>
            ))}
          </div>
        ))}
        {loading && <p className="muted">Thinking…</p>}
        {error && <p style={{ color: "#f87171" }}>{error}</p>}
        <form onSubmit={ask} className="row">
          <input type="text" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask a question about your document" />
          <button disabled={loading}>Ask</button>
        </form>
      </div>
    </main>
  );
}
