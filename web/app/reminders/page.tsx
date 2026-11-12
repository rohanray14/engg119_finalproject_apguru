"use client";

import React, { Suspense, useState, useEffect } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import { apiFetch } from "@/lib/api";
import { formatMoney, formatDate } from "@/lib/format";

interface Reminder {
  installment_id: number; student_id: number; student_name: string; enrollment_program: string;
  amount_due_paise: number; currency: string; due_date: string;
  reminder_type: string; scheduled_for: string; needs_approval: boolean;
  message: string; approved: boolean;
  parent_name: string; parent_phone: string; parent_email: string;
}
interface RemindersData {
  as_of: string;
  counts: { pre_due: number; on_due: number; overdue: number; needs_approval: number };
  items: Reminder[];
}

function fetcher<T>(path: string) { return apiFetch<T>(path); }

const typeBadge: Record<string, { bg: string; text: string; label: string }> = {
  pre_due: { bg: "rgba(77, 158, 255, 0.15)", text: "var(--info)", label: "Pre-due" },
  on_due: { bg: "rgba(0, 220, 130, 0.15)", text: "var(--accent)", label: "Due today" },
  overdue: { bg: "rgba(255, 77, 77, 0.15)", text: "var(--danger)", label: "Overdue" },
};

export default function RemindersPageWrapper() {
  return (
    <Suspense fallback={<div className="p-8"><div className="animate-pulse h-64 rounded" style={{ backgroundColor: "var(--surface)" }} /></div>}>
      <RemindersPage />
    </Suspense>
  );
}

type SortKey = "student_name" | "amount_due_paise" | "due_date" | null;
type SortDir = "asc" | "desc";

