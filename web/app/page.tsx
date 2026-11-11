"use client";

import useSWR from "swr";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { formatMoney, formatDateLong, formatDate } from "@/lib/format";
import type { Dashboard, Meta } from "@/lib/types";
import DecisionList from "@/components/decision-list";
import AskPanel from "@/components/ask-panel";
function fetcher<T>(path: string) {
  return apiFetch<T>(path);
}

function pctChange(current: number, previous: number): string | null {
  if (previous === 0) return null;
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct === 0) return null;
  return pct > 0 ? `+${pct}%` : `${pct}%`;
}

export default function TodayPage() {
  const { data: meta } = useSWR<Meta>("/meta", fetcher);
  const { data: dash, error, isLoading } = useSWR<Dashboard>(
    meta ? `/dashboard?as_of=${meta.default_as_of}` : null,
    fetcher
  );

  if (isLoading || !dash) {
    return (
      <div className="p-8">
        <div className="animate-pulse space-y-6">
          <div className="h-8 rounded w-48" style={{ backgroundColor: "var(--surface)" }} />
          <div className="h-32 rounded" style={{ backgroundColor: "var(--surface)" }} />
          <div className="grid grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-20 rounded" style={{ backgroundColor: "var(--surface)" }} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <div className="rounded-xl border p-6" style={{ backgroundColor: "var(--surface)", borderColor: "var(--danger)" }}>
          <h2 className="font-bold" style={{ color: "var(--danger)" }}>Failed to load dashboard</h2>
          <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>{error.message}</p>
        </div>
      </div>
    );
  }

  const overdueInr = dash.overdue.by_currency.find((c) => c.currency === "INR");
  const momChange = pctChange(dash.month.received_paise, dash.month.received_last_month_paise);
  const collectionRate = dash.month.collection_rate_pct;

  const hasOwing = dash.top_owing.length > 0;
  const hasUnmatched = dash.largest_unmatched.length > 0;

  return (
    <div className="p-8">
      {/* -- Header -- */}
      <div className="mb-8">
        <div className="text-sm" style={{ color: "var(--text-secondary)" }}>{formatDateLong(dash.as_of)}</div>
        <h1 className="text-3xl font-bold" style={{ color: "var(--text)" }}>Today</h1>
      </div>

      {/* -- 1. Decisions -- */}
      <div className="mb-8">
        <DecisionList dashboard={dash} />
      </div>

      {/* -- 2. KPI strip in a card -- */}
      <div className="rounded-xl border p-6 mb-8" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
          <div>
            <div className="text-xs uppercase tracking-wider font-medium mb-1" style={{ color: "var(--text-secondary)" }}>
              Received this month
            </div>
            <div className="text-3xl font-bold" style={{ color: "var(--accent)" }}>
              {formatMoney(dash.month.received_paise, "INR")}
            </div>
            {momChange && (
              <div className="text-xs font-medium mt-0.5" style={{ color: "var(--text-tertiary)" }}>
                {momChange} vs last month
              </div>
            )}
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider font-medium mb-1" style={{ color: "var(--text-secondary)" }}>
              Expected this month
            </div>
            <div className="text-3xl font-bold" style={{ color: "var(--text)" }}>
              {formatMoney(dash.month.expected_paise, "INR")}
            </div>
            {collectionRate != null && (
              <div className="text-xs mt-0.5" style={{ color: "var(--text-tertiary)" }}>
                {Math.round(collectionRate)}% collected
              </div>
            )}
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider font-medium mb-1" style={{ color: "var(--text-secondary)" }}>
              Spent this month
            </div>
            <div className="text-3xl font-bold" style={{ color: "var(--text)" }}>
              {formatMoney(dash.month.spent_paise, "INR")}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider font-medium mb-1" style={{ color: "var(--text-secondary)" }}>
              Overdue
            </div>
            <div className="text-3xl font-bold" style={{ color: overdueInr ? "var(--danger)" : "var(--accent)" }}>
              {overdueInr ? formatMoney(overdueInr.amount_paise, "INR") : "\u20B90"}
            </div>
            {overdueInr && overdueInr.count > 0 ? (
              <div className="text-xs mt-0.5" style={{ color: "var(--text-tertiary)" }}>
                {overdueInr.count} installments {"·"} oldest {dash.overdue.oldest_days}d
              </div>
            ) : (
              <div className="text-xs mt-0.5" style={{ color: "var(--accent)" }}>All caught up</div>
            )}
          </div>
        </div>
      </div>

      {/* -- 3. Ask panel -- */}
      <div className="mb-8">
        <AskPanel />
      </div>

      {/* -- 4. Top owing + Unmatched -- */}
      {(hasOwing || hasUnmatched) && (
        <div className={`grid grid-cols-1 ${hasOwing && hasUnmatched ? "lg:grid-cols-2" : ""} gap-6 mb-8`}>
          {hasOwing && (
            <div className="rounded-xl border p-5" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold" style={{ color: "var(--text)" }}>Top families owing</h3>
                <Link href="/reminders" className="text-xs hover:underline" style={{ color: "var(--text)" }}>
                  Reminders
                </Link>
              </div>
              <div className="divide-y" style={{ borderColor: "var(--border-subtle)" }}>
                {dash.top_owing.map((s) => (
                  <Link key={s.student_id} href="/reminders"
                    className="flex items-center justify-between py-2.5 first:pt-0 last:pb-0 -mx-2 px-2 rounded transition-colors block">
                    <div>
                      <div className="text-sm font-medium" style={{ color: "var(--text)" }}>{s.name}</div>
                      <div className="text-xs" style={{ color: "var(--text-tertiary)" }}>due {formatDate(s.earliest_due)}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold" style={{ color: "var(--danger)" }}>
                        {formatMoney(s.owed_paise, s.currency)}
                      </span>
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold"
                        style={{ backgroundColor: "rgba(255, 77, 77, 0.15)", color: "var(--danger)" }}>Due</span>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {hasUnmatched && (
            <div className="rounded-xl border p-5" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold" style={{ color: "var(--text)" }}>Largest unmatched payments</h3>
                <Link href="/review" className="text-xs hover:underline" style={{ color: "var(--text)" }}>
                  Review queue
                </Link>
              </div>
              <div className="divide-y" style={{ borderColor: "var(--border-subtle)" }}>
                {dash.largest_unmatched.map((p) => (
                  <div key={p.id} className="flex items-center justify-between py-2.5 first:pt-0 last:pb-0">
                    <div>
                      <div className="text-sm font-medium" style={{ color: "var(--text)" }}>
                        {p.payer_name || "Unknown payer"}
                      </div>
                      <div className="text-xs" style={{ color: "var(--text-tertiary)" }}>
                        {formatDate(p.date)}{p.method ? ` \u00B7 ${p.method}` : ""}
                      </div>
                    </div>
                    <span className="text-sm font-semibold" style={{ color: "var(--accent)" }}>
                      {formatMoney(p.amount_paid_paise, p.currency)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

    </div>
  );
}
