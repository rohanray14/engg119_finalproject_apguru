"use client";

import useSWR from "swr";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { formatMoney, formatDateLong, formatDate } from "@/lib/format";
import type { Dashboard, Meta } from "@/lib/types";
import DecisionList from "@/components/decision-list";
import AskPanel from "@/components/ask-panel";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid,
} from "recharts";

function fetcher<T>(path: string) {
  return apiFetch<T>(path);
}

function pctChange(current: number, previous: number): string | null {
  if (previous === 0) return null;
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct === 0) return null;
  return pct > 0 ? `+${pct}%` : `${pct}%`;
}

function lakhs(paise: number): string {
  const amt = paise / 100;
  if (amt >= 1_00_00_000) return `${(amt / 1_00_00_000).toFixed(1)} Cr`;
  if (amt >= 1_00_000) return `${(amt / 1_00_000).toFixed(0)} L`;
  if (amt >= 1000) return `${(amt / 1000).toFixed(0)}K`;
  if (amt === 0) return "0";
  return `${amt.toFixed(0)}`;
}

function weekLabel(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function monthLabel(iso: string): string {
  const [, m] = iso.split("-");
  return ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][parseInt(m) - 1];
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
          <div className="h-8 rounded w-48" style={{ backgroundColor: "var(--surface)" }} />
          <div className="h-32 rounded" style={{ backgroundColor: "var(--surface)" }} />
          <div className="grid grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-20 rounded" style={{ backgroundColor: "var(--surface)" }} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <div className="rounded-xl border p-6" style={{ backgroundColor: "var(--surface)", borderColor: "var(--danger)" }}>
          <h2 className="font-bold" style={{ color: "var(--danger)" }}>Failed to load dashboard</h2>
          <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>{error.message}</p>
        </div>
      </div>
    );
  }

  const overdueInr = dash.overdue.by_currency.find((c) => c.currency === "INR");
  const momChange = pctChange(dash.month.received_paise, dash.month.received_last_month_paise);
  const collectionRate = dash.month.collection_rate_pct;

  // Collection rate % per month — last 12 months
  const rateData = (dash.months ?? []).slice(-12).map((m) => {
    const rate = m.expected_paise > 0 ? Math.round((m.collected_paise / m.expected_paise) * 100) : 0;
    return { month: monthLabel(m.month), rate };
  });

  // Forecast — single bar per week showing what's due
  const forecastData = (dash.forecast ?? []).map((w) => ({
    week: weekLabel(w.week_start),
    due: w.scheduled_paise,
  }));

  const hasOwing = dash.top_owing.length > 0;
  const hasUnmatched = dash.largest_unmatched.length > 0;

  return (
    <div className="p-8">
      {/* -- Header -- */}
      <div className="mb-8">
        <div className="text-sm" style={{ color: "var(--text-secondary)" }}>{formatDateLong(dash.as_of)}</div>
        <h1 className="text-3xl font-bold" style={{ color: "var(--text)" }}>Today</h1>
      </div>

      {/* -- 1. Decisions -- */}
      <div className="mb-8">
        <DecisionList dashboard={dash} />
      </div>

      {/* -- 2. KPI strip in a card -- */}
      <div className="rounded-xl border p-6 mb-8" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
          <div>
            <div className="text-xs uppercase tracking-wider font-medium mb-1" style={{ color: "var(--text-secondary)" }}>
              Received this month
            </div>
            <div className="text-3xl font-bold" style={{ color: "var(--accent)" }}>
              {formatMoney(dash.month.received_paise, "INR")}
            </div>
            {momChange && (
              <div className="text-xs font-medium mt-0.5" style={{ color: "var(--text-tertiary)" }}>
                {momChange} vs last month
              </div>
            )}
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider font-medium mb-1" style={{ color: "var(--text-secondary)" }}>
              Expected this month
            </div>
            <div className="text-3xl font-bold" style={{ color: "var(--text)" }}>
              {formatMoney(dash.month.expected_paise, "INR")}
            </div>
            {collectionRate != null && (
              <div className="text-xs mt-0.5" style={{ color: "var(--text-tertiary)" }}>
                {Math.round(collectionRate)}% collected
              </div>
            )}
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider font-medium mb-1" style={{ color: "var(--text-secondary)" }}>
              Spent this month
            </div>
            <div className="text-3xl font-bold" style={{ color: "var(--text)" }}>
              {formatMoney(dash.month.spent_paise, "INR")}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider font-medium mb-1" style={{ color: "var(--text-secondary)" }}>
              Overdue
            </div>
            <div className="text-3xl font-bold" style={{ color: overdueInr ? "var(--danger)" : "var(--accent)" }}>
              {overdueInr ? formatMoney(overdueInr.amount_paise, "INR") : "\u20B90"}
            </div>
            {overdueInr && overdueInr.count > 0 ? (
              <div className="text-xs mt-0.5" style={{ color: "var(--text-tertiary)" }}>
                {overdueInr.count} installments {"·"} oldest {dash.overdue.oldest_days}d
              </div>
            ) : (
              <div className="text-xs mt-0.5" style={{ color: "var(--accent)" }}>All caught up</div>
            )}
          </div>
        </div>
      </div>

      {/* -- 3. Ask panel -- */}
      <div className="mb-8">
        <AskPanel />
      </div>

      {/* -- 4. Top owing + Unmatched -- */}
      {(hasOwing || hasUnmatched) && (
        <div className={`grid grid-cols-1 ${hasOwing && hasUnmatched ? "lg:grid-cols-2" : ""} gap-6 mb-8`}>
          {hasOwing && (
            <div className="rounded-xl border p-5" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold" style={{ color: "var(--text)" }}>Top families owing</h3>
                <Link href="/reminders" className="text-xs hover:underline" style={{ color: "var(--text)" }}>
                  Reminders
                </Link>
              </div>
              <div className="divide-y" style={{ borderColor: "var(--border-subtle)" }}>
                {dash.top_owing.map((s) => (
                  <Link key={s.student_id} href="/reminders"
                    className="flex items-center justify-between py-2.5 first:pt-0 last:pb-0 -mx-2 px-2 rounded transition-colors block">
                    <div>
                      <div className="text-sm font-medium" style={{ color: "var(--text)" }}>{s.name}</div>
                      <div className="text-xs" style={{ color: "var(--text-tertiary)" }}>due {formatDate(s.earliest_due)}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold" style={{ color: "var(--danger)" }}>
                        {formatMoney(s.owed_paise, s.currency)}
                      </span>
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold"
                        style={{ backgroundColor: "rgba(255, 77, 77, 0.15)", color: "var(--danger)" }}>Due</span>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {hasUnmatched && (
            <div className="rounded-xl border p-5" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold" style={{ color: "var(--text)" }}>Largest unmatched payments</h3>
                <Link href="/review" className="text-xs hover:underline" style={{ color: "var(--text)" }}>
                  Review queue
                </Link>
              </div>
              <div className="divide-y" style={{ borderColor: "var(--border-subtle)" }}>
                {dash.largest_unmatched.map((p) => (
                  <div key={p.id} className="flex items-center justify-between py-2.5 first:pt-0 last:pb-0">
                    <div>
                      <div className="text-sm font-medium" style={{ color: "var(--text)" }}>
                        {p.payer_name || "Unknown payer"}
                      </div>
                      <div className="text-xs" style={{ color: "var(--text-tertiary)" }}>
                        {formatDate(p.date)}{p.method ? ` \u00B7 ${p.method}` : ""}
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
      )}

      {/* -- 5. Charts -- */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Collections vs expected */}
        <div className="lg:col-span-3 rounded-xl border p-5" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
          <div className="flex items-center justify-between mb-1">
            <h3 className="font-bold" style={{ color: "var(--text)" }}>Monthly collection rate</h3>
            <div className="flex items-center gap-3 text-xs" style={{ color: "var(--text-tertiary)" }}>
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: "#4A4A5A" }} /> Expected
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: "var(--accent)" }} /> Collected
              </span>
            </div>
          </div>
          <p className="text-xs mb-4" style={{ color: "var(--text-tertiary)" }}>
            How much we collected vs what was due, last 12 months
          </p>
          {monthsData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={monthsData} barGap={1} barCategoryGap="25%">
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border-subtle)" />
                <XAxis dataKey="month" tick={{ fontSize: 10, fill: "var(--text-tertiary)" }} tickLine={false} axisLine={false} interval={0} />
                <YAxis tickFormatter={(v) => lakhs(v * 100)} tick={{ fontSize: 10, fill: "var(--text-tertiary)" }} tickLine={false} axisLine={false} width={45} tickCount={4} label={{ value: "\u20B9", position: "insideTopLeft", offset: -5, style: { fontSize: 10, fill: "var(--text-tertiary)" } }} />
                <Tooltip
                  formatter={(value) => [lakhs(Number(value) * 100)]}
                  labelStyle={{ fontWeight: 600, color: "var(--text)" }}
                  contentStyle={{ borderRadius: 8, border: "1px solid var(--border)", backgroundColor: "var(--surface)", color: "var(--text)" }}
                />
                <Bar dataKey="expected" name="Expected" fill="#4A4A5A" radius={[3, 3, 0, 0]} />
                <Bar dataKey="collected" name="Collected" fill="var(--accent)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="text-sm py-8 text-center" style={{ color: "var(--text-tertiary)" }}>No data yet</div>
          )}
        </div>

        {/* Cash due forecast — blue accent to differentiate */}
        <div className="lg:col-span-2 rounded-xl border p-5" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
          <h3 className="font-bold mb-1" style={{ color: "var(--text)" }}>Cash due, next 5 weeks</h3>
          <div className="flex items-center gap-3 text-xs mb-4" style={{ color: "var(--text-tertiary)" }}>
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: "#4A4A5A" }} /> Scheduled
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: "var(--info)" }} /> Likely
            </span>
          </div>
          {forecastData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={forecastData} barGap={2}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border-subtle)" />
                <XAxis dataKey="week" tick={{ fontSize: 10, fill: "var(--text-tertiary)" }} tickLine={false} axisLine={false} />
                <YAxis tickFormatter={(v) => lakhs(v)} tick={{ fontSize: 10, fill: "var(--text-tertiary)" }} tickLine={false} axisLine={false} width={45} tickCount={4} label={{ value: "\u20B9", position: "insideTopLeft", offset: -5, style: { fontSize: 10, fill: "var(--text-tertiary)" } }} />
                <Tooltip
                  formatter={(value) => [lakhs(Number(value))]}
                  labelStyle={{ fontWeight: 600, color: "var(--text)" }}
                  contentStyle={{ borderRadius: 8, border: "1px solid var(--border)", backgroundColor: "var(--surface)", color: "var(--text)" }}
                />
                <Bar dataKey="scheduled" name="Scheduled" fill="#4A4A5A" radius={[3, 3, 0, 0]} />
                <Bar dataKey="likely" name="Likely" fill="var(--info)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="text-sm py-8 text-center" style={{ color: "var(--text-tertiary)" }}>No forecast data</div>
          )}
        </div>
      </div>
    </div>
  );
}
