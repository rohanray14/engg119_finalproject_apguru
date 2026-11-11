"use client";

import type { ReviewItem } from "@/lib/types";
import { formatMoney, formatDate, formatConfidence } from "@/lib/format";

interface Props {
  items: ReviewItem[];
  selectedId: number | null;
  onSelect: (id: number) => void;
}

export default function ReviewList({ items, selectedId, onSelect }: Props) {
  return (
    <div className="bg-white rounded-lg border overflow-hidden" style={{ borderColor: "var(--card-border)" }}>
      <div className="divide-y" style={{ borderColor: "var(--card-border)" }}>
        {items.map((item) => {
          const active = item.match_id === selectedId;
          const noPayer = !item.payment.payer_name;
          return (
            <button
              key={item.match_id}
              onClick={() => onSelect(item.match_id)}
              className={`w-full text-left px-4 py-3 transition-colors ${
                active ? "bg-gray-100 border-l-2" : "hover:bg-gray-50 border-l-2 border-transparent"
              }`}
              style={active ? { borderLeftColor: "var(--accent)" } : undefined}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="font-medium text-sm text-gray-900 truncate">
                    {item.payment.payer_name || "Unknown payer"}
                  </span>
                  {noPayer && (
                    <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-600 border border-amber-200 font-medium">
                      no payer
                    </span>
                  )}
                </div>
                <div className="text-sm font-semibold text-gray-900 whitespace-nowrap ml-2">
                  {formatMoney(item.payment.amount_paid_paise, item.payment.currency)}
                </div>
              </div>
              {item.suggested_student && (
                <div className="text-xs mt-0.5" style={{ color: "var(--accent)" }}>
                  → {item.suggested_student}
                </div>
              )}
              <div className="flex items-center gap-1.5 mt-1 text-xs text-gray-500">
                <span className="px-1.5 py-0.5 rounded font-medium" style={{
                  backgroundColor: item.method === "ai" ? "#ede9fe" : "#f3f4f6",
                  color: item.method === "ai" ? "#6d28d9" : "#6b7280",
                  fontSize: "10px",
                }}>{item.method === "ai" ? "AI" : "rules"}</span>
                <span>·</span>
                <span>{formatDate(item.payment.date)}</span>
                <span>·</span>
                {item.has_suggestion ? (
                  <span className="px-1.5 py-0.5 rounded text-xs font-medium" style={{
                    backgroundColor: item.confidence >= 0.85 ? "#dcfce7" : "#fef3c7",
                    color: item.confidence >= 0.85 ? "#166534" : "#92400e",
                  }}>{item.confidence >= 0.85 ? "Strong" : "Weak"} · {formatConfidence(item.confidence)}</span>
                ) : (
                  <span className="px-1.5 py-0.5 rounded text-xs font-medium"
                    style={{ backgroundColor: "#f3f4f6", color: "#6b7280" }}>
                    no match
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
