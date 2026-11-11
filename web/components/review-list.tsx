"use client";

import type { ReviewItem } from "@/lib/types";
import { formatMoney, formatDate } from "@/lib/format";

interface Props {
  items: ReviewItem[];
  selectedId: number | null;
  onSelect: (id: number) => void;
}

export default function ReviewList({ items, selectedId, onSelect }: Props) {
  return (
    <div className="rounded-lg border overflow-hidden" style={{ backgroundColor: "var(--surface)", borderColor: "var(--card-border)" }}>
      <div className="divide-y" style={{ borderColor: "var(--border-subtle)" }}>
        {items.map((item) => {
          const active = item.match_id === selectedId;
          const noPayer = !item.payment.payer_name;
          return (
            <button
              key={item.match_id}
              onClick={() => onSelect(item.match_id)}
              className="w-full text-left px-4 py-3 transition-colors border-l-2"
              style={{
                backgroundColor: active ? "var(--surface-hover)" : undefined,
                borderLeftColor: active ? "var(--accent)" : "transparent",
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium text-sm truncate" style={{ color: "var(--text)" }}>
                      {item.payment.payer_name || "Unknown payer"}
                    </span>
                    {noPayer && (
                      <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded border font-medium"
                        style={{ backgroundColor: "rgba(255,176,32,0.1)", color: "var(--warning)", borderColor: "rgba(255,176,32,0.3)" }}>
                        no payer
                      </span>
                    )}
                  </div>
                  {item.suggested_student && (
                    <div className="text-xs mt-0.5" style={{ color: "var(--accent)" }}>
                      → {item.suggested_student}
                    </div>
                  )}
                  <div className="flex items-center gap-1.5 mt-1 text-xs" style={{ color: "var(--text-secondary)" }}>
                    <span>{formatDate(item.payment.date)}</span>
                    <span>·</span>
                    <span>{formatMoney(item.payment.amount_paid_paise, item.payment.currency)}</span>
                    {!item.has_suggestion && (
                      <>
                        <span>·</span>
                        <span style={{ color: "var(--text-tertiary)" }}>no match</span>
                      </>
                    )}
                  </div>
                </div>
                <span className="shrink-0 px-3 py-1.5 rounded-md text-xs font-semibold"
                  style={{
                    backgroundColor: active ? "var(--accent)" : "rgba(0,220,130,0.15)",
                    color: active ? "var(--bg)" : "var(--accent)",
                  }}>
                  Review
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
