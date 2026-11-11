"use client";

import { useState } from "react";
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
  const [expanded, setExpanded] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAsk(question: string) {
    if (!question.trim() || loading) return;
    if (!expanded) setExpanded(true);
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

  return (
    <div className="rounded-lg border" style={{ backgroundColor: "var(--surface)", borderColor: "var(--card-border)" }}>
      {/* Input bar — always visible */}
      <div className="p-4 flex items-center gap-3">
        <span className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>Ask</span>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAsk(input)}
          placeholder="e.g. Which families still owe us for November?"
          className="flex-1 px-3 py-2 text-sm rounded-md focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
          style={{ backgroundColor: "var(--surface-hover)", borderColor: "var(--border)", color: "var(--text)", border: "1px solid var(--border)" }}
          disabled={loading}
        />
        <button
          onClick={() => handleAsk(input)}
          disabled={loading || !input.trim()}
          className="px-4 py-2 text-sm font-medium rounded-md disabled:opacity-50"
          style={{ backgroundColor: "var(--accent)", color: "var(--bg)" }}
        >
          Ask
        </button>
        {messages.length > 0 && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="text-xs shrink-0"
            style={{ color: "var(--text-tertiary)" }}
          >
            {expanded ? "Hide" : "Show"} chat
          </button>
        )}
      </div>

      {/* Suggestions — only before first message and when not expanded */}
      {messages.length === 0 && !expanded && (
        <div className="px-4 pb-4">
          <div className="flex flex-wrap gap-2">
            {suggestions.map((s, i) => (
              <button
                key={i}
                onClick={() => handleAsk(s)}
                className="text-xs px-2.5 py-1 border rounded-full"
                style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Chat panel — collapsible */}
      {expanded && (
        <div className="border-t px-4 pb-4 pt-3 space-y-3 max-h-[400px] overflow-y-auto"
          style={{ borderColor: "var(--border)" }}>
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
                              <td key={k} className="px-2 py-1" style={{ color: "var(--text)" }}>{String(v ?? "\u2014")}</td>
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
