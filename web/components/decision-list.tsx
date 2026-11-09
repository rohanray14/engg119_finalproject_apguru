"use client";

import Link from "next/link";
import type { Dashboard } from "@/lib/types";
import { formatMoney } from "@/lib/format";

interface DecisionItem {
  type: "risk" | "match" | "overdue" | "commission";
  title: string;
  description: string;
  action: { label: string; href: string };
}

function buildDecisions(d: Dashboard): DecisionItem[] {
  const items: DecisionItem[] = [];

  if (d.risk.high > 0) {
    items.push({
      type: "risk",
      title: `${d.risk.high} high-severity risk flag${d.risk.high > 1 ? "s" : ""}`,
      description: "Review flagged items before proceeding",
      action: { label: "Check", href: "/risk" },
    });
  }

  if (d.matching.pending_total > 0) {
    items.push({
      type: "match",
      title: `${d.matching.pending_total} payment${d.matching.pending_total > 1 ? "s" : ""} waiting for review`,
      description: `${d.matching.suggested} with AI suggestions, ${d.matching.needs_review} need manual matching`,
      action: { label: "Review", href: "/review" },
    });
  }

  if (d.reminders.needs_approval > 0) {
    items.push({
      type: "overdue",
      title: `${d.reminders.needs_approval} reminder${d.reminders.needs_approval > 1 ? "s" : ""} need approval`,
      description: `${d.reminders.overdue} overdue reminders drafted`,
      action: { label: "Read drafts", href: "/reminders" },
    });
  }

  for (const c of d.commissions) {
    if (c.net_paise > 0) {
      items.push({
        type: "commission",
        title: `Commissions ready: ${formatMoney(c.net_paise, c.currency)} to ${c.counselors} counselor${c.counselors > 1 ? "s" : ""}`,
        description: "Review and approve the payout",
        action: { label: "Open", href: "/commissions" },
      });
    }
  }

  return items;
}

const badgeColors: Record<string, string> = {
  risk: "#dc2626",
  match: "#1a7a6d",
  overdue: "#d97706",
  commission: "#2563eb",
};

export default function DecisionList({ dashboard }: { dashboard: Dashboard }) {
  const items = buildDecisions(dashboard);

  if (items.length === 0) {
    return (
      <div className="bg-white rounded-lg border p-6" style={{ borderColor: "var(--card-border)" }}>
        <h3 className="font-bold text-gray-900 mb-2">Needs your decision</h3>
        <p className="text-sm text-gray-500">Nothing urgent right now.</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border p-6" style={{ borderColor: "var(--card-border)" }}>
      <h3 className="font-bold text-gray-900 mb-4">Needs your decision</h3>
      <div className="divide-y" style={{ borderColor: "var(--card-border)" }}>
        {items.map((item, i) => (
          <div key={i} className="flex items-center justify-between py-4 first:pt-0 last:pb-0">
            <div className="flex items-start gap-3">
              <span
                className="mt-0.5 px-2 py-0.5 text-[10px] font-semibold uppercase text-white rounded"
                style={{ backgroundColor: badgeColors[item.type] }}
              >
                {item.type}
              </span>
              <div>
                <div className="text-sm font-medium text-gray-900">{item.title}</div>
                <div className="text-xs text-gray-500">{item.description}</div>
              </div>
            </div>
            <Link
              href={item.action.href}
              className="shrink-0 px-4 py-1.5 text-sm border rounded-md text-gray-700 hover:bg-gray-50 transition-colors"
              style={{ borderColor: "var(--card-border)" }}
            >
              {item.action.label}
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}
