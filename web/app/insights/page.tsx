"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import useSWR from "swr";
import { apiFetch } from "@/lib/api";
import { formatMoney, formatMoneyCompact } from "@/lib/format";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Cell, PieChart, Pie,
} from "recharts";

interface ProgramRow { program: string; students: number; enrollments: number; total_fee_paise: number; collected_paise: number }
interface CountryRow { country: string; students: number; total_fee_paise: number; collected_paise: number }
interface CityRow { city: string; students: number; collected_paise: number }
interface FeeModelRow { fee_model: string; students: number; enrollments: number; total_fee_paise: number; collected_paise: number }
interface MethodRow { pay_method: string; payments: number; collected_paise: number }
interface MonthRow { month: string; payments: number; collected_paise: number }
interface Collection {
  total_due_paise: number; total_collected_paise: number; collection_rate: number;
  overdue_installments: number; total_installments: number;
  mom_change: number | null;
}

interface InsightsData {
  by_program: ProgramRow[];
  by_country: CountryRow[];
  by_city: CityRow[];
  by_fee_model: FeeModelRow[];
  by_method: MethodRow[];
  by_month: MonthRow[];
  collection: Collection;
}

function fetcher<T>(path: string) { return apiFetch<T>(path); }

// Distinct professional palette for charts
const CHART_PALETTE = [
  "#6366F1", // indigo
  "#3B82F6", // blue
  "#06B6D4", // cyan
  "#8B5CF6", // violet
  "#EC4899", // pink
  "#F59E0B", // amber
  "#10B981", // emerald
  "#EF4444", // red
];

const METHOD_LABELS: Record<string, string> = {
  neft: "Bank (NEFT)", upi: "UPI", imps: "Bank (IMPS)",
  stripe: "Stripe", payglocal: "PayGlocal", razorpay: "Razorpay",
  cash: "Cash", screenshot: "Screenshot",
  bank: "Bank transfer", gateway: "Gateway",
};

function lakhs(paise: number): string {
  const amt = Math.abs(paise) / 100;
  if (amt >= 10000000) return `₹${(amt / 10000000).toFixed(1)}Cr`;
  if (amt >= 100000) return `₹${(amt / 100000).toFixed(1)}L`;
  if (amt >= 1000) return `₹${(amt / 1000).toFixed(0)}K`;
  return `₹${amt.toFixed(0)}`;
}

function monthLabel(iso: string): string {
  const [y, m] = iso.split("-");
  return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][parseInt(m) - 1]} '${y.slice(2)}`;
}

function RingGauge({ rate, size = 120 }: { rate: number; size?: number }) {
  const pct = Math.round(rate * 100);
  const r = (size - 16) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - rate);
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke="var(--border-subtle)" strokeWidth={10} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke="var(--accent)" strokeWidth={10}
          strokeDasharray={circ} strokeDashoffset={offset}
          strokeLinecap="round" className="transition-all duration-700" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold" style={{ color: "var(--text)" }}>{pct}%</span>
        <span className="text-[10px] uppercase tracking-wider" style={{ color: "var(--text-tertiary)" }}>collected</span>
      </div>
    </div>
  );
}

type TimeRange = "all" | "6m" | "3m";

