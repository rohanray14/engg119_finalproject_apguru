"use client";

import { useEffect, useRef } from "react";
import type { ReviewItem } from "@/lib/types";
import { formatMoney, formatDate } from "@/lib/format";

interface Props {
  items: ReviewItem[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  skippedIds?: Set<number>;
}

function confidenceLabel(item: ReviewItem): { text: string; color: string } | null {
  if (!item.has_suggestion) return null;
  if (item.confidence >= 0.85) return { text: `${Math.round(item.confidence * 100)}%`, color: "var(--accent)" };
  return { text: `${Math.round(item.confidence * 100)}%`, color: "var(--warning)" };
}

export default function ReviewList({ items, selectedId, onSelect, skippedIds }: Props) {
  const activeRef = useRef<HTMLButtonElement>(null);
  const prevSelectedRef = useRef<number | null>(null);

  // Only scroll when selection changes, not on every render
  useEffect(() => {
    if (selectedId !== prevSelectedRef.current) {
      prevSelectedRef.current = selectedId;
      activeRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [selectedId]);

  return (
    <div className="rounded-lg border overflow-hidden" style={{ backgroundColor: "var(--surface)", borderColor: "var(--card-border)" }}>
      <div className="divide-y" style={{ borderColor: "var(--border-subtle)" }}>
        {items.map((item) => {
          const active = item.match_id === selectedId;
          const noPayer = !item.payment.payer_name;
          const skipped = skippedIds?.has(item.match_id);
          const conf = confidenceLabel(item);
          return (
            <button
              key={item.match_id}
              ref={active ? activeRef : undefined}
              onClick={() => onSelect(item.match_id)}
              className="w-full text-left px-4 py-3 transition-colors border-l-2"
              style={{
                backgroundColor: active ? "var(--surface-hover)" : undefined,
                borderLeftColor: active ? "var(--accent)" : "transparent",
                opacity: skipped ? 0.5 : 1,
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
                    {skipped && (
                      <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded font-medium"
                        style={{ backgroundColor: "var(--surface-hover)", color: "var(--text-tertiary)" }}>
                        skipped
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
                    {conf ? (
                      <>
                        <span>·</span>
                        <span style={{ color: conf.color }}>{conf.text}</span>
                      </>
                    ) : (
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
