"use client";

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import type { ForecastWeek } from "@/lib/types";

function weekLabel(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function lakhs(paise: number): string {
  const amt = paise / 100;
  if (amt >= 100000) return `₹${(amt / 100000).toFixed(0)} L`;
  return `₹${(amt / 1000).toFixed(0)}K`;
}

export default function ForecastChart({ data }: { data: ForecastWeek[] }) {
  const chartData = data.map((w) => ({
    week: weekLabel(w.week_start),
    expected: w.scheduled_paise,
  }));

  return (
    <div className="rounded-lg border p-5" style={{ backgroundColor: "var(--surface)", borderColor: "var(--card-border)" }}>
      <h3 className="font-bold mb-1" style={{ color: "var(--text)" }}>Expected cash, next 6 weeks</h3>
      <p className="text-xs mb-4" style={{ color: "var(--text-secondary)" }}>
        From installments already scheduled
      </p>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={chartData} barGap={2}>
          <XAxis dataKey="week" tick={{ fontSize: 12 }} />
          <YAxis tickFormatter={lakhs} tick={{ fontSize: 11 }} width={55} />
          <Tooltip
            formatter={(value) => lakhs(Number(value))}
            labelStyle={{ fontWeight: 600 }}
          />
          <Bar dataKey="expected" name="Expected" fill="var(--accent)" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