export default function InsightsPage() {
  const { data, isLoading } = useSWR<InsightsData>("/insights", fetcher);
  const [programFilter, setProgramFilter] = useState<string | null>(null);
  const [countryFilter, setCountryFilter] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState<TimeRange>("all");

  // Filter month data by time range
  const filteredMonths = useMemo(() => {
    if (!data) return [];
    const months = data.by_month;
    if (timeRange === "all") return months;
    const cutoff = timeRange === "6m" ? 6 : 3;
    return months.slice(-cutoff);
  }, [data, timeRange]);

  if (isLoading || !data) {
    return (
      <div className="p-8">
        <h1 className="text-3xl font-bold mb-1" style={{ color: "var(--text)" }}>Insights</h1>
        <p className="text-sm mb-6" style={{ color: "var(--text-secondary)" }}>Where your revenue comes from and how collection is tracking.</p>
        <div className="animate-pulse space-y-4">
          {[1, 2, 3].map((i) => <div key={i} className="h-48 rounded-lg" style={{ backgroundColor: "var(--surface)" }} />)}
        </div>
      </div>
    );
  }

  const { by_program, by_country, by_city, by_fee_model, by_method, collection } = data;

  // Derived data
  const totalStudents = by_country.reduce((s, r) => s + r.students, 0);
  const totalPrograms = by_program.length;
  const collectedPaise = collection.total_collected_paise;
  const duePaise = collection.total_due_paise;
  const outstandingPaise = duePaise - collectedPaise;

  // Filtered program data
  const filteredPrograms = programFilter
    ? by_program.filter((r) => r.program === programFilter)
    : by_program;

  // Filtered country/city data
  const filteredCountries = countryFilter
    ? by_country.filter((r) => r.country === countryFilter)
    : by_country;
  const filteredCities = countryFilter
    ? by_city
    : by_city;

  // Chart data
  const monthData = filteredMonths.map((r) => ({
    month: monthLabel(r.month),
    amount: r.collected_paise / 100,
    payments: r.payments,
    raw: r.collected_paise,
  }));

  const methodData = by_method.map((r, i) => ({
    name: METHOD_LABELS[r.pay_method] ?? r.pay_method,
    value: r.collected_paise,
    payments: r.payments,
    color: CHART_PALETTE[i % CHART_PALETTE.length],
  }));
  const totalMethodPaise = by_method.reduce((s, r) => s + r.collected_paise, 0);

  const hasActiveFilters = !!programFilter || !!countryFilter;

  // Export as CSV
  function exportCSV() {
    const rows = [
      ["Section", "Name", "Students", "Collected (INR)", "Total Fee (INR)", "% Collected"],
      ...by_program.map((r) => [
        "Program", r.program, String(r.students),
        String(r.collected_paise / 100), String(r.total_fee_paise / 100),
        r.total_fee_paise > 0 ? `${Math.round((r.collected_paise / r.total_fee_paise) * 100)}%` : "0%",
      ]),
      ...by_country.map((r) => [
        "Country", r.country, String(r.students),
        String(r.collected_paise / 100), String(r.total_fee_paise / 100),
        r.total_fee_paise > 0 ? `${Math.round((r.collected_paise / r.total_fee_paise) * 100)}%` : "0%",
      ]),
      ...by_city.map((r) => [
        "City", r.city, String(r.students), String(r.collected_paise / 100), "", "",
      ]),
      ...filteredMonths.map((r) => [
        "Month", monthLabel(r.month), "", String(r.collected_paise / 100), "", "",
      ]),
    ];
    const csv = rows.map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "insights.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold" style={{ color: "var(--text)" }}>Insights</h1>
          <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>Where your revenue comes from and how collection is tracking.</p>
        </div>
        <button onClick={exportCSV}
          className="text-xs px-3 py-1.5 rounded-md font-medium shrink-0 mt-1"
          style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }}>
          Export CSV
        </button>
      </div>

      {/* Filter chips */}
      {(by_program.length > 1 || by_country.length > 1) && (
        <div className="flex flex-wrap items-center gap-2 mb-6">
          {by_program.length > 1 && (
            <>
              <span className="text-[10px] uppercase tracking-wider font-semibold mr-1" style={{ color: "var(--text-tertiary)" }}>Program:</span>
              <button onClick={() => setProgramFilter(null)}
                className="text-xs px-2.5 py-1 rounded-full font-medium transition-colors"
                style={!programFilter
                  ? { backgroundColor: "var(--text)", color: "var(--bg)" }
                  : { backgroundColor: "var(--bg)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}>
                All
              </button>
              {by_program.map((r) => (
                <button key={r.program}
                  onClick={() => setProgramFilter(programFilter === r.program ? null : r.program)}
                  className="text-xs px-2.5 py-1 rounded-full font-medium transition-colors"
                  style={programFilter === r.program
                    ? { backgroundColor: "var(--text)", color: "var(--bg)" }
                    : { backgroundColor: "var(--bg)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}>
                  {r.program}
                </button>
              ))}
            </>
          )}
          {by_program.length > 1 && by_country.length > 1 && (
            <span className="w-px h-4 mx-1" style={{ backgroundColor: "var(--border)" }} />
          )}
          {by_country.length > 1 && (
            <>
              <span className="text-[10px] uppercase tracking-wider font-semibold mr-1" style={{ color: "var(--text-tertiary)" }}>Country:</span>
              <button onClick={() => setCountryFilter(null)}
                className="text-xs px-2.5 py-1 rounded-full font-medium transition-colors"
                style={!countryFilter
                  ? { backgroundColor: "var(--text)", color: "var(--bg)" }
                  : { backgroundColor: "var(--bg)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}>
                All
              </button>
              {by_country.map((r) => (
                <button key={r.country}
                  onClick={() => setCountryFilter(countryFilter === r.country ? null : r.country)}
                  className="text-xs px-2.5 py-1 rounded-full font-medium transition-colors"
                  style={countryFilter === r.country
                    ? { backgroundColor: "var(--text)", color: "var(--bg)" }
                    : { backgroundColor: "var(--bg)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}>
                  {r.country}
                </button>
              ))}
            </>
          )}
          {hasActiveFilters && (
            <button onClick={() => { setProgramFilter(null); setCountryFilter(null); }}
              className="text-xs px-2 py-1 rounded-md ml-2 underline"
              style={{ color: "var(--accent)" }}>
              Clear filters
            </button>
          )}
        </div>
      )}

      {/* Hero metrics row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-8">
        {/* Collection health — links to risk */}
        <Link href="/risk"
          className="rounded-xl border p-6 flex items-center gap-6 transition-colors"
          style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
          <RingGauge rate={collection.collection_rate} size={110} />
          <div>
            <div className="text-sm mb-1" style={{ color: "var(--text-secondary)" }}>Collection health</div>
            <div className="text-xl font-bold" style={{ color: "var(--text)" }}>{formatMoneyCompact(collectedPaise, "INR")}</div>
            {outstandingPaise > 0 && (
              <div className="text-xs mt-1 font-medium" style={{ color: "var(--text-secondary)" }}>
                {formatMoneyCompact(outstandingPaise, "INR")} outstanding
              </div>
            )}
            {collection.mom_change !== null && (
              <div className="text-xs mt-1 font-medium" style={{ color: "var(--text-secondary)" }}>
                {collection.mom_change >= 0 ? "+" : ""}{Math.round(collection.mom_change * 100)}% vs last month
              </div>
            )}
          </div>
        </Link>

        <div className="rounded-xl border p-6" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
          <div className="text-xs uppercase tracking-wider font-medium mb-3" style={{ color: "var(--text-tertiary)" }}>Students & programs</div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold" style={{ color: "var(--text)" }}>{totalStudents}</span>
            <span className="text-sm" style={{ color: "var(--text-secondary)" }}>students</span>
          </div>
          <div className="flex items-center gap-4 mt-2 text-xs" style={{ color: "var(--text-secondary)" }}>
            <span>{totalPrograms} programs</span>
            <span>{collection.total_installments} installments</span>
            {collection.overdue_installments > 0 && (
              <Link href="/reminders?type=overdue" className="font-medium hover:underline" style={{ color: "var(--danger)" }}>
                {collection.overdue_installments} overdue
              </Link>
            )}
          </div>
        </div>

        <div className="rounded-xl border p-6" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
          <div className="text-xs uppercase tracking-wider font-medium mb-3" style={{ color: "var(--text-tertiary)" }}>Avg fee per student</div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold" style={{ color: "var(--text)" }}>
              {totalStudents > 0 ? formatMoneyCompact(Math.round(duePaise / totalStudents), "INR") : "—"}
            </span>
          </div>
        </div>
      </div>

      {/* Monthly trend -- line chart, full width */}
      <div className="rounded-xl border p-6 mb-8" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
        <div className="flex items-center justify-between mb-5">
          <div>
            <h3 className="font-bold" style={{ color: "var(--text)" }}>Monthly collections</h3>
            <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>Revenue received per month</p>
          </div>
          <div className="flex items-center gap-2">
            {(["all", "6m", "3m"] as const).map((range) => (
              <button key={range}
                onClick={() => setTimeRange(range)}
                className="text-xs px-2.5 py-1 rounded-md font-medium transition-colors"
                style={timeRange === range
                  ? { backgroundColor: "var(--text)", color: "var(--bg)" }
                  : { color: "var(--text-tertiary)", border: "1px solid var(--border)" }}>
                {range === "all" ? "All" : range === "6m" ? "6 months" : "3 months"}
              </button>
            ))}
          </div>
        </div>
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={monthData}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border-subtle)" />
            <XAxis dataKey="month" tick={{ fontSize: 11, fill: "var(--text-secondary)" }} tickLine={false} axisLine={false} />
            <YAxis tickFormatter={(v) => lakhs(v * 100)} tick={{ fontSize: 11, fill: "var(--text-secondary)" }} tickLine={false} axisLine={false} width={55} />
            <Tooltip
              formatter={(value) => [lakhs(Number(value) * 100), "Collected"]}
              labelStyle={{ fontWeight: 600, color: "var(--text)" }}
              contentStyle={{ borderRadius: 8, border: "1px solid var(--border)", fontSize: 13, backgroundColor: "var(--surface)", color: "var(--text)" }}
            />
            <Line
              type="monotone"
              dataKey="amount"
              stroke="var(--accent)"
              strokeWidth={2}
              dot={{ fill: "var(--accent)", r: 3, strokeWidth: 0 }}
              activeDot={{ fill: "var(--accent)", r: 5, strokeWidth: 2, stroke: "var(--surface)" }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Programs + Geography -- side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* Revenue by program */}
        <div className="rounded-xl border p-6" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
          <h3 className="font-bold mb-1" style={{ color: "var(--text)" }}>Revenue by program</h3>
          <p className="text-xs mb-5" style={{ color: "var(--text-secondary)" }}>Fee collection across all programs</p>
          <div className="space-y-4">
            {filteredPrograms.map((r, i) => {
              const pctCollected = r.total_fee_paise > 0 ? Math.round((r.collected_paise / r.total_fee_paise) * 100) : 0;
              const barMax = Math.max(...by_program.map((p) => p.total_fee_paise), 1);
              return (
                <button key={r.program} className="w-full text-left"
                  onClick={() => setProgramFilter(programFilter === r.program ? null : r.program)}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-sm font-medium hover:underline" style={{
                      color: programFilter === r.program ? "var(--accent)" : "var(--text)",
                    }}>{r.program}</span>
                    <div className="flex items-center gap-3">
                      <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>{r.students} students</span>
                      <span className="text-sm font-semibold" style={{ color: "var(--text)" }}>
                        {formatMoneyCompact(r.collected_paise, "INR")}
                      </span>
                    </div>
                  </div>
                  <div className="relative h-2.5 rounded-full overflow-hidden" style={{ backgroundColor: "var(--surface-hover)" }}>
                    <div className="absolute inset-y-0 left-0 rounded-full"
                      style={{ width: `${(r.total_fee_paise / barMax) * 100}%`, backgroundColor: "var(--border)" }} />
                    <div className="absolute inset-y-0 left-0 rounded-full transition-all duration-500"
                      style={{
                        width: `${(r.collected_paise / barMax) * 100}%`,
                        backgroundColor: CHART_PALETTE[i % CHART_PALETTE.length],
                      }} />
                  </div>
                  <div className="flex justify-end mt-1">
                    <span className="text-[11px] font-medium" style={{ color: "var(--text-secondary)" }}>
                      {pctCollected}% collected
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Geography */}
        <div className="rounded-xl border p-6" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
          <h3 className="font-bold mb-1" style={{ color: "var(--text)" }}>Revenue by geography</h3>
          <p className="text-xs mb-5" style={{ color: "var(--text-secondary)" }}>Where students and revenue come from</p>

          {/* Countries */}
          <div className="mb-6">
            <div className="text-[10px] font-semibold uppercase tracking-widest mb-3" style={{ color: "var(--text-tertiary)" }}>By country</div>
            <div className="space-y-3">
              {filteredCountries.map((r, i) => {
                const maxCountry = Math.max(...by_country.map((c) => c.collected_paise), 1);
                return (
                  <button key={r.country} className="w-full text-left"
                    onClick={() => setCountryFilter(countryFilter === r.country ? null : r.country)}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: CHART_PALETTE[i % CHART_PALETTE.length] }} />
                        <span className="text-sm font-medium hover:underline" style={{
                          color: countryFilter === r.country ? "var(--accent)" : "var(--text)",
                        }}>{r.country}</span>
                        <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>{r.students} students</span>
                      </div>
                      <span className="text-sm font-semibold" style={{ color: "var(--text)" }}>{formatMoneyCompact(r.collected_paise, "INR")}</span>
                    </div>
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: "var(--surface-hover)" }}>
                      <div className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${(r.collected_paise / maxCountry) * 100}%`,
                          backgroundColor: CHART_PALETTE[i % CHART_PALETTE.length],
                        }} />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Cities */}
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-widest mb-3" style={{ color: "var(--text-tertiary)" }}>Top cities</div>
            <div className="flex flex-wrap gap-2">
              {filteredCities.slice(0, 10).map((r, i) => (
                <div key={r.city}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs"
                  style={{ borderColor: "var(--border)" }}>
                  <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: CHART_PALETTE[i % CHART_PALETTE.length] }} />
                  <span className="font-medium" style={{ color: "var(--text)" }}>{r.city}</span>
                  <span style={{ color: "var(--text-tertiary)" }}>{r.students}</span>
                  <span className="font-semibold" style={{ color: "var(--text-secondary)" }}>{formatMoneyCompact(r.collected_paise, "INR")}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom row: Payment methods + Fee model */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* How families pay -- donut */}
        <div className="rounded-xl border p-6" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
          <h3 className="font-bold mb-1" style={{ color: "var(--text)" }}>How families pay</h3>
          <p className="text-xs mb-4" style={{ color: "var(--text-secondary)" }}>Payment method breakdown by amount collected</p>
          <div className="flex flex-col sm:flex-row items-center gap-6">
            <div className="shrink-0">
              <PieChart width={180} height={180}>
                <Pie
                  data={methodData}
                  cx={90} cy={90}
                  innerRadius={50} outerRadius={80}
                  dataKey="value"
                  stroke="none"
                  paddingAngle={2}
                >
                  {methodData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value) => formatMoneyCompact(Number(value), "INR")}
                  contentStyle={{ borderRadius: 8, border: "1px solid var(--border)", fontSize: 12, backgroundColor: "var(--surface)", color: "var(--text)" }}
                />
              </PieChart>
            </div>
            <div className="flex-1 w-full space-y-2.5">
              {methodData.map((r) => (
                <div key={r.name} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: r.color }} />
                    <span className="text-sm" style={{ color: "var(--text)" }}>{r.name}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-medium" style={{ color: "var(--text)" }}>
                      {formatMoneyCompact(r.value, "INR")}
                    </span>
                    <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>{r.payments} txn</span>
                    <span className="text-xs font-medium w-10 text-right" style={{ color: "var(--text-secondary)" }}>
                      {totalMethodPaise > 0 ? `${Math.round((r.value / totalMethodPaise) * 100)}%` : "—"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Fee model comparison */}
        <div className="rounded-xl border p-6" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
          <h3 className="font-bold mb-1" style={{ color: "var(--text)" }}>Fee model</h3>
          <p className="text-xs mb-5" style={{ color: "var(--text-secondary)" }}>
            Package (fixed total) vs hourly (pay-as-you-go) comparison
          </p>
          <div className="space-y-5">
            {by_fee_model.map((r, i) => {
              const label = r.fee_model === "package" ? "Package" : "Hourly";
              const desc = r.fee_model === "package" ? "Fixed total fee, paid in installments" : "Billed per session attended";
              const pctCollected = r.total_fee_paise > 0
                ? Math.round((r.collected_paise / r.total_fee_paise) * 100) : 0;
              return (
                <div key={r.fee_model} className="p-4 rounded-lg" style={{ backgroundColor: "var(--surface-hover)" }}>
                  <div className="flex items-center justify-between mb-1">
                    <div>
                      <span className="font-semibold" style={{ color: "var(--text)" }}>{label}</span>
                      <div className="text-[11px] mt-0.5" style={{ color: "var(--text-tertiary)" }}>{desc}</div>
                    </div>
                    <span className="text-lg font-bold" style={{ color: "var(--text)" }}>
                      {formatMoneyCompact(r.collected_paise, "INR")}
                    </span>
                  </div>
                  <div className="h-2 rounded-full overflow-hidden mb-2 mt-3" style={{ backgroundColor: "var(--border)" }}>
                    <div className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${pctCollected}%`,
                        backgroundColor: CHART_PALETTE[i % CHART_PALETTE.length],
                      }} />
                  </div>
                  <div className="flex justify-between text-xs" style={{ color: "var(--text-secondary)" }}>
                    <span>{r.students} students · {r.enrollments} enrollments</span>
                    <span className="font-medium" style={{ color: "var(--text-secondary)" }}>{pctCollected}% collected</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
