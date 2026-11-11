"use client";

import useSWR from "swr";
import { apiFetch } from "@/lib/api";
import { formatMoney, formatMoneyCompact } from "@/lib/format";

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

const METHOD_LABELS: Record<string, string> = {
  neft: "Bank (NEFT)", upi: "UPI", imps: "Bank (IMPS)",
  stripe: "Stripe", payglocal: "PayGlocal", razorpay: "Razorpay",
  cash: "Cash", screenshot: "Screenshot",
  bank: "Bank transfer", gateway: "Gateway",
};

function Bar({ value, max, color }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="w-full bg-gray-100 rounded-full h-2">
      <div className="h-2 rounded-full" style={{ width: `${pct}%`, backgroundColor: color ?? "var(--accent)" }} />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-lg border p-5" style={{ borderColor: "var(--card-border)" }}>
      <h3 className="font-bold text-gray-900 mb-4">{title}</h3>
      {children}
    </div>
  );
}

function pct(n: number, d: number): string {
  if (d <= 0) return "0%";
  return `${Math.round((n / d) * 100)}%`;
}

export default function InsightsPage() {
  const { data, isLoading } = useSWR<InsightsData>("/insights", fetcher);

  if (isLoading || !data) {
    return (
      <div className="p-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-1">Insights</h1>
        <p className="text-sm text-gray-500 mb-6">Business overview across programs, geography, and collection health.</p>
        <div className="animate-pulse space-y-4">
          {[1, 2, 3].map((i) => <div key={i} className="h-48 bg-gray-200 rounded" />)}
        </div>
      </div>
    );
  }

  const { by_program, by_country, by_city, by_fee_model, by_method, by_month, collection } = data;
  const maxProgram = Math.max(...by_program.map((r) => r.collected_paise), 1);
  const maxCountry = Math.max(...by_country.map((r) => r.collected_paise), 1);
  const maxCity = Math.max(...by_city.map((r) => r.collected_paise), 1);
  const maxMonth = Math.max(...by_month.map((r) => r.collected_paise), 1);
  const totalMethodPaise = by_method.reduce((s, r) => s + r.collected_paise, 0);

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-1">Insights</h1>
      <p className="text-sm text-gray-500 mb-6">Business overview across programs, geography, and collection health.</p>

      {/* Collection health summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-lg border p-4" style={{ borderColor: "var(--card-border)" }}>
          <div className="text-xs text-gray-500">Total fees due</div>
          <div className="text-lg font-bold text-gray-900">{formatMoneyCompact(collection.total_due_paise, "INR")}</div>
        </div>
        <div className="bg-white rounded-lg border p-4" style={{ borderColor: "var(--card-border)" }}>
          <div className="text-xs text-gray-500">Collected (in bank)</div>
          <div className="text-lg font-bold" style={{ color: "var(--accent)" }}>{formatMoneyCompact(collection.total_collected_paise, "INR")}</div>
        </div>
        <div className="bg-white rounded-lg border p-4" style={{ borderColor: "var(--card-border)" }}>
          <div className="text-xs text-gray-500">Collection rate</div>
          <div className="text-lg font-bold text-gray-900">{(collection.collection_rate * 100).toFixed(1)}%</div>
          <div className="text-xs text-gray-400">of matched payments only</div>
        </div>
        <div className="bg-white rounded-lg border p-4" style={{ borderColor: "var(--card-border)" }}>
          <div className="text-xs text-gray-500">Installments</div>
          <div className="text-lg font-bold text-gray-900">{collection.total_installments}</div>
          {collection.overdue_installments > 0 && (
            <div className="text-xs text-red-600">{collection.overdue_installments} overdue</div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Revenue by program */}
        <Section title="Revenue by program">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b">
                <th className="pb-2 font-medium">Program</th>
                <th className="pb-2 font-medium text-right">Students</th>
                <th className="pb-2 font-medium text-right">Collected</th>
                <th className="pb-2 font-medium w-24"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {by_program.map((r) => (
                <tr key={r.program}>
                  <td className="py-2 font-medium text-gray-900">{r.program}</td>
                  <td className="py-2 text-right text-gray-600">{r.students}</td>
                  <td className="py-2 text-right">{formatMoneyCompact(r.collected_paise, "INR")}</td>
                  <td className="py-2 pl-3"><Bar value={r.collected_paise} max={maxProgram} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        {/* Revenue by country */}
        <Section title="Revenue by geography">
          <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">By country</h4>
          <table className="w-full text-sm mb-5">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b">
                <th className="pb-2 font-medium">Country</th>
                <th className="pb-2 font-medium text-right">Students</th>
                <th className="pb-2 font-medium text-right">Collected</th>
                <th className="pb-2 font-medium w-24"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {by_country.map((r) => (
                <tr key={r.country}>
                  <td className="py-2 font-medium text-gray-900">{r.country}</td>
                  <td className="py-2 text-right text-gray-600">{r.students}</td>
                  <td className="py-2 text-right">{formatMoneyCompact(r.collected_paise, "INR")}</td>
                  <td className="py-2 pl-3"><Bar value={r.collected_paise} max={maxCountry} /></td>
                </tr>
              ))}
            </tbody>
          </table>

          <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Top cities</h4>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b">
                <th className="pb-2 font-medium">City</th>
                <th className="pb-2 font-medium text-right">Students</th>
                <th className="pb-2 font-medium text-right">Collected</th>
                <th className="pb-2 font-medium w-24"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {by_city.map((r) => (
                <tr key={r.city}>
                  <td className="py-2 font-medium text-gray-900">{r.city}</td>
                  <td className="py-2 text-right text-gray-600">{r.students}</td>
                  <td className="py-2 text-right">{formatMoneyCompact(r.collected_paise, "INR")}</td>
                  <td className="py-2 pl-3"><Bar value={r.collected_paise} max={maxCity} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        {/* Fee model */}
        <Section title="Package vs Hourly">
          <div className="space-y-4">
            {by_fee_model.map((r) => {
              const label = r.fee_model === "package" ? "Package" : "Hourly";
              const collectionRate = r.total_fee_paise > 0
                ? (r.collected_paise / r.total_fee_paise * 100).toFixed(0) : "0";
              return (
                <div key={r.fee_model}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="font-medium text-gray-900">{label}</span>
                    <span className="text-gray-600">{formatMoneyCompact(r.collected_paise, "INR")}</span>
                  </div>
                  <Bar value={r.collected_paise} max={Math.max(...by_fee_model.map((m) => m.collected_paise), 1)} />
                  <div className="flex justify-between text-xs text-gray-400 mt-1">
                    <span>{r.students} students · {r.enrollments} enrollments</span>
                    <span>{collectionRate}% collected</span>
                  </div>
                </div>
              );
            })}
          </div>
        </Section>

        {/* Payment methods */}
        <Section title="How families pay">
          <div className="space-y-3">
            {by_method.map((r) => (
              <div key={r.pay_method}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="font-medium text-gray-900">{METHOD_LABELS[r.pay_method] ?? r.pay_method}</span>
                  <span className="text-gray-600">{pct(r.collected_paise, totalMethodPaise)}</span>
                </div>
                <Bar value={r.collected_paise} max={Math.max(...by_method.map((m) => m.collected_paise), 1)} />
                <div className="text-xs text-gray-400 mt-0.5">
                  {r.payments} payments · {formatMoneyCompact(r.collected_paise, "INR")}
                </div>
              </div>
            ))}
          </div>
        </Section>

        {/* Monthly trend */}
        <Section title="Monthly collections">
          <div className="space-y-2">
            {by_month.map((r) => {
              const [y, m] = r.month.split("-");
              const label = `${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][parseInt(m) - 1]} ${y}`;
              return (
                <div key={r.month}>
                  <div className="flex justify-between text-xs mb-0.5">
                    <span className="text-gray-600">{label}</span>
                    <span className="font-medium text-gray-900">{formatMoneyCompact(r.collected_paise, "INR")}</span>
                  </div>
                  <Bar value={r.collected_paise} max={maxMonth} />
                </div>
              );
            })}
          </div>
        </Section>
      </div>
    </div>
  );
}
