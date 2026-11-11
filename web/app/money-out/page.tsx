"use client";

import { useState } from "react";
import useSWR from "swr";
import { apiFetch } from "@/lib/api";
import { formatMoney, formatMoneyCompact, formatDate } from "@/lib/format";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, Legend,
  ResponsiveContainer, CartesianGrid,
} from "recharts";

interface MonthlySummary {
  month: string;
  total_paise: number;
  by_category: Record<string, number>;
}

interface RunwayProjection {
  month: string;
  current_rate: number;
  drop_10: number;
  drop_25: number;
  drop_50: number;
}

interface Runway {
  avg_monthly_expected_paise: number;
  avg_monthly_received_paise: number;
  collection_rate_pct: number;
  avg_monthly_burn_paise: number;
  projection: RunwayProjection[];
}

interface MoneyOutData {
  summary: { category: string; currency: string; count: number; total_paise: number }[];
  total: number;
  items: { id: number; date: string; payee: string; category: string; amount_paise: number; currency: string }[];
  total_spent_paise: number;
  total_received_paise: number;
  avg_monthly_burn_paise: number;
  monthly_spend: MonthlySummary[];
  runway: Runway;
}

function fetcher<T>(path: string) { return apiFetch<T>(path); }

function monthLabel(iso: string): string {
  const [y, m] = iso.split("-");
  const d = new Date(Number(y), Number(m) - 1);
  return d.toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
}

function lakhs(paise: number): string {
  const amt = Math.abs(paise) / 100;
  const sign = paise < 0 ? "-" : "";
  if (amt >= 10000000) return `${sign}${(amt / 10000000).toFixed(1)} Cr`;
  if (amt >= 100000) return `${sign}${(amt / 100000).toFixed(1)} L`;
  if (amt >= 1000) return `${sign}${(amt / 1000).toFixed(0)}K`;
  return `${sign}${amt.toFixed(0)}`;
}

// Muted monochrome palette — teal accent with grays
const CAT_COLORS: Record<string, string> = {
  faculty: "#1a2332",
  ads: "#2d6a5e",
  software: "#4b8c81",
  tax: "#6b9e96",
  refund: "#8fb5af",
  rent: "#b0ccc8",
  other: "#94a3b8",
  commission: "#64748b",
};

