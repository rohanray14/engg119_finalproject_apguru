"use client";

import Link from "next/link";
import type { Dashboard } from "@/lib/types";
import { formatMoney } from "@/lib/format";

interface DecisionItem {
  type: "risk" | "match" | "overdue" | "commission";
  title: string;
  action: { label: string; href: string };
}

function buildDecisions(d: Dashboard): DecisionItem[] {
  const items: DecisionItem[] = [];

  if (d.risk.high > 0) {
    items.push({
      type: "risk",
      title: `${d.risk.high} high-severity risk flag${d.risk.high > 1 ? "s" : ""}`,
      action: { label: "Review", href: "/risk" },
    });
  }

  if (d.matching.pending_total > 0) {
    items.push({
      type: "match",
      title: `${d.matching.pending_total} payment${d.matching.pending_total > 1 ? "s" : ""} waiting for review`,
      action: { label: "Review", href: "/review" },
    });
  }

  if (d.reminders.needs_approval > 0) {
    items.push({
      type: "overdue",
      title: `${d.reminders.needs_approval} reminder${d.reminders.needs_approval > 1 ? "s" : ""} need approval`,
      action: { label: "Review", href: "/reminders" },
    });
  }

  const totalNet = d.commissions.reduce((sum, c) => sum + c.net_paise, 0);
  const counselorCount = Math.max(...d.commissions.map((c) => c.counselors), 0);
  if (totalNet > 0) {
    items.push({
      type: "commission",
      title: `Commissions ready: ${formatMoney(totalNet, "INR")} to ${counselorCount} counselor${counselorCount > 1 ? "s" : ""}`,
      action: { label: "Review", href: "/commissions" },
    });
  }

  return items;
}

const badgeColors: Record<string, string> = {
  risk: "var(--danger)",
  match: "var(--accent)",
  overdue: "var(--warning)",
  commission: "var(--info)",
};

export default function DecisionList({ dashboard }: { dashboard: Dashboard }) {
  const items = buildDecisions(dashboard);

  if (items.length === 0) {
    return (
      <div className="rounded-xl border p-6" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
        <h3 className="font-bold mb-2" style={{ color: "var(--text)" }}>Needs your decision</h3>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>Nothing urgent right now.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border p-6" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
      <h3 className="font-bold mb-4" style={{ color: "var(--text)" }}>Needs your decision</h3>
      <div className="divide-y" style={{ borderColor: "var(--border-subtle)" }}>
        {items.map((item, i) => (
          <div key={i} className="flex items-center gap-4 py-4 first:pt-0 last:pb-0">
            <span
              className="shrink-0 w-[100px] text-center px-3 py-1 text-[10px] font-semibold uppercase rounded"
              style={{ backgroundColor: badgeColors[item.type], color: "var(--bg)" }}
            >
              {item.type}
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium" style={{ color: "var(--text)" }}>{item.title}</div>
            </div>
            <Link
              href={item.action.href}
              className="shrink-0 px-5 py-2 text-sm font-medium rounded-lg transition-colors"
              style={{ backgroundColor: "var(--accent)", color: "var(--bg)" }}
            >
              {item.action.label}
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}
