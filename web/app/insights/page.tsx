"use client";

import useSWR from "swr";
import { apiFetch } from "@/lib/api";
import { formatMoney, formatMoneyCompact } from "@/lib/format";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Cell, PieChart, Pie,
} from "recharts";

interface ProgramRow { program: string; students: number; enrollments: number; total_fee_paise: number; collected_paise: number }
interface CountryRow { country: string; students: number; total_fee_paise: number; collected_paise: number }
interface CityRow { city: string; students: number; collected_paise: number }
interface FeeModelRow { fee_model: string; students: number; enrollments: number; total_fee_paise: number; collected_paise: number }
interface MethodRow { pay_method: string; payments: number; collected_paise: number }
interface MonthRow { month: string; payments: number; collected_paise: number }
interface Collection { total_due_paise: number; total_collected_paise: number; collection_rate: number; overdue_installments: number; total_installments: number }

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

const TEAL_PALETTE = [
  "#1a4a42", "#1f5e54", "#247266", "#2d8a7a",
  "#3da391", "#5bb8a8", "#7ecdbf", "#a3e0d5",
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
          stroke="#f0f0f0" strokeWidth={10} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke="var(--accent)" strokeWidth={10}
          strokeDasharray={circ} strokeDashoffset={offset}
          strokeLinecap="round" className="transition-all duration-700" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold text-gray-900">{pct}%</span>
        <span className="text-[10px] text-gray-400 uppercase tracking-wider">collected</span>
      </div>
    </div>
  );
}

