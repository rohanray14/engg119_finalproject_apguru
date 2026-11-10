"use client";

import { useState } from "react";
import useSWR from "swr";
import { apiFetch } from "@/lib/api";
import { formatMoney } from "@/lib/format";

interface RiskFlag {
  severity: string; category: string; explanation: string;
  entity: string; amount_paise: number | null; currency: string;
}
interface RiskData {
  as_of: string;
  counts: { high: number; medium: number; low: number };
  items: RiskFlag[];
}

function fetcher<T>(path: string) { return apiFetch<T>(path); }

const sevBadge: Record<string, { bg: string; text: string }> = {
  high: { bg: "#fee2e2", text: "#991b1b" },
  medium: { bg: "#fef3c7", text: "#92400e" },
  low: { bg: "#dcfce7", text: "#166534" },
};

export default function RiskPage() {
  const [severity, setSeverity] = useState("");
  const params = severity ? `?severity=${severity}` : "";
  const { data, isLoading } = useSWR<RiskData>(`/risk${params}`, fetcher);

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-1">Risk flags</h1>
      <p className="text-sm text-gray-500 mb-6">Automatically detected issues that may need attention.</p>

      {/* Severity explanation */}
      <div className="bg-white rounded-lg border p-4 mb-6" style={{ borderColor: "var(--card-border)" }}>
        <div className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">How severity is determined</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
          <div className="flex items-start gap-2">
            <span className="px-2 py-0.5 rounded text-xs font-bold uppercase shrink-0"
              style={{ backgroundColor: "#fee2e2", color: "#991b1b" }}>HIGH</span>
            <span className="text-gray-600">Overdue &gt;90 days, unverified large payments (&ge;₹5L), duplicate payments, suspicious payer names</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="px-2 py-0.5 rounded text-xs font-bold uppercase shrink-0"
              style={{ backgroundColor: "#fef3c7", color: "#92400e" }}>MEDIUM</span>
            <span className="text-gray-600">Overdue 30–90 days, payments unmatched &gt;14 days, unusually large payments (&gt;3x typical)</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="px-2 py-0.5 rounded text-xs font-bold uppercase shrink-0"
              style={{ backgroundColor: "#dcfce7", color: "#166534" }}>LOW</span>
            <span className="text-gray-600">Minor inconsistencies or data quality issues worth noting</span>
          </div>
        </div>
      </div>

      {data && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-lg border p-4" style={{ borderColor: "var(--card-border)" }}>
            <div className="text-sm text-gray-500">Total flags</div>
            <div className="text-2xl font-bold">{data.counts.high + data.counts.medium + data.counts.low}</div>
          </div>
          <div className="bg-white rounded-lg border p-4 cursor-pointer hover:ring-2 hover:ring-red-200"
            style={{ borderColor: "var(--card-border)" }}
            onClick={() => setSeverity(severity === "high" ? "" : "high")}>
            <div className="text-sm text-gray-500">High · &gt;90 days</div>
            <div className="text-2xl font-bold text-red-600">{data.counts.high}</div>
          </div>
          <div className="bg-white rounded-lg border p-4 cursor-pointer hover:ring-2 hover:ring-orange-200"
            style={{ borderColor: "var(--card-border)" }}
            onClick={() => setSeverity(severity === "medium" ? "" : "medium")}>
            <div className="text-sm text-gray-500">Medium · 30–90 days</div>
            <div className="text-2xl font-bold text-orange-600">{data.counts.medium}</div>
          </div>
          <div className="bg-white rounded-lg border p-4 cursor-pointer hover:ring-2 hover:ring-green-200"
            style={{ borderColor: "var(--card-border)" }}
            onClick={() => setSeverity(severity === "low" ? "" : "low")}>
            <div className="text-sm text-gray-500">Low</div>
            <div className="text-2xl font-bold text-green-600">{data.counts.low}</div>
          </div>
        </div>
      )}

      <select value={severity} onChange={(e) => setSeverity(e.target.value)}
        className="mb-6 text-sm border border-gray-300 rounded-md px-3 py-2">
        <option value="">All severities</option>
        <option value="high">High</option>
        <option value="medium">Medium</option>
        <option value="low">Low</option>
      </select>

      {isLoading ? (
        <div className="animate-pulse space-y-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-16 bg-gray-200 rounded" />)}
        </div>
      ) : !data || data.items.length === 0 ? (
        <div className="bg-white rounded-lg border p-8 text-center" style={{ borderColor: "var(--card-border)" }}>
          <p className="text-gray-500">No risk flags.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {data.items.map((f, i) => {
            const badge = sevBadge[f.severity] ?? { bg: "#f3f4f6", text: "#374151" };
            return (
              <div key={i} className="bg-white rounded-lg border p-4 flex items-start gap-4" style={{ borderColor: "var(--card-border)" }}>
                <span className="px-2 py-0.5 rounded text-xs font-bold uppercase shrink-0 mt-0.5"
                  style={{ backgroundColor: badge.bg, color: badge.text }}>
                  {f.severity}
                </span>
                <div className="flex-1">
                  <div className="font-medium text-gray-900 capitalize">{f.category.replace(/_/g, " ")}</div>
                  <div className="text-sm text-gray-600 mt-0.5">{f.explanation}</div>
                  {f.amount_paise != null && (
                    <div className="text-xs text-gray-400 mt-1">
                      {f.entity} · {formatMoney(f.amount_paise, f.currency)}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
