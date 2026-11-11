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
  "#3da391", "#5bb8a8", "#7ecdbf", "#a3e0d5",
  "#00DC82", "#4D9EFF", "#FFB020", "#B0B0C0",
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

export default function InsightsPage() {
  const { data, isLoading } = useSWR<InsightsData>("/insights", fetcher);

  if (isLoading || !data) {
    return (
      <div className="p-8">
        <h1 className="text-3xl font-bold mb-1" style={{ color: "var(--text)" }}>Insights</h1>
        <p className="text-sm mb-6" style={{ color: "var(--text-secondary)" }}>Business overview across programs, geography, and collection health.</p>
        <div className="animate-pulse space-y-4">
          {[1, 2, 3].map((i) => <div key={i} className="h-48 rounded-lg" style={{ backgroundColor: "var(--surface)" }} />)}
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
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold" style={{ color: "var(--text)" }}>Insights</h1>
        <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>Business overview across programs, geography, and collection health.</p>
      </div>

      {/* Hero metrics row */}
      <div className="grid grid-cols-5 gap-4 mb-8">
        <div className="col-span-2 rounded-xl border p-6 flex items-center gap-6"
          style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
          <RingGauge rate={collection.collection_rate} size={110} />
          <div>
            <div className="text-sm mb-1" style={{ color: "var(--text-secondary)" }}>Collection health</div>
            <div className="text-xl font-bold" style={{ color: "var(--text)" }}>{formatMoneyCompact(collectedPaise, "INR")}</div>
            <div className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>of {formatMoneyCompact(duePaise, "INR")} billed</div>
            {outstandingPaise > 0 && (
              <div className="text-xs mt-1 font-medium" style={{ color: "var(--danger)" }}>
                {formatMoneyCompact(outstandingPaise, "INR")} outstanding
              </div>
            )}
          </div>
        </div>

        <div className="rounded-xl border p-5 flex flex-col justify-between" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
          <div className="text-xs uppercase tracking-wider font-medium" style={{ color: "var(--text-tertiary)" }}>Students</div>
          <div className="text-3xl font-bold" style={{ color: "var(--text)" }}>{totalStudents}</div>
          <div className="text-xs" style={{ color: "var(--text-secondary)" }}>{totalPrograms} programs</div>
        </div>

        <div className="rounded-xl border p-5 flex flex-col justify-between" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
          <div className="text-xs uppercase tracking-wider font-medium" style={{ color: "var(--text-tertiary)" }}>Installments</div>
          <div className="text-3xl font-bold" style={{ color: "var(--text)" }}>{collection.total_installments}</div>
          {collection.overdue_installments > 0 ? (
            <div className="text-xs font-medium" style={{ color: "var(--danger)" }}>{collection.overdue_installments} overdue</div>
          ) : (
            <div className="text-xs font-medium" style={{ color: "var(--accent)" }}>All on track</div>
          )}
        </div>

        <div className="rounded-xl border p-5 flex flex-col justify-between" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
          <div className="text-xs uppercase tracking-wider font-medium" style={{ color: "var(--text-tertiary)" }}>Avg per student</div>
          <div className="text-3xl font-bold" style={{ color: "var(--text)" }}>
            {totalStudents > 0 ? formatMoneyCompact(Math.round(duePaise / totalStudents), "INR") : "—"}
          </div>
          <div className="text-xs" style={{ color: "var(--text-secondary)" }}>total fee value</div>
        </div>
      </div>

      {/* Monthly trend -- full width */}
      <div className="rounded-xl border p-6 mb-8" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
        <div className="flex items-center justify-between mb-5">
          <div>
            <h3 className="font-bold" style={{ color: "var(--text)" }}>Monthly collections</h3>
            <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>Revenue received per month (matched payments only)</p>
          </div>
          <div className="text-xs" style={{ color: "var(--text-tertiary)" }}>
            {by_month.length} months · {by_month.reduce((s, r) => s + r.payments, 0)} payments
          </div>
        </div>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={monthData} barSize={32}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border-subtle)" />
            <XAxis dataKey="month" tick={{ fontSize: 11, fill: "var(--text-secondary)" }} tickLine={false} axisLine={false} />
            <YAxis tickFormatter={(v) => lakhs(v * 100)} tick={{ fontSize: 11, fill: "var(--text-secondary)" }} tickLine={false} axisLine={false} width={55} />
            <Tooltip
              formatter={(value) => [lakhs(Number(value) * 100), "Collected"]}
              labelStyle={{ fontWeight: 600, color: "var(--text)" }}
              contentStyle={{ borderRadius: 8, border: "1px solid var(--border)", fontSize: 13, backgroundColor: "var(--surface)", color: "var(--text)" }}
            />
            <Bar dataKey="amount" radius={[4, 4, 0, 0]}>
              {monthData.map((_, i) => (
                <Cell key={i} fill={i === monthData.length - 1 ? "var(--accent)" : "#3da391"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Programs + Geography -- side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* Revenue by program */}
        <div className="rounded-xl border p-6" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
          <h3 className="font-bold mb-1" style={{ color: "var(--text)" }}>Revenue by program</h3>
          <p className="text-xs mb-5" style={{ color: "var(--text-secondary)" }}>Fee collection across all programs</p>
          <div className="space-y-4">
            {by_program.map((r, i) => {
              const pctCollected = r.total_fee_paise > 0 ? Math.round((r.collected_paise / r.total_fee_paise) * 100) : 0;
              const barMax = Math.max(...by_program.map((p) => p.total_fee_paise), 1);
              return (
                <div key={r.program}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-sm font-medium" style={{ color: "var(--text)" }}>{r.program}</span>
                    <div className="flex items-center gap-3">
                      <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>{r.students} students</span>
                      <span className="text-sm font-semibold" style={{ color: "var(--accent)" }}>
                        {formatMoneyCompact(r.collected_paise, "INR")}
                      </span>
                    </div>
                  </div>
                  <div className="relative h-2.5 rounded-full overflow-hidden" style={{ backgroundColor: "var(--surface-hover)" }}>
                    {/* Total billed (background) */}
                    <div className="absolute inset-y-0 left-0 rounded-full"
                      style={{ width: `${(r.total_fee_paise / barMax) * 100}%`, backgroundColor: "var(--border)" }} />
                    {/* Collected (foreground) */}
                    <div className="absolute inset-y-0 left-0 rounded-full transition-all duration-500"
                      style={{
                        width: `${(r.collected_paise / barMax) * 100}%`,
                        backgroundColor: TEAL_PALETTE[i % TEAL_PALETTE.length],
                      }} />
                  </div>
                  <div className="flex justify-between mt-1">
                    <span className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
                      {formatMoneyCompact(r.collected_paise, "INR")} of {formatMoneyCompact(r.total_fee_paise, "INR")}
                    </span>
                    <span className="text-[11px] font-medium" style={{
                      color: pctCollected >= 80 ? "var(--accent)" : pctCollected >= 50 ? "var(--warning)" : "var(--danger)",
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
        <div className="rounded-xl border p-6" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
          <h3 className="font-bold mb-1" style={{ color: "var(--text)" }}>Revenue by geography</h3>
          <p className="text-xs mb-5" style={{ color: "var(--text-secondary)" }}>Where students and revenue come from</p>

          {/* Countries */}
          <div className="mb-6">
            <div className="text-[10px] font-semibold uppercase tracking-widest mb-3" style={{ color: "var(--text-tertiary)" }}>By country</div>
            <div className="space-y-3">
              {by_country.map((r, i) => {
                const maxCountry = Math.max(...by_country.map((c) => c.collected_paise), 1);
                return (
                  <div key={r.country}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: TEAL_PALETTE[i % TEAL_PALETTE.length] }} />
                        <span className="text-sm font-medium" style={{ color: "var(--text)" }}>{r.country}</span>
                        <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>{r.students}</span>
                      </div>
                      <span className="text-sm font-semibold" style={{ color: "var(--text)" }}>{formatMoneyCompact(r.collected_paise, "INR")}</span>
                    </div>
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: "var(--surface-hover)" }}>
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
            <div className="text-[10px] font-semibold uppercase tracking-widest mb-3" style={{ color: "var(--text-tertiary)" }}>Top cities</div>
            <div className="flex flex-wrap gap-2">
              {by_city.map((r, i) => (
                <div key={r.city}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs"
                  style={{ borderColor: "var(--border)" }}>
                  <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: TEAL_PALETTE[i % TEAL_PALETTE.length] }} />
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
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* How families pay -- donut */}
        <div className="lg:col-span-3 rounded-xl border p-6" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
          <h3 className="font-bold mb-1" style={{ color: "var(--text)" }}>How families pay</h3>
          <p className="text-xs mb-4" style={{ color: "var(--text-secondary)" }}>Payment method breakdown</p>
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
                  contentStyle={{ borderRadius: 8, border: "1px solid var(--border)", fontSize: 12, backgroundColor: "var(--surface)", color: "var(--text)" }}
                />
              </PieChart>
            </div>
            <div className="flex-1 space-y-2.5">
              {methodData.map((r) => (
                <div key={r.name} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: r.color }} />
                    <span className="text-sm" style={{ color: "var(--text)" }}>{r.name}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>{r.payments} txn</span>
                    <span className="text-sm font-medium w-16 text-right" style={{ color: "var(--text)" }}>
                      {totalMethodPaise > 0 ? `${Math.round((r.value / totalMethodPaise) * 100)}%` : "—"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Fee model comparison */}
        <div className="lg:col-span-2 rounded-xl border p-6" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
          <h3 className="font-bold mb-1" style={{ color: "var(--text)" }}>Fee model</h3>
          <p className="text-xs mb-5" style={{ color: "var(--text-secondary)" }}>Package vs hourly comparison</p>
          <div className="space-y-5">
            {by_fee_model.map((r, i) => {
              const label = r.fee_model === "package" ? "Package" : "Hourly";
              const pctCollected = r.total_fee_paise > 0
                ? Math.round((r.collected_paise / r.total_fee_paise) * 100) : 0;
              return (
                <div key={r.fee_model} className="p-4 rounded-lg" style={{ backgroundColor: "var(--surface-hover)" }}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-semibold" style={{ color: "var(--text)" }}>{label}</span>
                    <span className="text-lg font-bold" style={{ color: TEAL_PALETTE[i] }}>
                      {formatMoneyCompact(r.collected_paise, "INR")}
                    </span>
                  </div>
                  <div className="h-2 rounded-full overflow-hidden mb-2" style={{ backgroundColor: "var(--border)" }}>
                    <div className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${pctCollected}%`,
                        backgroundColor: TEAL_PALETTE[i],
                      }} />
                  </div>
                  <div className="flex justify-between text-xs" style={{ color: "var(--text-secondary)" }}>
                    <span>{r.students} students · {r.enrollments} enrollments</span>
                    <span className="font-medium" style={{
                      color: pctCollected >= 80 ? "var(--accent)" : pctCollected >= 50 ? "var(--warning)" : "var(--danger)",
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
