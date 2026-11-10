"use client";

import useSWR from "swr";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { formatMoneyCompact, formatDateLong } from "@/lib/format";
import type { Dashboard, Meta } from "@/lib/types";
import StatCard from "@/components/stat-card";
import ForecastChart from "@/components/forecast-chart";
import DecisionList from "@/components/decision-list";

function fetcher<T>(path: string) {
  return apiFetch<T>(path);
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

  // Build a brief summary
  const briefParts: string[] = [];
  if (dash.month.received_paise > 0) {
    briefParts.push(
      `${formatMoneyCompact(dash.month.received_paise, "INR")} arrived this month`
    );
  }
  if (dash.matching.matched > 0) {
    briefParts.push(
      `${dash.matching.matched} payments were matched automatically`
    );
  }
  if (dash.matching.pending_total > 0) {
    briefParts.push(`${dash.matching.pending_total} need you`);
  }
  if (dash.overdue.count > 0) {
    briefParts.push(
      `${dash.overdue.count} installments are past due`
    );
  }

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

      {/* Briefing */}
      <div className="bg-white rounded-lg border p-6 mb-6" style={{ borderColor: "var(--card-border)" }}>
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--accent)" }}>
            Briefing
          </span>
          <span className="text-xs text-gray-400">
            Written by the copilot from today&apos;s ledger
          </span>
        </div>
        <p className="text-gray-800 leading-relaxed">
          {briefParts.join(". ")}.
        </p>
        <div className="flex gap-3 mt-4">
          {dash.matching.pending_total > 0 && (
            <Link
              href="/review"
              className="px-4 py-2 text-sm font-medium text-white rounded-md"
              style={{ backgroundColor: "var(--accent)" }}
            >
              Review {dash.matching.pending_total} payments
            </Link>
          )}
          <Link
            href="/ask"
            className="px-4 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50"
          >
            Ask a follow-up
          </Link>
        </div>
      </div>

      {/* How it works */}
      <div className="bg-white rounded-lg border p-5 mb-6" style={{ borderColor: "var(--card-border)" }}>
        <div className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">How the workflow works</div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-sm">
          <div>
            <div className="font-medium text-gray-900 mb-1">1. Payments arrive</div>
            <p className="text-gray-500">Bank transfers, gateway payments (Stripe/Razorpay), and cash receipts are imported. Each is verified against the bank statement.</p>
          </div>
          <div>
            <div className="font-medium text-gray-900 mb-1">2. AI matches to students</div>
            <p className="text-gray-500">The matching agent links each payment to a student&apos;s installment using name similarity, amount, and date. High-confidence matches are auto-approved.</p>
          </div>
          <div>
            <div className="font-medium text-gray-900 mb-1">3. You review the rest</div>
            <p className="text-gray-500">Payments below the confidence threshold appear in Match Review for you to approve, reject, or reassign. Bulk approve is available for batches.</p>
          </div>
          <div>
            <div className="font-medium text-gray-900 mb-1">4. Track and follow up</div>
            <p className="text-gray-500">Overdue installments, risk flags, and commission payouts are tracked automatically. Use Ask to query anything in the ledger.</p>
          </div>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard
          label="Received this month"
          value={formatMoneyCompact(dash.month.received_paise, "INR")}
          sub={dash.confirmation.in_bank
            ? `${dash.confirmation.in_bank} confirmed in bank`
            : undefined}
        />
        <StatCard
          label="Waiting for a match"
          value={String(dash.matching.pending_total + dash.matching.never_matched)}
          sub={overdueInr
            ? `${formatMoneyCompact(overdueInr.amount_paise, "INR")} · oldest ${dash.overdue.oldest_days} days`
            : undefined}
        />
        <StatCard
          label="Installments overdue"
          value={String(dash.overdue.count)}
          sub={overdueInr
            ? `${formatMoneyCompact(overdueInr.amount_paise, "INR")} outstanding`
            : undefined}
          subColor="danger"
        />
        <StatCard
          label="Commissions ready to pay"
          value={inrCommission ? formatMoneyCompact(inrCommission.net_paise, "INR") : "—"}
          sub={inrCommission
            ? `${inrCommission.counselors} counselors · after 2% TDS`
            : undefined}
        />
      </div>

      {/* Decisions + Forecast */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 mb-6">
        <div className="lg:col-span-3">
          <DecisionList dashboard={dash} />
        </div>
        <div className="lg:col-span-2">
          <ForecastChart data={dash.forecast} />
        </div>
      </div>

      {/* Ask bar */}
      <div className="bg-white rounded-lg border p-4 flex items-center gap-3"
        style={{ borderColor: "var(--card-border)" }}>
        <span className="text-sm font-medium text-gray-500">Ask</span>
        <input
          type="text"
          placeholder="e.g. Which families still owe us for November?"
          className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
          onKeyDown={(e) => {
            if (e.key === "Enter" && e.currentTarget.value.trim()) {
              window.location.href = `/ask?q=${encodeURIComponent(e.currentTarget.value)}`;
            }
          }}
        />
        <button
          className="px-4 py-2 text-sm font-medium text-white rounded-md"
          style={{ backgroundColor: "var(--sidebar-bg)" }}
          onClick={(e) => {
            const input = (e.currentTarget.previousElementSibling as HTMLInputElement);
            if (input.value.trim()) {
              window.location.href = `/ask?q=${encodeURIComponent(input.value)}`;
            }
          }}
        >
          Ask
        </button>
      </div>
    </div>
  );
}
