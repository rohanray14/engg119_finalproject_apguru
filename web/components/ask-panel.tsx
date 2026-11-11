"use client";

import { useState, useRef, useEffect } from "react";
import { apiFetch } from "@/lib/api";

interface AskResult {
  question: string;
  answer: string;
  transactions: Record<string, unknown>[] | null;
  how_worked_out: string | null;
  confidence: number;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  transactions?: Record<string, unknown>[] | null;
}

const suggestions = [
  "Which families still owe us?",
  "What is our cash position?",
  "How many installments are overdue?",
  "Expense breakdown by category",
];

export default function AskPanel() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chatRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [messages, loading]);

  async function handleAsk(question: string) {
    if (!question.trim() || loading) return;
    setLoading(true);
    setError(null);
    setMessages((prev) => [...prev, { role: "user", content: question }]);
    setInput("");

    try {
      const result = await apiFetch<AskResult>("/ask", {
        method: "POST",
        body: { question },
      });
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: result.answer,
          transactions: result.transactions,
        },
      ]);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Something went wrong";
      if (msg.includes("Too many")) {
        setError("Too many questions in a minute. Wait about 30 seconds and try again.");
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }

  const hasMessages = messages.length > 0;

  return (
    <div className="rounded-xl border" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
      {/* Header + input */}
      <div className="p-5">
        <div className="flex items-center gap-2 mb-3">
          <svg className="w-4 h-4" style={{ color: "var(--accent)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
          </svg>
          <h3 className="font-bold" style={{ color: "var(--text)" }}>Ask about your finances</h3>
        </div>
        <p className="text-xs mb-4" style={{ color: "var(--text-secondary)" }}>
          Ask any question about payments, students, overdue amounts, or expenses. The AI will query your data and answer.
        </p>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAsk(input)}
            placeholder="e.g. Which families still owe us for November?"
            className="flex-1 px-3 py-2.5 text-sm rounded-lg focus:outline-none"
            style={{ backgroundColor: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)" }}
            disabled={loading}
          />
          <button
            onClick={() => handleAsk(input)}
            disabled={loading || !input.trim()}
            className="px-4 py-2.5 text-sm font-medium rounded-lg disabled:opacity-40"
            style={{ backgroundColor: "var(--accent)", color: "var(--bg)" }}
          >
            Ask
          </button>
        </div>
      </div>

      {/* Suggestions — show when no messages yet */}
      {!hasMessages && (
        <div className="px-5 pb-5">
          <div className="text-[10px] uppercase tracking-wider font-medium mb-2" style={{ color: "var(--text-tertiary)" }}>
            Try asking
          </div>
          <div className="flex flex-wrap gap-2">
            {suggestions.map((s, i) => (
              <button
                key={i}
                onClick={() => handleAsk(s)}
                className="text-xs px-3 py-1.5 rounded-lg transition-colors"
                style={{ backgroundColor: "var(--surface-hover)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Chat messages */}
      {hasMessages && (
        <div ref={chatRef} className="border-t px-5 pb-5 pt-4 space-y-3 max-h-[400px] overflow-y-auto"
          style={{ borderColor: "var(--border-subtle)" }}>
          {messages.map((msg, i) =>
            msg.role === "user" ? (
              <div key={i} className="flex justify-end">
                <div className="px-4 py-2.5 rounded-xl text-sm max-w-[70%]"
                  style={{ backgroundColor: "var(--accent)", color: "var(--bg)" }}>
                  {msg.content}
                </div>
              </div>
            ) : (
              <div key={i} className="rounded-lg p-4" style={{ backgroundColor: "var(--surface-hover)" }}>
                <div className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: "var(--text)" }}>{msg.content}</div>
                {msg.transactions && msg.transactions.length > 0 && (
                  <div className="mt-3 overflow-x-auto">
                    <table className="text-xs w-full">
                      <thead>
                        <tr className="text-left border-b" style={{ color: "var(--text-secondary)", borderColor: "var(--border)" }}>
                          {Object.keys(msg.transactions[0]).map((k) => (
                            <th key={k} className="px-2 py-1 font-medium">{k}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y" style={{ borderColor: "var(--border-subtle)" }}>
                        {msg.transactions.map((row, j) => (
                          <tr key={j}>
                            {Object.values(row).map((v, k) => (
                              <td key={k} className="px-2 py-1" style={{ color: "var(--text)" }}>{String(v ?? "—")}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )
          )}
          {loading && (
            <div className="rounded-lg p-4 animate-pulse" style={{ backgroundColor: "var(--surface-hover)" }}>
              <div className="h-4 rounded w-3/4" style={{ backgroundColor: "var(--surface)" }} />
              <div className="h-4 rounded w-1/2 mt-2" style={{ backgroundColor: "var(--surface)" }} />
            </div>
          )}
          {error && (
            <div className="border rounded-lg p-3 text-sm" style={{ backgroundColor: "rgba(255,77,77,0.1)", borderColor: "var(--danger)", color: "var(--danger)" }}>{error}</div>
          )}
        </div>
      )}
    </div>
  );
}