export default function MoneyOutPage() {
  const [category, setCategory] = useState("");
  const [currency, setCurrency] = useState("");

  const params = new URLSearchParams();
  if (category) params.set("category", category);
  if (currency) params.set("currency", currency);

  const { data, isLoading } = useSWR<MoneyOutData>(`/money-out?${params}`, fetcher);

  const categories = [...new Set(data?.summary.map((s) => s.category) ?? [])];

  // Build stacked bar chart data from monthly_spend
  const allCats = [...new Set(data?.monthly_spend.flatMap((m) => Object.keys(m.by_category)) ?? [])];
  const trendData = (data?.monthly_spend ?? []).map((m) => {
    const row: Record<string, string | number> = { month: monthLabel(m.month) };
    for (const c of allCats) {
      row[c] = (m.by_category[c] ?? 0) / 100; // rupees
    }
    return row;
  });

  // Projection chart data (convert paise to rupees)
  const projData = (data?.runway.projection ?? []).map((p) => ({
    month: monthLabel(p.month),
    "Current rate": p.current_rate / 100,
    "10% drop": p.drop_10 / 100,
    "25% drop": p.drop_25 / 100,
    "50% drop": p.drop_50 / 100,
  }));

  // MoM delta
  const ms = data?.monthly_spend ?? [];
  const lastMonthSpend = ms.length >= 1 ? ms[ms.length - 1].total_paise : 0;
  const prevMonthSpend = ms.length >= 2 ? ms[ms.length - 2].total_paise : 0;
  const momPct = prevMonthSpend > 0
    ? ((lastMonthSpend - prevMonthSpend) / prevMonthSpend * 100)
    : 0;

  const spendRatio = data && data.total_received_paise > 0
    ? (data.total_spent_paise / data.total_received_paise * 100)
    : 0;

  const runway = data?.runway;
  const burnNet = runway
    ? (runway.avg_monthly_received_paise - runway.avg_monthly_burn_paise)
    : 0;

  if (isLoading) {
    return (
      <div className="p-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-1">Money out</h1>
        <p className="text-sm text-gray-500 mb-6">Spend trends, burn rate, and runway projections.</p>
        <div className="animate-pulse space-y-4">
          <div className="grid grid-cols-4 gap-3">{[...Array(4)].map((_, i) => <div key={i} className="h-24 bg-gray-200 rounded-lg" />)}</div>
          <div className="h-64 bg-gray-200 rounded-lg" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-1">Money out</h1>
      <p className="text-sm text-gray-500 mb-6">Spend trends, burn rate, and runway projections.</p>

      {/* Row 1: Key metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="bg-white rounded-lg border p-4" style={{ borderColor: "var(--card-border)" }}>
          <div className="text-sm text-gray-500">Total spent (all time)</div>
          <div className="text-2xl font-bold text-gray-900">{data ? formatMoneyCompact(data.total_spent_paise, "INR") : "—"}</div>
          <div className="text-xs text-gray-400">{data?.total ?? 0} payments</div>
        </div>
        <div className="bg-white rounded-lg border p-4" style={{ borderColor: "var(--card-border)" }}>
          <div className="text-sm text-gray-500">Avg monthly burn</div>
          <div className="text-2xl font-bold text-gray-900">{data ? formatMoneyCompact(data.avg_monthly_burn_paise, "INR") : "—"}</div>
          {prevMonthSpend > 0 && (
            <div className="text-xs font-medium text-gray-500">
              {momPct > 0 ? "+" : ""}{momPct.toFixed(0)}% MoM
            </div>
          )}
        </div>
        <div className="bg-white rounded-lg border p-4" style={{ borderColor: "var(--card-border)" }}>
          <div className="text-sm text-gray-500">Last month</div>
          <div className="text-2xl font-bold text-gray-900">{formatMoneyCompact(lastMonthSpend, "INR")}</div>
          {prevMonthSpend > 0 && (
            <div className="text-xs text-gray-400">Prior: {formatMoneyCompact(prevMonthSpend, "INR")}</div>
          )}
        </div>
        <div className="bg-white rounded-lg border p-4" style={{ borderColor: "var(--card-border)" }}>
          <div className="text-sm text-gray-500">Spend / Revenue</div>
          <div className="text-2xl font-bold text-gray-900">{spendRatio.toFixed(0)}%</div>
          <div className="text-xs font-medium text-gray-500">
            of {data ? formatMoneyCompact(data.total_received_paise, "INR") : "—"} received
          </div>
        </div>
      </div>

      {/* Row 2: Monthly trend + Category breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 mb-6">
        <div className="lg:col-span-3 bg-white rounded-lg border p-5" style={{ borderColor: "var(--card-border)" }}>
          <h3 className="font-bold text-gray-900 mb-1">Monthly spend trend</h3>
          <p className="text-xs text-gray-500 mb-4">Month-over-month outflows by category</p>
          {trendData.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={trendData} barGap={1}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={(v) => lakhs(v * 100)} tick={{ fontSize: 11 }} width={50} />
                <Tooltip formatter={(value) => `${lakhs(Number(value) * 100)}`} />
                <Legend iconType="square" wrapperStyle={{ fontSize: 11 }} />
                {allCats.map((c) => (
                  <Bar key={c} dataKey={c} stackId="a" fill={CAT_COLORS[c] || "#94a3b8"} name={c} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="text-sm text-gray-400 py-8 text-center">No data</div>
          )}
        </div>

        <div className="lg:col-span-2 bg-white rounded-lg border p-5" style={{ borderColor: "var(--card-border)" }}>
          <h3 className="font-bold text-gray-900 mb-1">Spend by category</h3>
          <p className="text-xs text-gray-500 mb-4">All-time breakdown</p>
          <div className="space-y-2.5">
            {(data?.summary ?? []).map((s, i) => {
              const pct = data && data.total_spent_paise > 0
                ? (s.total_paise / data.total_spent_paise * 100)
                : 0;
              return (
                <div key={i}>
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: CAT_COLORS[s.category] || "#94a3b8" }} />
                      <span className="font-medium text-gray-900 capitalize">{s.category}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-gray-700">{formatMoneyCompact(s.total_paise, s.currency)}</span>
                      <span className="text-gray-400 text-xs w-8 text-right">{pct.toFixed(0)}%</span>
                    </div>
                  </div>
                  <div className="mt-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${pct}%`, backgroundColor: CAT_COLORS[s.category] || "#94a3b8" }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Row 3: Cash runway projection */}
      <div className="bg-white rounded-lg border p-5 mb-6" style={{ borderColor: "var(--card-border)" }}>
        <h3 className="font-bold text-gray-900 mb-1">Cash runway projection</h3>
        <p className="text-xs text-gray-500 mb-4">When do outflows overtake inflows if collection rates drop?</p>

        <div className="grid grid-cols-3 gap-3 mb-5">
          <div className="bg-gray-50 rounded-lg p-3">
            <div className="text-xs text-gray-500">Avg monthly expected</div>
            <div className="text-lg font-bold text-gray-900">{runway ? formatMoneyCompact(runway.avg_monthly_expected_paise, "INR") : "—"}</div>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <div className="text-xs text-gray-500">Avg monthly collected</div>
            <div className="text-lg font-bold text-gray-900">{runway ? formatMoneyCompact(runway.avg_monthly_received_paise, "INR") : "—"}</div>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <div className="text-xs text-gray-500">Current collection rate</div>
            <div className="text-lg font-bold text-gray-900">{runway ? `${runway.collection_rate_pct.toFixed(0)}%` : "—"}</div>
          </div>
        </div>

        {projData.length > 0 && (
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={projData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={(v) => lakhs(v * 100)} tick={{ fontSize: 11 }} width={55} />
              <Tooltip formatter={(value) => `${lakhs(Number(value) * 100)}`} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="Current rate" stroke="#1a2332" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="10% drop" stroke="#2d6a5e" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="25% drop" stroke="#94a3b8" strokeWidth={1.5} dot={false} strokeDasharray="5 5" />
              <Line type="monotone" dataKey="50% drop" stroke="#cbd5e1" strokeWidth={1.5} dot={false} strokeDasharray="5 5" />
            </LineChart>
          </ResponsiveContainer>
        )}

        {/* Scenario badges */}
        <div className="flex flex-wrap gap-2 mt-4">
          {runway && (() => {
            const r = runway;
            const scenarios = [
              { label: "Current rate", drop: 0, color: "green" },
              { label: "10% drop", drop: 10, color: "amber" },
              { label: "25% drop", drop: 25, color: "orange" },
              { label: "50% drop", drop: 50, color: "red" },
            ];
            return scenarios.map((s) => {
              const rate = Math.max(0, r.collection_rate_pct - s.drop) / 100;
              const monthlyInflow = Math.round(r.avg_monthly_expected_paise * rate);
              const monthlyNet = monthlyInflow - r.avg_monthly_burn_paise;
              const isPositive = monthlyNet >= 0;
              // Find how many months in projection before net goes negative
              const projKey = s.drop === 0 ? "current_rate" : `drop_${s.drop}`;
              const proj = r.projection;
              const deficitIdx = proj.findIndex((p) => {
                const val = s.drop === 0 ? p.current_rate : s.drop === 10 ? p.drop_10 : s.drop === 25 ? p.drop_25 : p.drop_50;
                return val < 0;
              });
              const monthsLabel = isPositive
                ? "sustainable"
                : deficitIdx >= 0
                ? `deficit in ${deficitIdx + 1}mo`
                : "deficit";
              const bgColor = isPositive
                ? "bg-green-50 text-green-800 border-green-200"
                : deficitIdx >= 0 && deficitIdx < 3
                ? "bg-red-50 text-red-800 border-red-200"
                : "bg-amber-50 text-amber-800 border-amber-200";
              return (
                <div key={s.label} className={`text-xs font-medium px-3 py-1.5 rounded-full border ${bgColor}`}>
                  {s.label}: {monthsLabel}
                  <span className="ml-1 opacity-70">({isPositive ? "+" : ""}{formatMoneyCompact(Math.abs(monthlyNet), "INR")}/mo)</span>
                </div>
              );
            });
          })()}
        </div>
      </div>

      {/* Row 4: Detail table */}
      <div className="bg-white rounded-lg border p-5" style={{ borderColor: "var(--card-border)" }}>
        <h3 className="font-bold text-gray-900 mb-4">All outgoing payments</h3>
        <div className="flex gap-3 mb-4">
          <select value={category} onChange={(e) => setCategory(e.target.value)}
            className="text-sm border border-gray-300 rounded-md px-3 py-2">
            <option value="">All categories</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={currency} onChange={(e) => setCurrency(e.target.value)}
            className="text-sm border border-gray-300 rounded-md px-3 py-2">
            <option value="">All currencies</option>
            <option value="INR">INR</option>
            <option value="USD">USD</option>
          </select>
        </div>

        {!data || data.items.length === 0 ? (
          <p className="text-gray-500 py-4 text-center">No outgoing payments.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b bg-gray-50">
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Payee</th>
                  <th className="px-4 py-3 font-medium">Category</th>
                  <th className="px-4 py-3 font-medium text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.items.map((r) => (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5">{formatDate(r.date)}</td>
                    <td className="px-4 py-2.5 font-medium text-gray-900">{r.payee}</td>
                    <td className="px-4 py-2.5 capitalize">{r.category}</td>
                    <td className="px-4 py-2.5 text-right font-medium">{formatMoney(r.amount_paise, r.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
