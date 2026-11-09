"use client";

import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from "recharts";
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
    scheduled: w.scheduled_paise,
    likely: w.likely_paise,
  }));

  return (
    <div className="bg-white rounded-lg border p-5" style={{ borderColor: "var(--card-border)" }}>
      <h3 className="font-bold text-gray-900 mb-1">Expected cash, next 6 weeks</h3>
      <p className="text-xs text-gray-500 mb-4">
        From installments already scheduled, adjusted for how late families usually pay
      </p>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={chartData} barGap={2}>
          <XAxis dataKey="week" tick={{ fontSize: 12 }} />
          <YAxis tickFormatter={lakhs} tick={{ fontSize: 11 }} width={55} />
          <Tooltip
            formatter={(value) => lakhs(Number(value))}
            labelStyle={{ fontWeight: 600 }}
          />
          <Legend iconType="square" wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="scheduled" name="Scheduled and likely" fill="#2d6a5e" radius={[3, 3, 0, 0]} />
          <Bar dataKey="likely" name="Less certain" fill="#8fbdb5" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
