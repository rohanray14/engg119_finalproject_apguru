"use client";

import useSWR from "swr";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { formatMoney, formatMoneyCompact, formatDateLong, formatDate } from "@/lib/format";
import type { Dashboard, Meta } from "@/lib/types";
import DecisionList from "@/components/decision-list";
import ForecastChart from "@/components/forecast-chart";
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
              <div key={i} className="h-24 rounded" style={{ backgroundColor: "var(--surface)" }} />
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

  const inrCommission = dash.commissions.find((c) => c.currency === "INR");
  const overdueInr = dash.overdue.by_currency.find((c) => c.currency === "INR");
  const momChange = pctChange(dash.month.received_paise, dash.month.received_last_month_paise);
  const collectionRate = dash.month.collection_rate_pct;

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="text-sm" style={{ color: "var(--text-tertiary)" }}>{formatDateLong(dash.as_of)}</div>
          <h1 className="text-3xl font-bold" style={{ color: "var(--text)" }}>Today</h1>
        </div>
        <span className="px-3 py-1 text-xs font-medium border rounded-md"
          style={{ color: "var(--text-tertiary)", borderColor: "var(--border)" }}>
          Sample data
        </span>
      </div>

      {/* Action items — first thing a finance lead sees */}
      <div className="mb-6">
        <DecisionList dashboard={dash} />
      </div>

      {/* Collection health row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {/* Received this month */}
        <div className="rounded-xl border p-5" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
          <div className="text-sm mb-1" style={{ color: "var(--text-secondary)" }}>Received this month</div>
          <div className="text-2xl font-bold" style={{ color: "var(--text)" }}>
            {formatMoneyCompact(dash.month.received_paise, "INR")}
          </div>
          <div className="flex items-center gap-2 mt-1">
            {momChange && (
              <span className="text-xs font-medium" style={{ color: momChange.startsWith("+") ? "var(--accent)" : "var(--danger)" }}>
                {momChange} vs last month
              </span>
            )}
            {!momChange && dash.month.received_last_month_paise > 0 && (
              <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>same as last month</span>
            )}
          </div>
        </div>

        {/* Collection rate */}
        <div className="rounded-xl border p-5" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
          <div className="text-sm mb-1" style={{ color: "var(--text-secondary)" }}>Collection rate</div>
          <div className="text-2xl font-bold" style={{ color: "var(--text)" }}>
            {collectionRate != null ? `${Math.round(collectionRate)}%` : "—"}
          </div>
          <div className="text-xs mt-1" style={{ color: "var(--text-secondary)" }}>
            of {formatMoneyCompact(dash.month.expected_paise, "INR")} expected
          </div>
        </div>

        {/* Overdue */}
        <Link href="/reminders" className="rounded-xl border p-5 transition-colors block"
          style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
          <div className="text-sm mb-1" style={{ color: "var(--text-secondary)" }}>Overdue installments</div>
          <div className="text-2xl font-bold" style={{ color: "var(--text)" }}>{dash.overdue.count}</div>
          {overdueInr ? (
            <div className="text-xs mt-1" style={{ color: "var(--danger)" }}>
              {formatMoneyCompact(overdueInr.amount_paise, "INR")} · oldest {dash.overdue.oldest_days}d
            </div>
          ) : (
            <div className="text-xs mt-1" style={{ color: "var(--accent)" }}>All caught up</div>
          )}
        </Link>

        {/* Expenses this month */}
        <Link href="/money-out" className="rounded-xl border p-5 transition-colors block"
          style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
          <div className="text-sm mb-1" style={{ color: "var(--text-secondary)" }}>Spent this month</div>
          <div className="text-2xl font-bold" style={{ color: "var(--text)" }}>
            {formatMoneyCompact(dash.month.spent_paise, "INR")}
          </div>
          {inrCommission && inrCommission.payable_paise && inrCommission.payable_paise > 0 ? (
            <div className="text-xs mt-1" style={{ color: "var(--accent)" }}>
              {formatMoneyCompact(inrCommission.payable_paise, "INR")} commissions pending
            </div>
          ) : (
            <div className="text-xs mt-1" style={{ color: "var(--text-tertiary)" }}>Commissions paid up</div>
          )}
        </Link>
      </div>

      {/* Top owing families + Largest unmatched — side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Top owing */}
        {dash.top_owing.length > 0 && (
          <div className="rounded-xl border p-5" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold" style={{ color: "var(--text)" }}>Largest outstanding</h3>
              <Link href="/students" className="text-xs hover:underline" style={{ color: "var(--accent)" }}>
                All students
              </Link>
            </div>
            <div className="divide-y" style={{ borderColor: "var(--border-subtle)" }}>
              {dash.top_owing.map((s) => (
                <Link key={s.student_id} href={`/students?id=${s.student_id}`}
                  className="flex items-center justify-between py-2.5 first:pt-0 last:pb-0 -mx-2 px-2 rounded transition-colors block"
                  style={{ color: "var(--text)" }}>
                  <div>
                    <div className="text-sm font-medium" style={{ color: "var(--text)" }}>{s.name}</div>
                    <div className="text-xs" style={{ color: "var(--text-tertiary)" }}>
                      due {formatDate(s.earliest_due)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold" style={{ color: "var(--danger)" }}>
                      {formatMoney(s.owed_paise, s.currency)}
                    </span>
                    <span className="text-xs" style={{ color: "var(--accent)" }}>→</span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Largest unmatched payments */}
        {dash.largest_unmatched.length > 0 && (
          <div className="rounded-xl border p-5" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold" style={{ color: "var(--text)" }}>Unmatched payments</h3>
              <Link href="/review" className="text-xs hover:underline" style={{ color: "var(--accent)" }}>
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
                      {formatDate(p.date)}{p.method ? ` · ${p.method}` : ""}
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

      {/* Forecast */}
      <div className="mb-6">
        <ForecastChart data={dash.forecast} />
      </div>

      {/* Ask */}
      <AskPanel />
    </div>
  );
}
