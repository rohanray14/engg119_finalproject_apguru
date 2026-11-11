"use client";

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

// Muted monochrome palette -- teal accent with grays
const CAT_COLORS: Record<string, string> = {
  faculty: "#3da391",
  ads: "#00DC82",
  software: "#5bb8a8",
  tax: "#7ecdbf",
  refund: "#FFB020",
  rent: "#a3e0d5",
  other: "#B0B0C0",
  commission: "#4D9EFF",
};

export default function MoneyOutPage() {
  const { data, isLoading } = useSWR<MoneyOutData>("/money-out", fetcher);

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
        <h1 className="text-3xl font-bold mb-1" style={{ color: "var(--text)" }}>Expenses</h1>
        <p className="text-sm mb-6" style={{ color: "var(--text-secondary)" }}>Where money is going, by category and month.</p>
        <div className="animate-pulse space-y-4">
          <div className="grid grid-cols-3 gap-3">{[...Array(3)].map((_, i) => <div key={i} className="h-24 rounded-lg" style={{ backgroundColor: "var(--surface)" }} />)}</div>
          <div className="h-64 rounded-lg" style={{ backgroundColor: "var(--surface)" }} />
        </div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-1" style={{ color: "var(--text)" }}>Expenses</h1>
      <p className="text-sm mb-6" style={{ color: "var(--text-secondary)" }}>Where money is going, by category and month.</p>

      {/* Row 1: Key metrics */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
        <div className="rounded-xl border p-4" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
          <div className="text-sm" style={{ color: "var(--text-secondary)" }}>Total spent (all time)</div>
          <div className="text-2xl font-bold" style={{ color: "var(--text)" }}>{data ? formatMoneyCompact(data.total_spent_paise, "INR") : "—"}</div>
          <div className="text-xs" style={{ color: "var(--text-tertiary)" }}>{data?.total ?? 0} payments</div>
        </div>
        <div className="rounded-xl border p-4" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
          <div className="text-sm" style={{ color: "var(--text-secondary)" }}>Avg monthly burn</div>
          <div className="text-2xl font-bold" style={{ color: "var(--text)" }}>{data ? formatMoneyCompact(data.avg_monthly_burn_paise, "INR") : "—"}</div>
          {prevMonthSpend > 0 && (
            <div className="text-xs font-medium" style={{ color: momPct > 0 ? "var(--danger)" : "var(--accent)" }}>
              {momPct > 0 ? "+" : ""}{momPct.toFixed(0)}% MoM
            </div>
          )}
        </div>
        <div className="rounded-xl border p-4" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
          <div className="text-sm" style={{ color: "var(--text-secondary)" }}>Last month</div>
          <div className="text-2xl font-bold" style={{ color: "var(--text)" }}>{formatMoneyCompact(lastMonthSpend, "INR")}</div>
          {prevMonthSpend > 0 && (
            <div className="text-xs" style={{ color: "var(--text-tertiary)" }}>Prior: {formatMoneyCompact(prevMonthSpend, "INR")}</div>
          )}
        </div>
      </div>

      {/* Row 2: Monthly trend + Category breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 mb-6">
        <div className="lg:col-span-3 rounded-xl border p-5" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
          <h3 className="font-bold mb-1" style={{ color: "var(--text)" }}>Monthly spend trend</h3>
          <p className="text-xs mb-4" style={{ color: "var(--text-secondary)" }}>Month-over-month outflows by category</p>
          {trendData.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={trendData} barGap={1}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border-subtle)" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: "var(--text-secondary)" }} />
                <YAxis tickFormatter={(v) => lakhs(v * 100)} tick={{ fontSize: 11, fill: "var(--text-secondary)" }} width={50} />
                <Tooltip formatter={(value) => `${lakhs(Number(value) * 100)}`} contentStyle={{ backgroundColor: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)" }} />
                <Legend iconType="square" wrapperStyle={{ fontSize: 11 }} />
                {allCats.map((c) => (
                  <Bar key={c} dataKey={c} stackId="a" fill={CAT_COLORS[c] || "#B0B0C0"} name={c} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="text-sm py-8 text-center" style={{ color: "var(--text-tertiary)" }}>No data</div>
          )}
        </div>

        <div className="lg:col-span-2 rounded-xl border p-5" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
          <h3 className="font-bold mb-1" style={{ color: "var(--text)" }}>Spend by category</h3>
          <p className="text-xs mb-4" style={{ color: "var(--text-secondary)" }}>All-time breakdown</p>
          <div className="space-y-2.5">
            {(data?.summary ?? []).map((s, i) => {
              const pct = data && data.total_spent_paise > 0
                ? (s.total_paise / data.total_spent_paise * 100)
                : 0;
              return (
                <div key={i}>
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: CAT_COLORS[s.category] || "#B0B0C0" }} />
                      <span className="font-medium capitalize" style={{ color: "var(--text)" }}>{s.category}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span style={{ color: "var(--text)" }}>{formatMoneyCompact(s.total_paise, s.currency)}</span>
                      <span className="text-xs w-8 text-right" style={{ color: "var(--text-tertiary)" }}>{pct.toFixed(0)}%</span>
                    </div>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: "var(--surface-hover)" }}>
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${pct}%`, backgroundColor: CAT_COLORS[s.category] || "#B0B0C0" }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Detail table */}
      <div className="rounded-xl border p-5" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
        <h3 className="font-bold mb-4" style={{ color: "var(--text)" }}>All outgoing payments</h3>

        {!data || data.items.length === 0 ? (
          <p className="py-4 text-center" style={{ color: "var(--text-secondary)" }}>No outgoing payments.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs border-b" style={{ color: "var(--text-secondary)", borderColor: "var(--border-subtle)", backgroundColor: "var(--surface-hover)" }}>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Payee</th>
                  <th className="px-4 py-3 font-medium">Category</th>
                  <th className="px-4 py-3 font-medium text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((r) => (
                  <tr key={r.id}
                    style={{ borderBottom: "1px solid var(--border-subtle)" }}
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "var(--surface-hover)"}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = ""}>
                    <td className="px-4 py-2.5">{formatDate(r.date)}</td>
                    <td className="px-4 py-2.5 font-medium" style={{ color: "var(--text)" }}>{r.payee}</td>
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