function RemindersPage() {
  const urlParams = useSearchParams();
  const [typeFilters, setTypeFilters] = useState<Set<string>>(new Set());
  const [approvalFilter, setApprovalFilter] = useState("");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("due_date");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  useEffect(() => {
    const q = urlParams.get("student");
    if (q) setSearch(q);
  }, [urlParams]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const params = new URLSearchParams();
  if (approvalFilter) params.set("approval", approvalFilter);

  const { data, mutate, isLoading } = useSWR<RemindersData>(`/reminders?${params}`, fetcher);

  const filtered = (data?.items ?? []).filter((r) => {
    if (typeFilters.size > 0 && !typeFilters.has(r.reminder_type)) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return r.student_name.toLowerCase().includes(q) || r.parent_name.toLowerCase().includes(q);
  });

  const items = React.useMemo(() => {
    if (!sortKey) return filtered;
    const sorted = [...filtered];
    sorted.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "student_name": cmp = a.student_name.localeCompare(b.student_name); break;
        case "amount_due_paise": cmp = a.amount_due_paise - b.amount_due_paise; break;
        case "due_date": cmp = (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"); break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [filtered, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      if (sortDir === "asc") setSortDir("desc");
      else { setSortKey(null); }
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  function toggleExpand(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  // Group by student for overdue summary
  const overdueByStudent = new Map<number, { name: string; total: number; currency: string; count: number }>();
  for (const r of data?.items ?? []) {
    if (r.reminder_type !== "overdue") continue;
    const existing = overdueByStudent.get(r.student_id);
    if (existing) {
      existing.total += r.amount_due_paise;
      existing.count++;
    } else {
      overdueByStudent.set(r.student_id, {
        name: r.student_name, total: r.amount_due_paise, currency: r.currency, count: 1,
      });
    }
  }

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-1" style={{ color: "var(--text)" }}>Reminders</h1>
      <p className="text-sm mb-6" style={{ color: "var(--text-secondary)" }}>
        Auto-drafted messages for upcoming and overdue installments.
        {data && ` Showing data as of ${formatDate(data.as_of)}.`}
      </p>

      {data && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {([
            { key: "pre_due", label: "Pre-due", count: data.counts.pre_due, sub: "3 days before due", color: "var(--info)" },
            { key: "on_due", label: "Due today", count: data.counts.on_due, sub: "Payment due now", color: "var(--accent)" },
            { key: "overdue", label: "Overdue", count: data.counts.overdue, sub: "7+ days past due", color: "var(--danger)" },
            { key: "approval", label: "Needs approval", count: data.counts.needs_approval, sub: "3rd+ reminder, review first", color: "var(--warning)" },
          ] as const).map((card) => {
            const active = card.key === "approval" ? approvalFilter === "needs_approval" : typeFilters.has(card.key);
            return (
              <button key={card.key}
                onClick={() => {
                  if (card.key === "approval") {
                    setApprovalFilter(approvalFilter === "needs_approval" ? "" : "needs_approval");
                  } else {
                    setTypeFilters((prev) => {
                      const next = new Set(prev);
                      if (next.has(card.key)) next.delete(card.key); else next.add(card.key);
                      return next;
                    });
                  }
                }}
                className="rounded-xl border p-4 text-left transition-colors"
                style={{
                  backgroundColor: active ? "var(--surface-hover)" : "var(--surface)",
                  borderColor: active ? "var(--text-secondary)" : "var(--border)",
                }}>
                <div className="text-sm" style={{ color: active ? "var(--text)" : "var(--text-secondary)" }}>{card.label}</div>
                <div className="text-2xl font-bold" style={{ color: card.color }}>{card.count}</div>
                <div className="text-xs mt-1" style={{ color: "var(--text-tertiary)" }}>{card.sub}</div>
              </button>
            );
          })}
        </div>
      )}

      {/* Overdue summary banner */}
      {overdueByStudent.size > 0 && !typeFilters.has("pre_due") && !typeFilters.has("on_due") && (
        <div className="rounded-lg p-4 mb-6" style={{ backgroundColor: "rgba(255, 77, 77, 0.1)", border: "1px solid rgba(255, 77, 77, 0.3)" }}>
          <div className="text-sm font-medium mb-2" style={{ color: "var(--danger)" }}>
            {overdueByStudent.size} students have overdue payments
          </div>
          <div className="flex flex-wrap gap-2">
            {Array.from(overdueByStudent.entries()).sort((a, b) => b[1].total - a[1].total).slice(0, 8).map(([sid, info]) => (
              <Link key={sid} href={`/students?id=${sid}`}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs transition-colors"
                style={{ backgroundColor: "var(--surface)", border: "1px solid rgba(255, 77, 77, 0.3)" }}>
                <span className="font-medium" style={{ color: "var(--text)" }}>{info.name}</span>
                <span className="font-medium" style={{ color: "var(--danger)" }}>{formatMoney(info.total, info.currency)}</span>
              </Link>
            ))}
            {overdueByStudent.size > 8 && (
              <span className="text-xs self-center" style={{ color: "var(--danger)" }}>+{overdueByStudent.size - 8} more</span>
            )}
          </div>
        </div>
      )}

      <div className="flex gap-3 mb-6 items-center">
        <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by student or parent name..."
          className="text-sm rounded-md px-3 py-2 w-64"
          style={{ backgroundColor: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)" }} />
        {(typeFilters.size > 0 || approvalFilter || search) && (
          <button onClick={() => { setTypeFilters(new Set()); setApprovalFilter(""); setSearch(""); }}
            className="text-xs" style={{ color: "var(--text-secondary)" }}>Clear filters</button>
        )}
        <span className="text-xs ml-auto" style={{ color: "var(--text-tertiary)" }}>{items.length} reminders</span>
      </div>

      {isLoading ? (
        <div className="animate-pulse space-y-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-16 rounded" style={{ backgroundColor: "var(--surface)" }} />)}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border p-8 text-center" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
          <p style={{ color: "var(--text-secondary)" }}>No reminders to show.</p>
          {search && (data?.items ?? []).length > 0 && (
            <p className="text-xs mt-2" style={{ color: "var(--text-tertiary)" }}>
              No scheduled reminders match &ldquo;{search}&rdquo;. Reminders are auto-generated 3 days before due, on the due date, and 7+ days after due.
            </p>
          )}
        </div>
      ) : (
        <div className="rounded-xl border overflow-x-auto" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
          <table className="w-full text-sm" style={{ tableLayout: "fixed" }}>
            <colgroup>
              <col style={{ width: "22%" }} />
              <col style={{ width: "14%" }} />
              <col style={{ width: "14%" }} />
              <col style={{ width: "10%" }} />
              <col style={{ width: "26%" }} />
              <col style={{ width: "14%" }} />
            </colgroup>
            <thead>
              <tr className="text-left text-xs border-b" style={{ color: "var(--text-secondary)", borderColor: "var(--border-subtle)", backgroundColor: "var(--surface-hover)" }}>
                {([
                  { label: "Student", field: "student_name" as SortKey },
                  { label: "Amount", field: "amount_due_paise" as SortKey, align: "right" },
                  { label: "Due", field: "due_date" as SortKey },
                ] as const).map((col) => {
                  const active = sortKey === col.field;
                  return (
                    <th key={col.label}
                      className={`px-4 py-3 font-medium cursor-pointer select-none ${"align" in col && col.align === "right" ? "text-right" : ""}`}
                      onClick={() => toggleSort(col.field)}>
                      {col.label}
                      {active
                        ? <span className="ml-1" style={{ color: "var(--text)" }}>{sortDir === "asc" ? "\u2191" : "\u2193"}</span>
                        : <span className="ml-1" style={{ color: "var(--text-tertiary)" }}>{"\u2195"}</span>}
                    </th>
                  );
                })}
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Action</th>
                <th className="px-4 py-3 font-medium text-center">Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => {
                const badge = typeBadge[r.reminder_type] ?? { bg: "var(--surface-hover)", text: "var(--text-secondary)", label: r.reminder_type };
                const key = `${r.installment_id}_${r.reminder_type}`;
                const isExpanded = expanded.has(key);
                const dueDate = new Date(r.due_date + "T00:00:00");
                const today = new Date(); today.setHours(0, 0, 0, 0);
                const daysOver = Math.floor((today.getTime() - dueDate.getTime()) / 86400000);
                const isOverdue = daysOver > 0;

                async function markSent() {
                  try {
                    await apiFetch("/reminders/approve", {
                      method: "POST",
                      body: { installment_id: r.installment_id, reminder_type: r.reminder_type },
                    });
                    mutate();
                  } catch { /* ignore duplicate approvals */ }
                }

                async function unmarkSent() {
                  try {
                    await apiFetch("/reminders/unapprove", {
                      method: "POST",
                      body: { installment_id: r.installment_id, reminder_type: r.reminder_type },
                    });
                    mutate();
                  } catch { /* ignore */ }
                }

                return (
                  <React.Fragment key={key}>
                    <tr style={{ borderBottom: "1px solid var(--border-subtle)" }}
                      onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "var(--surface-hover)"}
                      onMouseLeave={(e) => e.currentTarget.style.backgroundColor = ""}>
                      <td className="px-4 py-2.5">
                        <Link href={`/students?id=${r.student_id}`}
                          className="font-medium hover:underline truncate block" style={{ color: "var(--accent)" }}>
                          {r.student_name}
                        </Link>
                        <div className="text-xs truncate" style={{ color: "var(--text-tertiary)" }}>{r.enrollment_program}</div>
                      </td>
                      <td className="px-4 py-2.5 text-right font-medium whitespace-nowrap">
                        {formatMoney(r.amount_due_paise, r.currency)}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap" style={{ color: isOverdue ? "var(--danger)" : "var(--text)" }}>
                        {formatDate(r.due_date)}
                        {isOverdue && (
                          <div className="text-[10px] font-medium" style={{ color: "var(--danger)" }}>
                            {daysOver < 30 ? `${daysOver}d overdue` : `${Math.floor(daysOver / 30)}mo overdue`}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="px-2 py-0.5 rounded text-xs font-semibold whitespace-nowrap"
                          style={{ backgroundColor: badge.bg, color: badge.text }}>
                          {badge.label}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          {r.parent_phone && (
                            <a href={`https://wa.me/${r.parent_phone.replace(/[^+\d]/g, "")}?text=${encodeURIComponent(r.message)}`}
                              target="_blank" rel="noopener noreferrer"
                              onClick={() => { if (!r.approved) markSent(); }}
                              className="text-xs px-2 py-1 rounded transition-colors whitespace-nowrap"
                              style={{ border: "1px solid rgba(0, 220, 130, 0.4)", color: "var(--accent)" }}>
                              WhatsApp
                            </a>
                          )}
                          {r.parent_email && (
                            <a href={`mailto:${r.parent_email}?subject=Payment reminder — ${r.enrollment_program}&body=${encodeURIComponent(r.message)}`}
                              onClick={() => { if (!r.approved) markSent(); }}
                              className="text-xs px-2 py-1 rounded transition-colors whitespace-nowrap"
                              style={{ border: "1px solid rgba(77, 158, 255, 0.4)", color: "var(--info)" }}>
                              Email
                            </a>
                          )}
                          <button onClick={() => toggleExpand(key)}
                            className="text-xs px-2 py-1 rounded ml-auto whitespace-nowrap"
                            style={{ border: "1px solid var(--border)", color: isExpanded ? "var(--text)" : "var(--text-tertiary)" }}>
                            {isExpanded ? "Hide" : "Preview"}
                          </button>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        {r.approved ? (
                          <button onClick={unmarkSent}
                            className="inline-flex items-center gap-1 text-xs font-medium cursor-pointer hover:opacity-70"
                            style={{ color: "var(--accent)" }}
                            title="Click to undo">
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                            Sent
                          </button>
                        ) : r.needs_approval ? (
                          <button onClick={markSent}
                            className="text-xs px-2.5 py-1 rounded font-medium whitespace-nowrap"
                            style={{ border: "1px solid rgba(255, 176, 32, 0.4)", color: "var(--warning)" }}>
                            Approve
                          </button>
                        ) : (
                          <button onClick={markSent}
                            className="text-xs px-2.5 py-1 rounded font-medium whitespace-nowrap"
                            style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }}>
                            Mark sent
                          </button>
                        )}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan={6} className="px-4 py-3" style={{ backgroundColor: "var(--surface-hover)" }}>
                          <pre className="text-sm whitespace-pre-wrap p-3 rounded" style={{ color: "var(--text-secondary)", backgroundColor: "var(--surface)", border: "1px solid var(--border)" }}>{r.message}</pre>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
