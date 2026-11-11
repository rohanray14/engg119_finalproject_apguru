"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { apiFetch } from "@/lib/api";
import { formatMoney, formatDate } from "@/lib/format";

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

// Parse entity string into type + ids
function parseEntity(entity: string): { type: string; ids: number[] } {
  const [type, rest] = entity.split(":");
  if (!rest) return { type, ids: [] };
  return { type, ids: rest.split(",").map(Number).filter((n) => !isNaN(n)) };
}

// Extract student name from overdue explanation
function studentName(explanation: string): string {
  const match = explanation.match(/^(.+?)'s installment/);
  return match ? match[1] : "Unknown";
}

// Group overdue installments by student
interface OverdueGroup {
  student: string;
  flags: RiskFlag[];
  totalPaise: number;
  currency: string;
  maxDays: number;
}

function groupOverdue(flags: RiskFlag[]): OverdueGroup[] {
  const map = new Map<string, OverdueGroup>();
  for (const f of flags) {
    if (f.category !== "overdue_installment") continue;
    const name = studentName(f.explanation);
    const daysMatch = f.explanation.match(/is (\d+) days overdue/);
    const days = daysMatch ? Number(daysMatch[1]) : 0;
    const group = map.get(name) ?? { student: name, flags: [], totalPaise: 0, currency: f.currency, maxDays: 0 };
    group.flags.push(f);
    group.totalPaise += f.amount_paise ?? 0;
    group.maxDays = Math.max(group.maxDays, days);
    map.set(name, group);
  }
  return [...map.values()].sort((a, b) => b.totalPaise - a.totalPaise);
}

// Action config per category
function actionForCategory(category: string): { label: string; page: string; icon: string } {
  switch (category) {
    case "overdue_installment":
      return { label: "Send reminder", page: "/reminders", icon: "Send" };
    case "unmatched_old":
      return { label: "Review match", page: "/match-review", icon: "Link" };
    case "duplicate_payment":
      return { label: "View payments", page: "/payments", icon: "Search" };
    case "unconfirmed_large":
      return { label: "Verify payment", page: "/payments", icon: "Check" };
    case "suspicious_payer":
      return { label: "Investigate", page: "/payments", icon: "Flag" };
    case "oversized_payment":
      return { label: "View payment", page: "/payments", icon: "Eye" };
    default:
      return { label: "View", page: "/", icon: "Eye" };
  }
}

const sevStyle: Record<string, { dot: string; text: string }> = {
  high: { dot: "bg-gray-900", text: "text-gray-900" },
  medium: { dot: "bg-gray-400", text: "text-gray-600" },
  low: { dot: "bg-gray-300", text: "text-gray-400" },
};

export default function RiskPage() {
  const router = useRouter();
  const [severity, setSeverity] = useState("");
  const params = severity ? `?severity=${severity}` : "";
  const { data, isLoading } = useSWR<RiskData>(`/risk${params}`, fetcher);

  const activeItems = useMemo(() => {
    if (!data) return [];
    return data.items;
  }, [data]);

  // Compute action summary
  const actionSummary = useMemo(() => {
    const overdue = activeItems.filter((f) => f.category === "overdue_installment");
    const unmatched = activeItems.filter((f) => f.category === "unmatched_old");
    const duplicates = activeItems.filter((f) => f.category === "duplicate_payment");
    const suspicious = activeItems.filter((f) =>
      f.category === "unconfirmed_large" || f.category === "suspicious_payer"
    );
    const groups = groupOverdue(overdue);
    return { overdue, unmatched, duplicates, suspicious, overdueGroups: groups };
  }, [activeItems]);

  const nonOverdueFlags = useMemo(() => {
    return activeItems.filter((f) => f.category !== "overdue_installment");
  }, [activeItems]);

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-1">Risk flags</h1>
      <p className="text-sm text-gray-500 mb-6">Issues detected automatically — each with a next step.</p>

      {/* Severity counts */}
      {data && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-lg border p-4" style={{ borderColor: "var(--card-border)" }}>
            <div className="text-sm text-gray-500">Total flags</div>
            <div className="text-2xl font-bold">{data.counts.high + data.counts.medium + data.counts.low}</div>
          </div>
          <div className="bg-white rounded-lg border p-4 cursor-pointer hover:ring-1 hover:ring-gray-300"
            style={{ borderColor: severity === "high" ? "#1a2332" : "var(--card-border)" }}
            onClick={() => setSeverity(severity === "high" ? "" : "high")}>
            <div className="text-sm text-gray-500">High</div>
            <div className="text-2xl font-bold text-gray-900">{data.counts.high}</div>
            <div className="text-xs text-gray-400">&gt;90 days overdue, duplicates, suspicious</div>
          </div>
          <div className="bg-white rounded-lg border p-4 cursor-pointer hover:ring-1 hover:ring-gray-300"
            style={{ borderColor: severity === "medium" ? "#1a2332" : "var(--card-border)" }}
            onClick={() => setSeverity(severity === "medium" ? "" : "medium")}>
            <div className="text-sm text-gray-500">Medium</div>
            <div className="text-2xl font-bold text-gray-600">{data.counts.medium}</div>
            <div className="text-xs text-gray-400">30–90 days, unmatched, oversized</div>
          </div>
          <div className="bg-white rounded-lg border p-4 cursor-pointer hover:ring-1 hover:ring-gray-300"
            style={{ borderColor: severity === "low" ? "#1a2332" : "var(--card-border)" }}
            onClick={() => setSeverity(severity === "low" ? "" : "low")}>
            <div className="text-sm text-gray-500">Low</div>
            <div className="text-2xl font-bold text-gray-400">{data.counts.low}</div>
            <div className="text-xs text-gray-400">Data quality, minor issues</div>
          </div>
        </div>
      )}

      {severity && (
        <div className="flex items-center gap-2 mb-6">
          <span className="text-sm text-gray-500">Showing: <span className="font-medium text-gray-900 capitalize">{severity}</span></span>
          <button onClick={() => setSeverity("")} className="text-xs text-gray-500 hover:text-gray-700 underline">Clear</button>
        </div>
      )}

      {isLoading ? (
        <div className="animate-pulse space-y-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-16 bg-gray-200 rounded" />)}
        </div>
      ) : activeItems.length === 0 ? (
        <div className="bg-white rounded-lg border p-8 text-center" style={{ borderColor: "var(--card-border)" }}>
          <p className="text-gray-500">No risk flags.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Overdue: grouped by student */}
          {actionSummary && actionSummary.overdueGroups.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
                Overdue installments — {actionSummary.overdueGroups.length} students
              </h3>
              <div className="space-y-2">
                {actionSummary.overdueGroups.map((g) => (
                  <div key={g.student} className="bg-white rounded-lg border p-4" style={{ borderColor: "var(--card-border)" }}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className={`w-2 h-2 rounded-full ${g.maxDays > 90 ? "bg-gray-900" : "bg-gray-400"}`} />
                        <div>
                          <span className="font-medium text-gray-900">{g.student}</span>
                          <span className="text-gray-500 ml-2 text-sm">
                            {g.flags.length} installment{g.flags.length > 1 ? "s" : ""} · {formatMoney(g.totalPaise, g.currency)}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-400">{g.maxDays}d overdue</span>
                        <button
                          onClick={() => router.push(`/reminders?student=${encodeURIComponent(g.student)}`)}
                          className="px-3 py-1 text-xs font-medium rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 transition"
                        >
                          Send reminder
                        </button>
                        <button
                          onClick={() => router.push(`/students?search=${encodeURIComponent(g.student)}`)}
                          className="px-3 py-1 text-xs font-medium rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 transition"
                        >
                          View student
                        </button>
                      </div>
                    </div>
                    {g.flags.length > 1 && (
                      <details className="mt-2">
                        <summary className="text-xs text-gray-400 cursor-pointer">
                          {g.flags.length} installments
                        </summary>
                        <div className="mt-2 space-y-1 pl-5">
                          {g.flags.map((f, i) => {
                            const { ids } = parseEntity(f.entity);
                            return (
                              <div key={i} className="text-sm text-gray-600 flex items-center justify-between">
                                <span>{f.explanation}</span>
                                {f.amount_paise != null && (
                                  <span className="text-xs text-gray-400 ml-2 shrink-0">
                                    {formatMoney(f.amount_paise, f.currency)}
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </details>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Non-overdue flags by category */}
          {(() => {
            const byCategory = new Map<string, RiskFlag[]>();
            for (const f of nonOverdueFlags) {
              const list = byCategory.get(f.category) ?? [];
              list.push(f);
              byCategory.set(f.category, list);
            }
            const categoryLabels: Record<string, string> = {
              unmatched_old: "Unmatched payments",
              duplicate_payment: "Possible duplicates",
              unconfirmed_large: "Unverified large payments",
              suspicious_payer: "Suspicious payer names",
              oversized_payment: "Unusually large payments",
            };
            return [...byCategory.entries()].map(([cat, flags]) => (
              <div key={cat}>
                <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
                  {categoryLabels[cat] ?? cat.replace(/_/g, " ")} — {flags.length} flag{flags.length > 1 ? "s" : ""}
                </h3>
                <div className="space-y-2">
                  {flags.map((f, i) => {
                    const sev = sevStyle[f.severity] ?? sevStyle.low;
                    const action = actionForCategory(f.category);
                    return (
                      <div key={i} className="bg-white rounded-lg border p-4 flex items-center justify-between" style={{ borderColor: "var(--card-border)" }}>
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <div className={`w-2 h-2 rounded-full shrink-0 ${sev.dot}`} />
                          <div className="min-w-0">
                            <div className={`text-sm ${sev.text}`}>{f.explanation}</div>
                            {f.amount_paise != null && (
                              <div className="text-xs text-gray-400 mt-0.5">
                                {f.entity} · {formatMoney(f.amount_paise, f.currency)}
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0 ml-3">
                          <button
                            onClick={() => router.push(action.page)}
                            className="px-3 py-1 text-xs font-medium rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 transition"
                          >
                            {action.label}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ));
          })()}
        </div>
      )}
    </div>
  );
}
