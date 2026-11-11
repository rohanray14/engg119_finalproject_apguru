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
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-1.5 min-w-0">
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
                <div className="text-sm font-semibold whitespace-nowrap ml-2" style={{ color: "var(--text)" }}>
                  {formatMoney(item.payment.amount_paid_paise, item.payment.currency)}
                </div>
              </div>
              {item.suggested_student && (
                <div className="text-xs mt-0.5" style={{ color: "var(--accent)" }}>
                  → {item.suggested_student}
                </div>
              )}
              <div className="flex items-center gap-1.5 mt-1 text-xs" style={{ color: "var(--text-secondary)" }}>
                <span>{formatDate(item.payment.date)}</span>
                {!item.has_suggestion && (
                  <>
                    <span>·</span>
                    <span className="px-1.5 py-0.5 rounded text-xs font-medium"
                      style={{ backgroundColor: "var(--surface-hover)", color: "var(--text-secondary)" }}>
                      no match
                    </span>
                  </>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
