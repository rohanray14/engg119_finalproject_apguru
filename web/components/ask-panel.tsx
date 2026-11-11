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
  explanation?: string | null;
}

const suggestions = [
  "Which families still owe us?",
  "How much total received?",
  "What is our cash position?",
  "Who paid the largest amount?",
  "How many installments are overdue?",
  "How many unmatched payments?",
  "What are the total expenses?",
  "Expense breakdown by category",
  "Revenue per student — who brings in the most?",
  "Seasonal trends — which months see the most payments?",
  "Gateway comparison — fees by payment method",
  "Commission cost as a % of total revenue",
  "Average days to pay after due date",
  "Which cities generate the most revenue?",
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
          explanation: result.how_worked_out,
        },
      ]);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Something went wrong";
      if (msg.includes("Too many")) {
        setError("Too many questions in a minute. Try again shortly.");
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-white rounded-lg border" style={{ borderColor: "var(--card-border)" }}>
      {/* Input bar — always visible */}
      <div className="p-4 flex items-center gap-3">
        <span className="text-sm font-medium text-gray-500">Ask</span>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAsk(input)}
          placeholder="e.g. Which families still owe us for November?"
          className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
          disabled={loading}
        />
        <button
          onClick={() => handleAsk(input)}
          disabled={loading || !input.trim()}
          className="px-4 py-2 text-sm font-medium text-white rounded-md disabled:opacity-50"
          style={{ backgroundColor: "var(--sidebar-bg)" }}
        >
          Ask
        </button>
        {messages.length > 0 && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="text-xs text-gray-400 hover:text-gray-600 shrink-0"
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
                className="text-xs px-2.5 py-1 border border-gray-200 rounded-full hover:bg-gray-50 text-gray-500"
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
          style={{ borderColor: "var(--card-border)" }}>
          {messages.map((msg, i) =>
            msg.role === "user" ? (
              <div key={i} className="flex justify-end">
                <div className="px-4 py-2.5 rounded-xl text-white text-sm max-w-[70%]"
                  style={{ backgroundColor: "var(--sidebar-bg)" }}>
                  {msg.content}
                </div>
              </div>
            ) : (
              <div key={i} className="bg-gray-50 rounded-lg p-4">
                <div className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">{msg.content}</div>
                {msg.transactions && msg.transactions.length > 0 && (
                  <div className="mt-3 overflow-x-auto">
                    <table className="text-xs w-full">
                      <thead>
                        <tr className="text-left text-gray-500 border-b">
                          {Object.keys(msg.transactions[0]).map((k) => (
                            <th key={k} className="px-2 py-1 font-medium">{k}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {msg.transactions.map((row, j) => (
                          <tr key={j}>
                            {Object.values(row).map((v, k) => (
                              <td key={k} className="px-2 py-1">{String(v ?? "\u2014")}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {msg.explanation && (
                  <details className="mt-3">
                    <summary className="text-xs text-gray-400 cursor-pointer">How this was worked out</summary>
                    <pre className="mt-2 text-xs text-gray-500 whitespace-pre-wrap bg-white p-3 rounded">
                      {msg.explanation}
                    </pre>
                  </details>
                )}
              </div>
            )
          )}
          {loading && (
            <div className="bg-gray-50 rounded-lg p-4 animate-pulse">
              <div className="h-4 bg-gray-200 rounded w-3/4" />
              <div className="h-4 bg-gray-200 rounded w-1/2 mt-2" />
            </div>
          )}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{error}</div>
          )}
        </div>
      )}
    </div>
  );
}
