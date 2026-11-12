"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
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

function parseEntity(entity: string): { type: string; ids: number[] } {
  const [type, rest] = entity.split(":");
  if (!rest) return { type, ids: [] };
  return { type, ids: rest.split(",").map(Number).filter((n) => !isNaN(n)) };
}

function studentName(explanation: string): string {
  const match = explanation.match(/^(.+?)'s installment/);
  return match ? match[1] : "Unknown";
}

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

function actionForFlag(flag: RiskFlag): { label: string; href: string } {
  const { type, ids } = parseEntity(flag.entity);
  const id = ids[0];
  switch (flag.category) {
    case "overdue_installment":
      return { label: "Send reminder", href: "/reminders" };
    case "unmatched_old":
      return { label: "Review match", href: id ? `/review?id=${id}` : "/review" };
    case "duplicate_payment":
      return { label: "View payments", href: id && type === "payment" ? `/payments?search=${id}` : "/payments" };
    case "unconfirmed_large":
      return { label: "Verify payment", href: `/payments?confirmation=screenshot_only` };
    case "suspicious_payer":
      return { label: "Investigate", href: id && type === "payment" ? `/payments?search=${id}` : "/payments" };
    case "oversized_payment":
      return { label: "View payment", href: id && type === "payment" ? `/payments?search=${id}` : "/payments" };
    default:
      return { label: "View", href: "/" };
  }
}

const sevDot: Record<string, string> = {
  high: "var(--danger)",
  medium: "var(--warning)",
  low: "var(--info)",
};

const categoryLabels: Record<string, string> = {
  overdue_installment: "Overdue installments",
  unmatched_old: "Unmatched payments",
  duplicate_payment: "Possible duplicates",
  unconfirmed_large: "Unverified large payments",
  suspicious_payer: "Suspicious payer names",
  oversized_payment: "Unusually large payments",
};

// Strip leading student name from overdue explanation for grouped display
function stripName(explanation: string): string {
  return explanation.replace(/^.+?'s installment of /, "").replace(/^(\S+)\s/, "$1 · ");
}

type SortMode = "amount" | "age" | "default";
const COLLAPSED_LIMIT = 8;

export default function RiskPage() {
  // Fetch all flags (no server-side severity filter)
  const { data, isLoading } = useSWR<RiskData>("/risk", fetcher);

  const [severity, setSeverity] = useState("");
  const [category, setCategory] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("default");
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());

  function dismiss(key: string) {
    setDismissed((prev) => new Set(prev).add(key));
  }

  function flagKey(f: RiskFlag, i: number): string {
    return `${f.category}:${f.entity}:${i}`;
  }

  function toggleExpand(section: string) {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  }

  // Client-side filtering
  const activeItems = useMemo(() => {
    if (!data) return [];
    let items = data.items;
    if (severity) items = items.filter((f) => f.severity === severity);
    if (category) items = items.filter((f) => f.category === category);
    return items;
  }, [data, severity, category]);

  // Remove dismissed
  const visibleItems = useMemo(() => {
    return activeItems.filter((f, i) => !dismissed.has(flagKey(f, i)));
  }, [activeItems, dismissed]);

  // Sort helper
  function sortFlags(flags: RiskFlag[]): RiskFlag[] {
    if (sortMode === "amount") {
      return [...flags].sort((a, b) => (b.amount_paise ?? 0) - (a.amount_paise ?? 0));
    }
    if (sortMode === "age") {
      const getDays = (f: RiskFlag) => {
        const m = f.explanation.match(/(\d+) days/);
        return m ? Number(m[1]) : 0;
      };
      return [...flags].sort((a, b) => getDays(b) - getDays(a));
    }
    return flags;
  }

  // Compute groups
  const overdueGroups = useMemo(() => {
    const overdue = visibleItems.filter((f) => f.category === "overdue_installment");
    const groups = groupOverdue(overdue);
    if (sortMode === "age") return [...groups].sort((a, b) => b.maxDays - a.maxDays);
    return groups; // default: by amount (already sorted)
  }, [visibleItems, sortMode]);

  const nonOverdueFlags = useMemo(() => {
    return sortFlags(visibleItems.filter((f) => f.category !== "overdue_installment"));
  }, [visibleItems, sortMode]);

  // Total exposure
  const totalExposure = useMemo(() => {
    if (!data) return 0;
    return data.items.reduce((sum, f) => sum + (f.amount_paise ?? 0), 0);
  }, [data]);

  // Available categories for filter
  const availableCategories = useMemo(() => {
    if (!data) return [];
    const set = new Set(data.items.map((f) => f.category));
    return [...set];
  }, [data]);

  const activeFilters = [severity, category].filter(Boolean).length;
  const dismissedCount = dismissed.size;

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-3xl font-bold" style={{ color: "var(--text)" }}>Risk flags</h1>
        {dismissedCount > 0 && (
          <button onClick={() => setDismissed(new Set())}
            className="text-xs underline" style={{ color: "var(--text-secondary)" }}>
            Restore {dismissedCount} dismissed
          </button>
        )}
      </div>
      <p className="text-sm mb-6" style={{ color: "var(--text-secondary)" }}>
        Issues detected automatically — each with a next step.
        {data && <span className="ml-1" style={{ color: "var(--text-tertiary)" }}>As of {formatDate(data.as_of)}</span>}
      </p>

      {/* KPI cards */}
      {data && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
          <div className="rounded-xl border p-4" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
            <div className="text-sm" style={{ color: "var(--text-secondary)" }}>Total flags</div>
            <div className="text-2xl font-bold" style={{ color: "var(--text)" }}>
              {data.counts.high + data.counts.medium + data.counts.low}
            </div>
          </div>
          <div className="rounded-xl border p-4" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
            <div className="text-sm" style={{ color: "var(--text-secondary)" }}>Total exposure</div>
            <div className="text-2xl font-bold" style={{ color: "var(--danger)" }}>
              {formatMoney(totalExposure, "INR")}
            </div>
          </div>
          <button
            className="text-left rounded-xl border p-4 transition-colors"
            style={{
              backgroundColor: severity === "high" ? "rgba(255, 77, 77, 0.12)" : "rgba(255, 77, 77, 0.06)",
              borderColor: severity === "high" ? "rgba(255, 77, 77, 0.5)" : "rgba(255, 77, 77, 0.2)",
            }}
            onClick={() => { setSeverity(severity === "high" ? "" : "high"); setCategory(""); }}
          >
            <div className="text-sm" style={{ color: "var(--danger)" }}>High</div>
            <div className="text-2xl font-bold" style={{ color: "var(--danger)" }}>{data.counts.high}</div>
          </button>
          <button
            className="text-left rounded-xl border p-4 transition-colors"
            style={{
              backgroundColor: severity === "medium" ? "rgba(255, 176, 32, 0.12)" : "rgba(255, 176, 32, 0.06)",
              borderColor: severity === "medium" ? "rgba(255, 176, 32, 0.5)" : "rgba(255, 176, 32, 0.2)",
            }}
            onClick={() => { setSeverity(severity === "medium" ? "" : "medium"); setCategory(""); }}
          >
            <div className="text-sm" style={{ color: "var(--warning)" }}>Medium</div>
            <div className="text-2xl font-bold" style={{ color: "var(--warning)" }}>{data.counts.medium}</div>
          </button>
          <button
            className="text-left rounded-xl border p-4 transition-colors"
            style={{
              backgroundColor: severity === "low" ? "rgba(77, 158, 255, 0.12)" : "rgba(77, 158, 255, 0.06)",
              borderColor: severity === "low" ? "rgba(77, 158, 255, 0.5)" : "rgba(77, 158, 255, 0.2)",
            }}
            onClick={() => { setSeverity(severity === "low" ? "" : "low"); setCategory(""); }}
          >
            <div className="text-sm" style={{ color: "var(--info)" }}>Low</div>
            <div className="text-2xl font-bold" style={{ color: "var(--info)" }}>{data.counts.low}</div>
          </button>
        </div>
      )}

      {/* Filters + sort */}
      <div className="rounded-xl border p-4 mb-6" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-tertiary)" }}>Filter &amp; sort</span>
          {(activeFilters > 0 || sortMode !== "default") && (
            <button onClick={() => { setSeverity(""); setCategory(""); setSortMode("default"); }}
              className="text-xs underline" style={{ color: "var(--text-secondary)" }}>
              Reset
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs mb-1" style={{ color: "var(--text-secondary)" }}>Severity</label>
            <select value={severity} onChange={(e) => setSeverity(e.target.value)}
              className="w-full text-sm rounded-md px-3 py-2"
              style={{ backgroundColor: "var(--surface-hover)", border: "1px solid var(--border)", color: "var(--text)" }}>
              <option value="">All severities</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>
          <div>
            <label className="block text-xs mb-1" style={{ color: "var(--text-secondary)" }}>Category</label>
            <select value={category} onChange={(e) => setCategory(e.target.value)}
              className="w-full text-sm rounded-md px-3 py-2"
              style={{ backgroundColor: "var(--surface-hover)", border: "1px solid var(--border)", color: "var(--text)" }}>
              <option value="">All categories</option>
              {availableCategories.map((c) => (
                <option key={c} value={c}>{categoryLabels[c] ?? c.replace(/_/g, " ")}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs mb-1" style={{ color: "var(--text-secondary)" }}>Sort by</label>
            <select value={sortMode} onChange={(e) => setSortMode(e.target.value as SortMode)}
              className="w-full text-sm rounded-md px-3 py-2"
              style={{ backgroundColor: "var(--surface-hover)", border: "1px solid var(--border)", color: "var(--text)" }}>
              <option value="default">Default (severity)</option>
              <option value="amount">Largest amount first</option>
              <option value="age">Oldest first</option>
            </select>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="animate-pulse space-y-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-16 rounded" style={{ backgroundColor: "var(--surface)" }} />)}
        </div>
      ) : visibleItems.length === 0 ? (
        <div className="rounded-xl border p-12 text-center" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full mb-3"
            style={{ backgroundColor: "rgba(0, 220, 130, 0.15)" }}>
            <svg className="w-6 h-6" style={{ color: "var(--accent)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="font-medium" style={{ color: "var(--text)" }}>All clear</p>
          <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>
            No {activeFilters > 0 ? "matching " : ""}risk flags detected
            {data ? ` as of ${formatDate(data.as_of)}` : ""}.
            {dismissedCount > 0 && ` (${dismissedCount} dismissed)`}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Overdue: grouped by student */}
          {overdueGroups.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wider mb-3" style={{ color: "var(--text-secondary)" }}>
                Overdue installments — {overdueGroups.length} student{overdueGroups.length !== 1 ? "s" : ""}
              </h3>
              <div className="space-y-2">
                {(expandedSections.has("overdue") ? overdueGroups : overdueGroups.slice(0, COLLAPSED_LIMIT)).map((g) => {
                  const dot = g.maxDays > 90 ? sevDot.high : sevDot.medium;
                  return (
                    <div key={g.student} className="rounded-xl border p-4"
                      style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: dot }} />
                          <div className="min-w-0">
                            <Link href={`/students?search=${encodeURIComponent(g.student)}`}
                              className="font-medium hover:underline" style={{ color: "var(--accent)" }}>
                              {g.student}
                            </Link>
                            <span className="ml-2 text-sm" style={{ color: "var(--text-secondary)" }}>
                              {g.flags.length} installment{g.flags.length > 1 ? "s" : ""} · {formatMoney(g.totalPaise, g.currency)}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0 ml-3">
                          <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>{g.maxDays}d overdue</span>
                          <Link href={`/reminders?student=${encodeURIComponent(g.student)}`}
                            className="px-4 py-1.5 text-xs font-medium rounded-md transition-colors"
                            style={{ border: "1px solid var(--border)", color: "var(--text)" }}>
                            Send reminder
                          </Link>
                        </div>
                      </div>
                      {/* Expandable detail lines */}
                      {g.flags.length > 0 && (
                        <details className="mt-2">
                          <summary className="text-xs cursor-pointer pl-5" style={{ color: "var(--text-tertiary)" }}>
                            {g.flags.length} installment{g.flags.length > 1 ? "s" : ""} — click to expand
                          </summary>
                          <div className="mt-1.5 space-y-1 pl-5">
                            {g.flags.map((f, i) => {
                              const daysMatch = f.explanation.match(/is (\d+) days overdue/);
                              const dueDateMatch = f.explanation.match(/\(due (.+?)\)/);
                              return (
                                <div key={i} className="text-sm flex items-center justify-between" style={{ color: "var(--text-secondary)" }}>
                                  <span>
                                    {formatMoney(f.amount_paise ?? 0, f.currency)}
                                    <span className="mx-1.5" style={{ color: "var(--text-tertiary)" }}>·</span>
                                    {daysMatch ? `${daysMatch[1]} days overdue` : "overdue"}
                                    {dueDateMatch && (
                                      <span style={{ color: "var(--text-tertiary)" }}> (due {dueDateMatch[1]})</span>
                                    )}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </details>
                      )}
                    </div>
                  );
                })}
                {overdueGroups.length > COLLAPSED_LIMIT && (
                  <button onClick={() => toggleExpand("overdue")}
                    className="w-full text-center py-2 text-xs font-medium rounded-lg transition-colors"
                    style={{ color: "var(--text-secondary)", backgroundColor: "var(--surface)" }}>
                    {expandedSections.has("overdue")
                      ? "Show less"
                      : `Show all ${overdueGroups.length} students`}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Non-overdue flags by category */}
          {(() => {
            const byCategory = new Map<string, { flag: RiskFlag; idx: number }[]>();
            for (let i = 0; i < nonOverdueFlags.length; i++) {
              const f = nonOverdueFlags[i];
              const list = byCategory.get(f.category) ?? [];
              // Find original index in activeItems for dismiss key
              const origIdx = activeItems.indexOf(f);
              list.push({ flag: f, idx: origIdx });
              byCategory.set(f.category, list);
            }
            return [...byCategory.entries()].map(([cat, entries]) => {
              const expanded = expandedSections.has(cat);
              const visible = expanded ? entries : entries.slice(0, COLLAPSED_LIMIT);
              return (
                <div key={cat}>
                  <h3 className="text-sm font-semibold uppercase tracking-wider mb-3" style={{ color: "var(--text-secondary)" }}>
                    {categoryLabels[cat] ?? cat.replace(/_/g, " ")} — {entries.length} flag{entries.length !== 1 ? "s" : ""}
                  </h3>
                  <div className="space-y-2">
                    {visible.map(({ flag: f, idx }) => {
                      const dot = sevDot[f.severity] ?? sevDot.low;
                      const action = actionForFlag(f);
                      const key = flagKey(f, idx);
                      return (
                        <div key={key} className="rounded-xl border p-4 flex items-center justify-between"
                          style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
                          <div className="flex items-center gap-3 flex-1 min-w-0">
                            <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: dot }} />
                            <div className="min-w-0">
                              <div className="text-sm" style={{ color: "var(--text)" }}>{f.explanation}</div>
                              {f.amount_paise != null && (
                                <div className="text-xs mt-0.5" style={{ color: "var(--text-tertiary)" }}>
                                  {formatMoney(f.amount_paise, f.currency)}
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0 ml-3">
                            <button onClick={() => dismiss(key)}
                              className="px-2 py-1 text-xs rounded-md transition-colors"
                              style={{ color: "var(--text-tertiary)" }}
                              title="Dismiss this flag">
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                            <Link href={action.href}
                              className="px-4 py-1.5 text-xs font-medium rounded-md transition-colors"
                              style={{ border: "1px solid var(--border)", color: "var(--text)" }}>
                              {action.label}
                            </Link>
                          </div>
                        </div>
                      );
                    })}
                    {entries.length > COLLAPSED_LIMIT && (
                      <button onClick={() => toggleExpand(cat)}
                        className="w-full text-center py-2 text-xs font-medium rounded-lg transition-colors"
                        style={{ color: "var(--text-secondary)", backgroundColor: "var(--surface)" }}>
                        {expanded
                          ? "Show less"
                          : `Show all ${entries.length} flags`}
                      </button>
                    )}
                  </div>
                </div>
              );
            });
          })()}
        </div>
      )}
    </div>
  );
}
