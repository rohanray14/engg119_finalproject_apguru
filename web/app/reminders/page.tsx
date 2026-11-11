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

function RemindersPage() {
  const urlParams = useSearchParams();
  const [typeFilter, setTypeFilter] = useState("");
  const [approvalFilter, setApprovalFilter] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    const q = urlParams.get("student");
    if (q) setSearch(q);
  }, [urlParams]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const params = new URLSearchParams();
  if (typeFilter) params.set("type", typeFilter);
  if (approvalFilter) params.set("approval", approvalFilter);

  const { data, isLoading } = useSWR<RemindersData>(`/reminders?${params}`, fetcher);

  const items = (data?.items ?? []).filter((r) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return r.student_name.toLowerCase().includes(q) || r.parent_name.toLowerCase().includes(q);
  });

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
          <button onClick={() => { setTypeFilter("pre_due"); setApprovalFilter(""); }}
            className={`rounded-xl border p-4 text-left transition-colors ${typeFilter === "pre_due" ? "ring-2" : ""}`}
            style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
            <div className="text-sm" style={{ color: "var(--text-secondary)" }}>Pre-due</div>
            <div className="text-2xl font-bold" style={{ color: "var(--text)" }}>{data.counts.pre_due}</div>
            <div className="text-xs mt-1" style={{ color: "var(--text-tertiary)" }}>3 days before due</div>
          </button>
          <button onClick={() => { setTypeFilter("on_due"); setApprovalFilter(""); }}
            className={`rounded-xl border p-4 text-left transition-colors ${typeFilter === "on_due" ? "ring-2" : ""}`}
            style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
            <div className="text-sm" style={{ color: "var(--text-secondary)" }}>Due today</div>
            <div className="text-2xl font-bold" style={{ color: "var(--text)" }}>{data.counts.on_due}</div>
            <div className="text-xs mt-1" style={{ color: "var(--text-tertiary)" }}>Payment due now</div>
          </button>
          <button onClick={() => { setTypeFilter("overdue"); setApprovalFilter(""); }}
            className={`rounded-xl border p-4 text-left transition-colors ${typeFilter === "overdue" ? "ring-2" : ""}`}
            style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
            <div className="text-sm" style={{ color: "var(--text-secondary)" }}>Overdue</div>
            <div className="text-2xl font-bold" style={{ color: "var(--danger)" }}>{data.counts.overdue}</div>
            <div className="text-xs mt-1" style={{ color: "var(--text-tertiary)" }}>7+ days past due</div>
          </button>
          <button onClick={() => { setTypeFilter(""); setApprovalFilter("needs_approval"); }}
            className={`rounded-xl border p-4 text-left transition-colors ${approvalFilter === "needs_approval" ? "ring-2" : ""}`}
            style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
            <div className="text-sm" style={{ color: "var(--text-secondary)" }}>Needs approval</div>
            <div className="text-2xl font-bold" style={{ color: "var(--warning)" }}>{data.counts.needs_approval}</div>
            <div className="text-xs mt-1" style={{ color: "var(--text-tertiary)" }}>3rd+ reminder, review first</div>
          </button>
        </div>
      )}

      {/* Overdue summary banner */}
      {overdueByStudent.size > 0 && typeFilter !== "pre_due" && typeFilter !== "on_due" && (
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
        <select value={approvalFilter} onChange={(e) => { setApprovalFilter(e.target.value); if (e.target.value) setTypeFilter(""); }}
          className="text-sm rounded-md px-3 py-2"
          style={{ backgroundColor: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)" }}>
          <option value="">All</option>
          <option value="auto">Auto-send</option>
          <option value="needs_approval">Needs approval</option>
        </select>
        <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by student or parent name..."
          className="text-sm rounded-md px-3 py-2 w-64"
          style={{ backgroundColor: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)" }} />
        {(typeFilter || approvalFilter || search) && (
          <button onClick={() => { setTypeFilter(""); setApprovalFilter(""); setSearch(""); }}
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
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs border-b" style={{ color: "var(--text-secondary)", borderColor: "var(--border-subtle)", backgroundColor: "var(--surface-hover)" }}>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Student</th>
                <th className="px-4 py-3 font-medium">Program</th>
                <th className="px-4 py-3 font-medium text-right">Amount</th>
                <th className="px-4 py-3 font-medium">Due</th>
                <th className="px-4 py-3 font-medium">Contact</th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => {
                const badge = typeBadge[r.reminder_type] ?? { bg: "var(--surface-hover)", text: "var(--text-secondary)", label: r.reminder_type };
                const key = `${r.installment_id}_${r.reminder_type}`;
                const isExpanded = expanded.has(key);
                return (
                  <React.Fragment key={key}>
                    <tr style={{ borderBottom: "1px solid var(--border-subtle)" }}
                      onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "var(--surface-hover)"}
                      onMouseLeave={(e) => e.currentTarget.style.backgroundColor = ""}>
                      <td className="px-4 py-2.5">
                        <span className="px-2 py-0.5 rounded text-xs font-semibold whitespace-nowrap"
                          style={{ backgroundColor: badge.bg, color: badge.text }}>
                          {badge.label}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <Link href={`/students?id=${r.student_id}`}
                          className="font-medium hover:underline" style={{ color: "var(--accent)" }}>
                          {r.student_name}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5" style={{ color: "var(--text-secondary)" }}>{r.enrollment_program}</td>
                      <td className="px-4 py-2.5 text-right font-medium whitespace-nowrap">
                        {formatMoney(r.amount_due_paise, r.currency)}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">{formatDate(r.due_date)}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          {r.parent_phone && (
                            <a href={`https://wa.me/${r.parent_phone.replace(/[^+\d]/g, "")}?text=${encodeURIComponent(r.message)}`}
                              target="_blank" rel="noopener noreferrer"
                              className="text-xs px-2 py-0.5 rounded transition-colors whitespace-nowrap"
                              style={{ border: "1px solid rgba(0, 220, 130, 0.4)", color: "var(--accent)" }}>
                              WhatsApp
                            </a>
                          )}
                          {r.parent_email && (
                            <a href={`mailto:${r.parent_email}?subject=Payment reminder — ${r.enrollment_program}&body=${encodeURIComponent(r.message)}`}
                              className="text-xs px-2 py-0.5 rounded transition-colors whitespace-nowrap"
                              style={{ border: "1px solid rgba(77, 158, 255, 0.4)", color: "var(--info)" }}>
                              Email
                            </a>
                          )}
                          <button onClick={() => toggleExpand(key)}
                            className="text-xs ml-1"
                            style={{ color: "var(--text-tertiary)" }}
                            title="Preview message">
                            <svg className={`w-3.5 h-3.5 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                            </svg>
                          </button>
                        </div>
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
