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
          <div className="h-8 bg-gray-200 rounded w-48" />
          <div className="h-32 bg-gray-200 rounded" />
          <div className="grid grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-24 bg-gray-200 rounded" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <div className="bg-red-50 border border-red-200 rounded-lg p-6">
          <h2 className="font-bold text-red-800">Failed to load dashboard</h2>
          <p className="text-sm text-red-600 mt-1">{error.message}</p>
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
          <div className="text-sm text-gray-500">{formatDateLong(dash.as_of)}</div>
          <h1 className="text-3xl font-bold text-gray-900">Today</h1>
        </div>
        <span className="px-3 py-1 text-xs font-medium text-gray-500 border border-gray-300 rounded-md">
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
        <div className="bg-white rounded-lg border p-5" style={{ borderColor: "var(--card-border)" }}>
          <div className="text-sm text-gray-500 mb-1">Received this month</div>
          <div className="text-2xl font-bold text-gray-900">
            {formatMoneyCompact(dash.month.received_paise, "INR")}
          </div>
          <div className="flex items-center gap-2 mt-1">
            {momChange && (
              <span className={`text-xs font-medium ${
                momChange.startsWith("+") ? "text-green-600" : "text-red-600"
              }`}>
                {momChange} vs last month
              </span>
            )}
            {!momChange && dash.month.received_last_month_paise > 0 && (
              <span className="text-xs text-gray-400">same as last month</span>
            )}
          </div>
        </div>

        {/* Collection rate */}
        <div className="bg-white rounded-lg border p-5" style={{ borderColor: "var(--card-border)" }}>
          <div className="text-sm text-gray-500 mb-1">Collection rate</div>
          <div className="text-2xl font-bold text-gray-900">
            {collectionRate != null ? `${Math.round(collectionRate)}%` : "—"}
          </div>
          <div className="text-xs text-gray-500 mt-1">
            of {formatMoneyCompact(dash.month.expected_paise, "INR")} expected
          </div>
        </div>

        {/* Overdue */}
        <Link href="/reminders" className="bg-white rounded-lg border p-5 hover:border-red-300 transition-colors block"
          style={{ borderColor: "var(--card-border)" }}>
          <div className="text-sm text-gray-500 mb-1">Overdue installments</div>
          <div className="text-2xl font-bold text-gray-900">{dash.overdue.count}</div>
          {overdueInr ? (
            <div className="text-xs text-red-600 mt-1">
              {formatMoneyCompact(overdueInr.amount_paise, "INR")} · oldest {dash.overdue.oldest_days}d
            </div>
          ) : (
            <div className="text-xs text-green-600 mt-1">All caught up</div>
          )}
        </Link>

        {/* Expenses this month */}
        <Link href="/money-out" className="bg-white rounded-lg border p-5 hover:border-gray-400 transition-colors block"
          style={{ borderColor: "var(--card-border)" }}>
          <div className="text-sm text-gray-500 mb-1">Spent this month</div>
          <div className="text-2xl font-bold text-gray-900">
            {formatMoneyCompact(dash.month.spent_paise, "INR")}
          </div>
          {inrCommission && inrCommission.payable_paise && inrCommission.payable_paise > 0 ? (
            <div className="text-xs mt-1" style={{ color: "var(--accent)" }}>
              {formatMoneyCompact(inrCommission.payable_paise, "INR")} commissions pending
            </div>
          ) : (
            <div className="text-xs text-gray-400 mt-1">Commissions paid up</div>
          )}
        </Link>
      </div>

      {/* Top owing families + Largest unmatched — side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Top owing */}
        {dash.top_owing.length > 0 && (
          <div className="bg-white rounded-lg border p-5" style={{ borderColor: "var(--card-border)" }}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-gray-900">Largest outstanding</h3>
              <Link href="/students" className="text-xs hover:underline" style={{ color: "var(--accent)" }}>
                All students
              </Link>
            </div>
            <div className="divide-y" style={{ borderColor: "var(--card-border)" }}>
              {dash.top_owing.map((s) => (
                <div key={s.student_id} className="flex items-center justify-between py-2.5 first:pt-0 last:pb-0">
                  <div>
                    <Link href={`/students?search=${encodeURIComponent(s.name)}`}
                      className="text-sm font-medium text-gray-900 hover:underline">{s.name}</Link>
                    <div className="text-xs text-gray-400">
                      due {formatDate(s.earliest_due)}
                    </div>
                  </div>
                  <span className="text-sm font-semibold text-red-700">
                    {formatMoney(s.owed_paise, s.currency)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Largest unmatched payments */}
        {dash.largest_unmatched.length > 0 && (
          <div className="bg-white rounded-lg border p-5" style={{ borderColor: "var(--card-border)" }}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-gray-900">Unmatched payments</h3>
              <Link href="/review" className="text-xs hover:underline" style={{ color: "var(--accent)" }}>
                Review queue
              </Link>
            </div>
            <div className="divide-y" style={{ borderColor: "var(--card-border)" }}>
              {dash.largest_unmatched.map((p) => (
                <div key={p.id} className="flex items-center justify-between py-2.5 first:pt-0 last:pb-0">
                  <div>
                    <div className="text-sm font-medium text-gray-900">
                      {p.payer_name || "Unknown payer"}
                    </div>
                    <div className="text-xs text-gray-400">
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
