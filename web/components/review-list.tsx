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
                <div className="font-medium text-sm text-gray-900 truncate">
                  {item.payment.payer_name || "Unknown payer"}
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
                <span>{item.payment.method || item.payment.source}</span>
                <span>·</span>
                <span>{formatDate(item.payment.date)}</span>
                <span>·</span>
                <span>{formatConfidence(item.confidence)} sure</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
