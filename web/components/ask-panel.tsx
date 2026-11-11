"use client";

import { useState, useRef, useEffect, useCallback } from "react";
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
  displayedContent?: string;
  isTyping?: boolean;
}

const suggestions = [
  "Which families still owe us?",
  "What is our cash position?",
  "How many installments are overdue?",
  "Expense breakdown by category",
];

function TypingMessage({ content, onDone }: { content: string; onDone: () => void }) {
  const [displayed, setDisplayed] = useState("");
  const idx = useRef(0);

  useEffect(() => {
    idx.current = 0;
    setDisplayed("");
  }, [content]);

  useEffect(() => {
    if (idx.current >= content.length) {
      onDone();
      return;
    }
    const timer = setTimeout(() => {
      // Type 2-4 chars at a time for natural speed
      const chunk = Math.min(idx.current + 3, content.length);
      setDisplayed(content.slice(0, chunk));
      idx.current = chunk;
    }, 18);
    return () => clearTimeout(timer);
  }, [displayed, content, onDone]);

  return <span>{displayed}<span className="animate-pulse">|</span></span>;
}

export default function AskPanel() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typingIdx, setTypingIdx] = useState<number | null>(null);
  const chatRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [messages, loading, typingIdx]);

  const handleTypingDone = useCallback(() => {
    setTypingIdx(null);
  }, []);

  async function handleAsk(question: string) {
    if (!question.trim() || loading) return;
    setLoading(true);
    setError(null);
    const userMsg: Message = { role: "user", content: question };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");

    try {
      const result = await apiFetch<AskResult>("/ask", {
        method: "POST",
        body: { question },
      });
      const assistantMsg: Message = {
        role: "assistant",
        content: result.answer,
        isTyping: true,
      };
      setMessages((prev) => {
        const newMessages = [...prev, assistantMsg];
        setTypingIdx(newMessages.length - 1);
        return newMessages;
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Something went wrong";
      if (msg.includes("Too many")) {
        setError("Too many questions — wait about 30 seconds.");
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
      {/* Chat history */}
      {hasMessages && (
        <div ref={chatRef} className="px-5 pt-5 pb-3 space-y-3 max-h-[400px] overflow-y-auto">
          {messages.map((msg, i) =>
            msg.role === "user" ? (
              <div key={i} className="flex justify-end">
                <div className="px-4 py-2.5 rounded-2xl rounded-br-md text-sm max-w-[75%]"
                  style={{ backgroundColor: "var(--accent)", color: "var(--bg)" }}>
                  {msg.content}
                </div>
              </div>
            ) : (
              <div key={i} className="flex justify-start">
                <div className="px-4 py-2.5 rounded-2xl rounded-bl-md text-sm max-w-[75%] leading-relaxed whitespace-pre-wrap"
                  style={{ backgroundColor: "var(--surface-hover)", color: "var(--text)" }}>
                  {typingIdx === i ? (
                    <TypingMessage content={msg.content} onDone={handleTypingDone} />
                  ) : (
                    msg.content
                  )}
                </div>
              </div>
            )
          )}
          {loading && (
            <div className="flex justify-start">
              <div className="px-4 py-3 rounded-2xl rounded-bl-md"
                style={{ backgroundColor: "var(--surface-hover)" }}>
                <div className="flex gap-1.5">
                  <span className="w-2 h-2 rounded-full animate-bounce" style={{ backgroundColor: "var(--text-tertiary)", animationDelay: "0ms" }} />
                  <span className="w-2 h-2 rounded-full animate-bounce" style={{ backgroundColor: "var(--text-tertiary)", animationDelay: "150ms" }} />
                  <span className="w-2 h-2 rounded-full animate-bounce" style={{ backgroundColor: "var(--text-tertiary)", animationDelay: "300ms" }} />
                </div>
              </div>
            </div>
          )}
          {error && (
            <div className="flex justify-start">
              <div className="px-4 py-2.5 rounded-2xl rounded-bl-md text-sm"
                style={{ backgroundColor: "rgba(255,77,77,0.1)", color: "var(--danger)" }}>
                {error}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Suggestions — show when no messages yet */}
      {!hasMessages && (
        <div className="px-5 pt-5 pb-3">
          <div className="flex items-center gap-2 mb-3">
            <svg className="w-4 h-4" style={{ color: "var(--accent)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
            </svg>
            <h3 className="font-bold text-sm" style={{ color: "var(--text)" }}>Ask about your finances</h3>
          </div>
          <div className="flex flex-wrap gap-2">
            {suggestions.map((s, i) => (
              <button
                key={i}
                onClick={() => handleAsk(s)}
                className="text-xs px-3 py-1.5 rounded-full transition-colors"
                style={{ backgroundColor: "var(--surface-hover)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input bar — always at bottom */}
      <div className="px-5 pb-5 pt-2">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAsk(input)}
            placeholder={hasMessages ? "Ask a follow-up..." : "Ask a question about your finances..."}
            className="flex-1 px-3 py-2.5 text-sm rounded-lg focus:outline-none"
            style={{ backgroundColor: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)" }}
            disabled={loading}
          />
          <button
            onClick={() => handleAsk(input)}
            disabled={loading || !input.trim()}
            className="p-2.5 rounded-lg disabled:opacity-30"
            style={{ backgroundColor: "var(--accent)", color: "var(--bg)" }}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
