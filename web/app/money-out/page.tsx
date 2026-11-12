"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { apiFetch } from "@/lib/api";
import { formatMoney, formatMoneyCompact, formatDate } from "@/lib/format";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid,
  PieChart, Pie, Cell, Legend,
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

// Distinct colors per category
const CAT_COLORS: Record<string, string> = {
  faculty: "#6366F1",   // indigo
  ads: "#F59E0B",       // amber
  software: "#3B82F6",  // blue
  tax: "#EF4444",       // red
  refund: "#F97316",    // orange
  rent: "#8B5CF6",      // violet
  other: "#6B7280",     // gray
  commission: "#06B6D4", // cyan
};

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

type SortKey = "date" | "payee" | "category" | "amount_paise" | null;
type SortDir = "asc" | "desc";
const PAGE_SIZE = 50;

export default function MoneyOutPage() {
  const { data, isLoading } = useSWR<MoneyOutData>("/money-out", fetcher);

  // Filters
  const [categoryFilter, setCategoryFilter] = useState("");
  const [monthFilter, setMonthFilter] = useState("");
  const [payeeSearch, setPayeeSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(0);

  // Simple bar chart data (total per month)
  const trendData = (data?.monthly_spend ?? []).map((m) => ({
    month: monthLabel(m.month),
    total: m.total_paise / 100,
    totalPaise: m.total_paise,
  }));

  // Pie chart data
  const pieData = (data?.summary ?? []).map((s) => ({
    name: s.category,
    value: s.total_paise / 100,
    paise: s.total_paise,
  }));

  // MoM delta
  const ms = data?.monthly_spend ?? [];
  const lastMonthSpend = ms.length >= 1 ? ms[ms.length - 1].total_paise : 0;
  const prevMonthSpend = ms.length >= 2 ? ms[ms.length - 2].total_paise : 0;
  const momPct = prevMonthSpend > 0
    ? ((lastMonthSpend - prevMonthSpend) / prevMonthSpend * 100)
    : 0;

  // Available categories and months from data
  const allCategories = useMemo(() => {
    if (!data) return [];
    return [...new Set(data.items.map((r) => r.category))].sort();
  }, [data]);

  const availableMonths = useMemo(() => {
    if (!data) return [];
    const set = new Set<string>();
    for (const r of data.items) {
      if (r.date) set.add(r.date.slice(0, 7));
    }
    return Array.from(set).sort().reverse();
  }, [data]);

  // Filtering
  const filtered = useMemo(() => {
    if (!data) return [];
    let items = data.items;
    if (categoryFilter) items = items.filter((r) => r.category === categoryFilter);
    if (monthFilter) items = items.filter((r) => r.date.startsWith(monthFilter));
    if (payeeSearch) {
      const q = payeeSearch.toLowerCase();
      items = items.filter((r) => r.payee.toLowerCase().includes(q));
    }
    return items;
  }, [data, categoryFilter, monthFilter, payeeSearch]);

  // Sorting
  const sorted = useMemo(() => {
    const items = [...filtered];
    if (sortKey) {
      items.sort((a, b) => {
        const av = a[sortKey] ?? "";
        const bv = b[sortKey] ?? "";
        if (typeof av === "string" && typeof bv === "string") {
          const cmp = av.localeCompare(bv);
          return sortDir === "asc" ? cmp : -cmp;
        }
        return sortDir === "asc" ? Number(av) - Number(bv) : Number(bv) - Number(av);
      });
    }
    return items;
  }, [filtered, sortKey, sortDir]);

  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  const pageItems = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const activeFilters = [categoryFilter, monthFilter, payeeSearch].filter(Boolean).length;

  function clearAll() {
    setCategoryFilter(""); setMonthFilter(""); setPayeeSearch(""); setPage(0);
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      if (sortDir === "asc") {
        setSortDir("desc");
      } else {
        setSortKey(null);
      }
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
    setPage(0);
  }

  function SortHeader({ label, field, align }: { label: string; field: SortKey; align?: string }) {
    const active = sortKey === field;
    return (
      <th
        className={`px-4 py-3 font-medium cursor-pointer select-none ${align === "right" ? "text-right" : ""}`}
        style={{ color: "var(--text-secondary)" }}
        onClick={() => toggleSort(field)}
      >
        {label}
        {active
          ? <span className="ml-1" style={{ color: "var(--text)" }}>{sortDir === "asc" ? "↑" : "↓"}</span>
          : <span className="ml-1" style={{ color: "var(--text-tertiary)" }}>↕</span>}
      </th>
    );
  }

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
        </div>
        <div className="rounded-xl border p-4" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
          <div className="text-sm" style={{ color: "var(--text-secondary)" }}>Last month</div>
          <div className="text-2xl font-bold" style={{ color: "var(--text)" }}>{formatMoneyCompact(lastMonthSpend, "INR")}</div>
          {prevMonthSpend > 0 && (
            <div className="text-xs font-medium" style={{ color: momPct > 0 ? "var(--danger)" : "var(--accent)" }}>
              {momPct > 0 ? "+" : ""}{momPct.toFixed(0)}% vs prior month
            </div>
          )}
        </div>
      </div>

      {/* Row 2: Monthly trend (simple bars) + Category pie chart */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 mb-6">
        <div className="lg:col-span-3 rounded-xl border p-5" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
          <h3 className="font-bold mb-1" style={{ color: "var(--text)" }}>Monthly spend</h3>
          <p className="text-xs mb-4" style={{ color: "var(--text-secondary)" }}>Total outflows per month</p>
          {trendData.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={trendData} barGap={1}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border-subtle)" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: "var(--text-secondary)" }} />
                <YAxis tickFormatter={(v) => lakhs(v * 100)} tick={{ fontSize: 11, fill: "var(--text-secondary)" }} width={50} />
                <Tooltip
                  formatter={(value) => [`${lakhs(Number(value) * 100)}`, "Spent"]}
                  contentStyle={{ backgroundColor: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)" }}
                />
                <Bar dataKey="total" fill="var(--accent)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="text-sm py-8 text-center" style={{ color: "var(--text-tertiary)" }}>No data</div>
          )}
        </div>

        <div className="lg:col-span-2 rounded-xl border p-5" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
          <h3 className="font-bold mb-1" style={{ color: "var(--text)" }}>Spend by category</h3>
          <p className="text-xs mb-4" style={{ color: "var(--text-secondary)" }}>All-time breakdown</p>
          {pieData.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie
                  data={pieData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={90}
                  paddingAngle={2}
                  stroke="none"
                >
                  {pieData.map((entry) => (
                    <Cell key={entry.name} fill={CAT_COLORS[entry.name] || "#6B7280"} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value, name) => [`${lakhs(Number(value) * 100)}`, String(name)]}
                  contentStyle={{ backgroundColor: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)", textTransform: "capitalize" }}
                />
                <Legend
                  iconType="circle"
                  iconSize={8}
                  formatter={(value: string) => <span style={{ color: "var(--text)", fontSize: 11, textTransform: "capitalize" }}>{value}</span>}
                />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="text-sm py-8 text-center" style={{ color: "var(--text-tertiary)" }}>No data</div>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="rounded-xl border p-4 mb-6"
        style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-tertiary)" }}>Filter payments</span>
          {activeFilters > 0 && (
            <button onClick={clearAll} className="text-xs underline" style={{ color: "var(--text-secondary)" }}>
              Clear all filters
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs mb-1" style={{ color: "var(--text-secondary)" }}>Category</label>
            <select value={categoryFilter} onChange={(e) => { setCategoryFilter(e.target.value); setPage(0); }}
              className="w-full text-sm rounded-md px-3 py-2"
              style={{ backgroundColor: "var(--surface-hover)", border: "1px solid var(--border)", color: "var(--text)" }}>
              <option value="">All categories</option>
              {allCategories.map((c) => (
                <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs mb-1" style={{ color: "var(--text-secondary)" }}>Month</label>
            <select value={monthFilter} onChange={(e) => { setMonthFilter(e.target.value); setPage(0); }}
              className="w-full text-sm rounded-md px-3 py-2"
              style={{ backgroundColor: "var(--surface-hover)", border: "1px solid var(--border)", color: "var(--text)" }}>
              <option value="">All time</option>
              {availableMonths.map((m) => {
                const [y, mo] = m.split("-");
                return <option key={m} value={m}>{MONTHS[parseInt(mo) - 1]} {y}</option>;
              })}
            </select>
          </div>
          <div>
            <label className="block text-xs mb-1" style={{ color: "var(--text-secondary)" }}>Payee</label>
            <input
              type="text"
              placeholder="Search payee..."
              value={payeeSearch}
              onChange={(e) => { setPayeeSearch(e.target.value); setPage(0); }}
              className="w-full text-sm rounded-md px-3 py-2"
              style={{ backgroundColor: "var(--surface-hover)", border: "1px solid var(--border)", color: "var(--text)" }}
            />
          </div>
        </div>
      </div>

      {/* Count + pagination */}
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
          {sorted.length} payments{activeFilters > 0 ? " (filtered)" : ""}
          {totalPages > 1 && ` · page ${page + 1} of ${totalPages}`}
        </p>
        {totalPages > 1 && (
          <div className="flex items-center gap-1">
            <button onClick={() => setPage(page - 1)} disabled={page === 0}
              className="px-2 py-1 text-xs rounded disabled:opacity-30"
              style={{ border: "1px solid var(--border)", color: "var(--text)" }}>Prev</button>
            <button onClick={() => setPage(page + 1)} disabled={page >= totalPages - 1}
              className="px-2 py-1 text-xs rounded disabled:opacity-30"
              style={{ border: "1px solid var(--border)", color: "var(--text)" }}>Next</button>
          </div>
        )}
      </div>

      {/* Detail table */}
      <div className="rounded-xl border overflow-x-auto" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
        {sorted.length === 0 ? (
          <p className="py-8 text-center" style={{ color: "var(--text-secondary)" }}>No outgoing payments match the filters.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs border-b" style={{ color: "var(--text-secondary)", borderColor: "var(--border-subtle)", backgroundColor: "var(--surface-hover)" }}>
                <SortHeader label="Date" field="date" />
                <SortHeader label="Payee" field="payee" />
                <SortHeader label="Category" field="category" />
                <SortHeader label="Amount" field="amount_paise" align="right" />
              </tr>
            </thead>
            <tbody>
              {pageItems.map((r) => (
                <tr key={r.id}
                  style={{ borderBottom: "1px solid var(--border-subtle)" }}
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "var(--surface-hover)"}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = ""}>
                  <td className="px-4 py-2.5 whitespace-nowrap">{formatDate(r.date)}</td>
                  <td className="px-4 py-2.5 font-medium" style={{ color: "var(--text)" }}>{r.payee}</td>
                  <td className="px-4 py-2.5 capitalize">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: CAT_COLORS[r.category] || "#6B7280" }} />
                      {r.category}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right font-medium">{formatMoney(r.amount_paise, r.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Bottom pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-1 mt-4">
          <button onClick={() => setPage(page - 1)} disabled={page === 0}
            className="px-2 py-1 text-xs rounded disabled:opacity-30"
            style={{ border: "1px solid var(--border)", color: "var(--text)" }}>Prev</button>
          <span className="text-xs px-2" style={{ color: "var(--text-secondary)" }}>{page + 1} / {totalPages}</span>
          <button onClick={() => setPage(page + 1)} disabled={page >= totalPages - 1}
            className="px-2 py-1 text-xs rounded disabled:opacity-30"
            style={{ border: "1px solid var(--border)", color: "var(--text)" }}>Next</button>
        </div>
      )}
    </div>
  );
}
