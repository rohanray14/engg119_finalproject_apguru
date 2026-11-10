"use client";

import { Suspense, useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
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
];

export default function AskPage() {
  return (
    <Suspense fallback={<div className="p-8"><div className="animate-pulse h-64 bg-gray-200 rounded" /></div>}>
      <AskContent />
    </Suspense>
  );
}

function AskContent() {
  const searchParams = useSearchParams();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Handle ?q= param from Today page
  useEffect(() => {
    const q = searchParams.get("q");
    if (q && messages.length === 0) {
      handleAsk(q);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

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
    <div className="p-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-6">Ask</h1>

      {/* Chat messages */}
      <div className="space-y-4 mb-6">
        {messages.map((msg, i) =>
          msg.role === "user" ? (
            <div key={i} className="flex justify-end">
              <div className="px-4 py-3 rounded-xl text-white text-sm max-w-[70%]"
                style={{ backgroundColor: "var(--sidebar-bg)" }}>
                {msg.content}
              </div>
            </div>
          ) : (
            <div key={i} className="bg-white rounded-lg border p-5" style={{ borderColor: "var(--card-border)" }}>
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
                            <td key={k} className="px-2 py-1">{String(v ?? "—")}</td>
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
                  <pre className="mt-2 text-xs text-gray-500 whitespace-pre-wrap bg-gray-50 p-3 rounded">
                    {msg.explanation}
                  </pre>
                </details>
              )}
            </div>
          )
        )}
        {loading && (
          <div className="bg-white rounded-lg border p-5 animate-pulse" style={{ borderColor: "var(--card-border)" }}>
            <div className="h-4 bg-gray-200 rounded w-3/4" />
            <div className="h-4 bg-gray-200 rounded w-1/2 mt-2" />
          </div>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 text-sm text-red-700">{error}</div>
      )}

      {/* Suggestions (only before first message) */}
      {messages.length === 0 && (
        <div className="mb-6">
          <p className="text-xs text-gray-400 mb-2">Try asking</p>
          <div className="flex flex-wrap gap-2">
            {suggestions.map((s, i) => (
              <button
                key={i}
                onClick={() => handleAsk(s)}
                className="text-sm px-3 py-1.5 border border-gray-300 rounded-full hover:bg-gray-50 text-gray-700"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input */}
      <div className="flex gap-3">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAsk(input)}
          placeholder="Ask about payments, families, commissions..."
          className="flex-1 text-sm border border-gray-300 rounded-md px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-teal-500"
          disabled={loading}
        />
        <button
          onClick={() => handleAsk(input)}
          disabled={loading || !input.trim()}
          className="px-5 py-2.5 text-sm font-medium text-white rounded-md disabled:opacity-50"
          style={{ backgroundColor: "var(--sidebar-bg)" }}
        >
          Ask
        </button>
      </div>
    </div>
  );
}
