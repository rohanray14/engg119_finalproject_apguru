"use client";

import { useState } from "react";
import useSWR from "swr";
import { apiFetch } from "@/lib/api";
import { formatMoney, formatMoneyCompact, formatDate } from "@/lib/format";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend,
  ResponsiveContainer, CartesianGrid,
} from "recharts";

interface MonthlySummary {
  month: string;
  total_paise: number;
  by_category: Record<string, number>;
}

interface MoneyOutData {
  summary: { category: string; currency: string; count: number; total_paise: number }[];
  total: number;
  items: { id: number; date: string; payee: string; category: string; amount_paise: number; currency: string }[];
  total_spent_paise: number;
  total_received_paise: number;
  avg_monthly_burn_paise: number;
  monthly_spend: MonthlySummary[];
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

  // MoM delta
  const ms = data?.monthly_spend ?? [];
  const lastMonthSpend = ms.length >= 1 ? ms[ms.length - 1].total_paise : 0;
  const prevMonthSpend = ms.length >= 2 ? ms[ms.length - 2].total_paise : 0;
  const momPct = prevMonthSpend > 0
    ? ((lastMonthSpend - prevMonthSpend) / prevMonthSpend * 100)
    : 0;

  if (isLoading) {
    return (
      <div className="p-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-1">Money out</h1>
        <p className="text-sm text-gray-500 mb-6">Where money is going, by category and month.</p>
        <div className="animate-pulse space-y-4">
          <div className="grid grid-cols-3 gap-3">{[...Array(3)].map((_, i) => <div key={i} className="h-24 bg-gray-200 rounded-lg" />)}</div>
          <div className="h-64 bg-gray-200 rounded-lg" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-1">Money out</h1>
      <p className="text-sm text-gray-500 mb-6">Where money is going, by category and month.</p>

      {/* Row 1: Key metrics */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
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

      {/* Detail table */}
      <div className="bg-white rounded-lg border p-5" style={{ borderColor: "var(--card-border)" }}>
        <h3 className="font-bold text-gray-900 mb-4">All outgoing payments</h3>
        <div className="flex gap-3 mb-4">
          <select value={category} onChange={(e) => setCategory(e.target.value)}
            className="text-sm border border-gray-300 rounded-md px-3 py-2">
            <option value="">All categories</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
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
