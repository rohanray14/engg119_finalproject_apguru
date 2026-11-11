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
  high: { dot: "var(--danger)", text: "var(--text)" },
  medium: { dot: "var(--warning)", text: "var(--text)" },
  low: { dot: "var(--info)", text: "var(--text-secondary)" },
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
      <h1 className="text-3xl font-bold mb-1" style={{ color: "var(--text)" }}>Risk flags</h1>
      <p className="text-sm mb-6" style={{ color: "var(--text-secondary)" }}>Issues detected automatically — each with a next step.</p>

      {/* Severity counts */}
      {data && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="rounded-xl border p-4" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
            <div className="text-sm" style={{ color: "var(--text-secondary)" }}>Total flags</div>
            <div className="text-2xl font-bold" style={{ color: "var(--text)" }}>{data.counts.high + data.counts.medium + data.counts.low}</div>
          </div>
          <div className="rounded-xl border p-4 cursor-pointer"
            style={{ backgroundColor: "var(--surface)", borderColor: severity === "high" ? "var(--text)" : "var(--border)" }}
            onClick={() => setSeverity(severity === "high" ? "" : "high")}>
            <div className="text-sm" style={{ color: "var(--text-secondary)" }}>High</div>
            <div className="text-2xl font-bold" style={{ color: "var(--text)" }}>{data.counts.high}</div>
            <div className="text-xs" style={{ color: "var(--text-tertiary)" }}>&gt;90 days overdue, duplicates, suspicious</div>
          </div>
          <div className="rounded-xl border p-4 cursor-pointer"
            style={{ backgroundColor: "var(--surface)", borderColor: severity === "medium" ? "var(--text)" : "var(--border)" }}
            onClick={() => setSeverity(severity === "medium" ? "" : "medium")}>
            <div className="text-sm" style={{ color: "var(--text-secondary)" }}>Medium</div>
            <div className="text-2xl font-bold" style={{ color: "var(--text)" }}>{data.counts.medium}</div>
            <div className="text-xs" style={{ color: "var(--text-tertiary)" }}>30–90 days, unmatched, oversized</div>
          </div>
          <div className="rounded-xl border p-4 cursor-pointer"
            style={{ backgroundColor: "var(--surface)", borderColor: severity === "low" ? "var(--text)" : "var(--border)" }}
            onClick={() => setSeverity(severity === "low" ? "" : "low")}>
            <div className="text-sm" style={{ color: "var(--text-secondary)" }}>Low</div>
            <div className="text-2xl font-bold" style={{ color: "var(--text-tertiary)" }}>{data.counts.low}</div>
            <div className="text-xs" style={{ color: "var(--text-tertiary)" }}>Data quality, minor issues</div>
          </div>
        </div>
      )}

      {severity && (
        <div className="flex items-center gap-2 mb-6">
          <span className="text-sm" style={{ color: "var(--text-secondary)" }}>Showing: <span className="font-medium capitalize" style={{ color: "var(--text)" }}>{severity}</span></span>
          <button onClick={() => setSeverity("")} className="text-xs underline" style={{ color: "var(--text-secondary)" }}>Clear</button>
        </div>
      )}

      {isLoading ? (
        <div className="animate-pulse space-y-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-16 rounded" style={{ backgroundColor: "var(--surface)" }} />)}
        </div>
      ) : activeItems.length === 0 ? (
        <div className="rounded-xl border p-8 text-center" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
          <p style={{ color: "var(--text-secondary)" }}>No risk flags.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Overdue: grouped by student */}
          {actionSummary && actionSummary.overdueGroups.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wider mb-3" style={{ color: "var(--text-secondary)" }}>
                Overdue installments — {actionSummary.overdueGroups.length} students
              </h3>
              <div className="space-y-2">
                {actionSummary.overdueGroups.map((g) => (
                  <div key={g.student} className="rounded-xl border p-4" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: g.maxDays > 90 ? "var(--danger)" : "var(--warning)" }} />
                        <div>
                          <span className="font-medium" style={{ color: "var(--text)" }}>{g.student}</span>
                          <span className="ml-2 text-sm" style={{ color: "var(--text-secondary)" }}>
                            {g.flags.length} installment{g.flags.length > 1 ? "s" : ""} · {formatMoney(g.totalPaise, g.currency)}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>{g.maxDays}d overdue</span>
                        <button
                          onClick={() => router.push(`/reminders?student=${encodeURIComponent(g.student)}`)}
                          className="px-3 py-1 text-xs font-medium rounded-md transition"
                          style={{ border: "1px solid var(--border)", color: "var(--text)" }}
                          onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "var(--surface-hover)"}
                          onMouseLeave={(e) => e.currentTarget.style.backgroundColor = ""}
                        >
                          Send reminder
                        </button>
                        <button
                          onClick={() => router.push(`/students?search=${encodeURIComponent(g.student)}`)}
                          className="px-3 py-1 text-xs font-medium rounded-md transition"
                          style={{ border: "1px solid var(--border)", color: "var(--text)" }}
                          onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "var(--surface-hover)"}
                          onMouseLeave={(e) => e.currentTarget.style.backgroundColor = ""}
                        >
                          View student
                        </button>
                      </div>
                    </div>
                    {g.flags.length > 1 && (
                      <details className="mt-2">
                        <summary className="text-xs cursor-pointer" style={{ color: "var(--text-tertiary)" }}>
                          {g.flags.length} installments
                        </summary>
                        <div className="mt-2 space-y-1 pl-5">
                          {g.flags.map((f, i) => {
                            const { ids } = parseEntity(f.entity);
                            return (
                              <div key={i} className="text-sm flex items-center justify-between" style={{ color: "var(--text-secondary)" }}>
                                <span>{f.explanation}</span>
                                {f.amount_paise != null && (
                                  <span className="text-xs ml-2 shrink-0" style={{ color: "var(--text-tertiary)" }}>
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
                <h3 className="text-sm font-semibold uppercase tracking-wider mb-3" style={{ color: "var(--text-secondary)" }}>
                  {categoryLabels[cat] ?? cat.replace(/_/g, " ")} — {flags.length} flag{flags.length > 1 ? "s" : ""}
                </h3>
                <div className="space-y-2">
                  {flags.map((f, i) => {
                    const sev = sevStyle[f.severity] ?? sevStyle.low;
                    const action = actionForCategory(f.category);
                    return (
                      <div key={i} className="rounded-xl border p-4 flex items-center justify-between" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: sev.dot }} />
                          <div className="min-w-0">
                            <div className="text-sm" style={{ color: sev.text }}>{f.explanation}</div>
                            {f.amount_paise != null && (
                              <div className="text-xs mt-0.5" style={{ color: "var(--text-tertiary)" }}>
                                {f.entity} · {formatMoney(f.amount_paise, f.currency)}
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0 ml-3">
                          <button
                            onClick={() => router.push(action.page)}
                            className="px-3 py-1 text-xs font-medium rounded-md transition"
                            style={{ border: "1px solid var(--border)", color: "var(--text)" }}
                            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "var(--surface-hover)"}
                            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = ""}
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