export default function InsightsPage() {
  const { data, isLoading } = useSWR<InsightsData>("/insights", fetcher);

  if (isLoading || !data) {
    return (
      <div className="p-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-1">Insights</h1>
        <p className="text-sm text-gray-500 mb-6">Business overview across programs, geography, and collection health.</p>
        <div className="animate-pulse space-y-4">
          {[1, 2, 3].map((i) => <div key={i} className="h-48 bg-gray-200 rounded-lg" />)}
        </div>
      </div>
    );
  }

  const { by_program, by_country, by_city, by_fee_model, by_method, by_month, collection } = data;

  // Derived data
  const totalStudents = by_country.reduce((s, r) => s + r.students, 0);
  const totalPrograms = by_program.length;
  const collectedPaise = collection.total_collected_paise;
  const duePaise = collection.total_due_paise;
  const outstandingPaise = duePaise - collectedPaise;

  // Chart data
  const monthData = by_month.map((r) => ({
    month: monthLabel(r.month),
    amount: r.collected_paise / 100,
    payments: r.payments,
    raw: r.collected_paise,
  }));

  const methodData = by_method.map((r, i) => ({
    name: METHOD_LABELS[r.pay_method] ?? r.pay_method,
    value: r.collected_paise,
    payments: r.payments,
    color: TEAL_PALETTE[i % TEAL_PALETTE.length],
  }));
  const totalMethodPaise = by_method.reduce((s, r) => s + r.collected_paise, 0);

  return (
    <div className="p-8 max-w-7xl">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Insights</h1>
        <p className="text-sm text-gray-500 mt-1">Business overview across programs, geography, and collection health.</p>
      </div>

      {/* Hero metrics row */}
      <div className="grid grid-cols-5 gap-4 mb-8">
        <div className="col-span-2 bg-white rounded-xl border p-6 flex items-center gap-6"
          style={{ borderColor: "var(--card-border)" }}>
          <RingGauge rate={collection.collection_rate} size={110} />
          <div>
            <div className="text-sm text-gray-500 mb-1">Collection health</div>
            <div className="text-xl font-bold text-gray-900">{formatMoneyCompact(collectedPaise, "INR")}</div>
            <div className="text-xs text-gray-500 mt-0.5">of {formatMoneyCompact(duePaise, "INR")} billed</div>
            {outstandingPaise > 0 && (
              <div className="text-xs text-red-600 mt-1 font-medium">
                {formatMoneyCompact(outstandingPaise, "INR")} outstanding
              </div>
            )}
          </div>
        </div>

        <div className="bg-white rounded-xl border p-5 flex flex-col justify-between" style={{ borderColor: "var(--card-border)" }}>
          <div className="text-xs text-gray-400 uppercase tracking-wider font-medium">Students</div>
          <div className="text-3xl font-bold text-gray-900">{totalStudents}</div>
          <div className="text-xs text-gray-500">{totalPrograms} programs</div>
        </div>

        <div className="bg-white rounded-xl border p-5 flex flex-col justify-between" style={{ borderColor: "var(--card-border)" }}>
          <div className="text-xs text-gray-400 uppercase tracking-wider font-medium">Installments</div>
          <div className="text-3xl font-bold text-gray-900">{collection.total_installments}</div>
          {collection.overdue_installments > 0 ? (
            <div className="text-xs text-red-600 font-medium">{collection.overdue_installments} overdue</div>
          ) : (
            <div className="text-xs text-green-600 font-medium">All on track</div>
          )}
        </div>

        <div className="bg-white rounded-xl border p-5 flex flex-col justify-between" style={{ borderColor: "var(--card-border)" }}>
          <div className="text-xs text-gray-400 uppercase tracking-wider font-medium">Avg per student</div>
          <div className="text-3xl font-bold text-gray-900">
            {totalStudents > 0 ? formatMoneyCompact(Math.round(duePaise / totalStudents), "INR") : "—"}
          </div>
          <div className="text-xs text-gray-500">total fee value</div>
        </div>
      </div>

      {/* Monthly trend — full width */}
      <div className="bg-white rounded-xl border p-6 mb-8" style={{ borderColor: "var(--card-border)" }}>
        <div className="flex items-center justify-between mb-5">
          <div>
            <h3 className="font-bold text-gray-900">Monthly collections</h3>
            <p className="text-xs text-gray-500 mt-0.5">Revenue received per month (matched payments only)</p>
          </div>
          <div className="text-xs text-gray-400">
            {by_month.length} months · {by_month.reduce((s, r) => s + r.payments, 0)} payments
          </div>
        </div>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={monthData} barSize={32}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
            <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#9ca3af" }} tickLine={false} axisLine={false} />
            <YAxis tickFormatter={(v) => lakhs(v * 100)} tick={{ fontSize: 11, fill: "#9ca3af" }} tickLine={false} axisLine={false} width={55} />
            <Tooltip
              formatter={(value) => [lakhs(Number(value) * 100), "Collected"]}
              labelStyle={{ fontWeight: 600 }}
              contentStyle={{ borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 13 }}
            />
            <Bar dataKey="amount" radius={[4, 4, 0, 0]}>
              {monthData.map((_, i) => (
                <Cell key={i} fill={i === monthData.length - 1 ? "var(--accent)" : "#c7ddd8"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Programs + Geography — side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* Revenue by program */}
        <div className="bg-white rounded-xl border p-6" style={{ borderColor: "var(--card-border)" }}>
          <h3 className="font-bold text-gray-900 mb-1">Revenue by program</h3>
          <p className="text-xs text-gray-500 mb-5">Fee collection across all programs</p>
          <div className="space-y-4">
            {by_program.map((r, i) => {
              const pctCollected = r.total_fee_paise > 0 ? Math.round((r.collected_paise / r.total_fee_paise) * 100) : 0;
              const barMax = Math.max(...by_program.map((p) => p.total_fee_paise), 1);
              return (
                <div key={r.program}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-sm font-medium text-gray-900">{r.program}</span>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-gray-400">{r.students} students</span>
                      <span className="text-sm font-semibold" style={{ color: "var(--accent)" }}>
                        {formatMoneyCompact(r.collected_paise, "INR")}
                      </span>
                    </div>
                  </div>
                  <div className="relative h-2.5 bg-gray-100 rounded-full overflow-hidden">
                    {/* Total billed (background) */}
                    <div className="absolute inset-y-0 left-0 rounded-full bg-gray-200"
                      style={{ width: `${(r.total_fee_paise / barMax) * 100}%` }} />
                    {/* Collected (foreground) */}
                    <div className="absolute inset-y-0 left-0 rounded-full transition-all duration-500"
                      style={{
                        width: `${(r.collected_paise / barMax) * 100}%`,
                        backgroundColor: TEAL_PALETTE[i % TEAL_PALETTE.length],
                      }} />
                  </div>
                  <div className="flex justify-between mt-1">
                    <span className="text-[11px] text-gray-400">
                      {formatMoneyCompact(r.collected_paise, "INR")} of {formatMoneyCompact(r.total_fee_paise, "INR")}
                    </span>
                    <span className="text-[11px] font-medium" style={{
                      color: pctCollected >= 80 ? "#16a34a" : pctCollected >= 50 ? "#d97706" : "#dc2626",
                    }}>
                      {pctCollected}% collected
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Geography */}
        <div className="bg-white rounded-xl border p-6" style={{ borderColor: "var(--card-border)" }}>
          <h3 className="font-bold text-gray-900 mb-1">Revenue by geography</h3>
          <p className="text-xs text-gray-500 mb-5">Where students and revenue come from</p>

          {/* Countries */}
          <div className="mb-6">
            <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-3">By country</div>
            <div className="space-y-3">
              {by_country.map((r, i) => {
                const maxCountry = Math.max(...by_country.map((c) => c.collected_paise), 1);
                return (
                  <div key={r.country}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: TEAL_PALETTE[i % TEAL_PALETTE.length] }} />
                        <span className="text-sm font-medium text-gray-900">{r.country}</span>
                        <span className="text-xs text-gray-400">{r.students}</span>
                      </div>
                      <span className="text-sm font-semibold text-gray-700">{formatMoneyCompact(r.collected_paise, "INR")}</span>
                    </div>
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${(r.collected_paise / maxCountry) * 100}%`,
                          backgroundColor: TEAL_PALETTE[i % TEAL_PALETTE.length],
                        }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Cities */}
          <div>
            <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-3">Top cities</div>
            <div className="flex flex-wrap gap-2">
              {by_city.map((r, i) => (
                <div key={r.city}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs"
                  style={{ borderColor: "var(--card-border)" }}>
                  <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: TEAL_PALETTE[i % TEAL_PALETTE.length] }} />
                  <span className="font-medium text-gray-800">{r.city}</span>
                  <span className="text-gray-400">{r.students}</span>
                  <span className="font-semibold text-gray-600">{formatMoneyCompact(r.collected_paise, "INR")}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom row: Payment methods + Fee model */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* How families pay — donut */}
        <div className="lg:col-span-3 bg-white rounded-xl border p-6" style={{ borderColor: "var(--card-border)" }}>
          <h3 className="font-bold text-gray-900 mb-1">How families pay</h3>
          <p className="text-xs text-gray-500 mb-4">Payment method breakdown</p>
          <div className="flex items-center gap-8">
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
                  contentStyle={{ borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 12 }}
                />
              </PieChart>
            </div>
            <div className="flex-1 space-y-2.5">
              {methodData.map((r) => (
                <div key={r.name} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: r.color }} />
                    <span className="text-sm text-gray-800">{r.name}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-400">{r.payments} txn</span>
                    <span className="text-sm font-medium text-gray-900 w-16 text-right">
                      {totalMethodPaise > 0 ? `${Math.round((r.value / totalMethodPaise) * 100)}%` : "—"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Fee model comparison */}
        <div className="lg:col-span-2 bg-white rounded-xl border p-6" style={{ borderColor: "var(--card-border)" }}>
          <h3 className="font-bold text-gray-900 mb-1">Fee model</h3>
          <p className="text-xs text-gray-500 mb-5">Package vs hourly comparison</p>
          <div className="space-y-5">
            {by_fee_model.map((r, i) => {
              const label = r.fee_model === "package" ? "Package" : "Hourly";
              const pctCollected = r.total_fee_paise > 0
                ? Math.round((r.collected_paise / r.total_fee_paise) * 100) : 0;
              return (
                <div key={r.fee_model} className="p-4 rounded-lg bg-gray-50">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-semibold text-gray-900">{label}</span>
                    <span className="text-lg font-bold" style={{ color: TEAL_PALETTE[i] }}>
                      {formatMoneyCompact(r.collected_paise, "INR")}
                    </span>
                  </div>
                  <div className="h-2 bg-gray-200 rounded-full overflow-hidden mb-2">
                    <div className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${pctCollected}%`,
                        backgroundColor: TEAL_PALETTE[i],
                      }} />
                  </div>
                  <div className="flex justify-between text-xs text-gray-500">
                    <span>{r.students} students · {r.enrollments} enrollments</span>
                    <span className="font-medium" style={{
                      color: pctCollected >= 80 ? "#16a34a" : pctCollected >= 50 ? "#d97706" : "#dc2626",
                    }}>{pctCollected}% collected</span>
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
