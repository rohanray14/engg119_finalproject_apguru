"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { apiFetch } from "@/lib/api";
import { formatMoney, formatDate } from "@/lib/format";
import { useAppUser } from "@/app/providers";

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
  pre_due: { bg: "#dbeafe", text: "#1e40af", label: "Pre-due" },
  on_due: { bg: "#d1fae5", text: "#065f46", label: "Due today" },
  overdue: { bg: "#fee2e2", text: "#991b1b", label: "Overdue" },
};

export default function RemindersPage() {
  const { user } = useAppUser();
  const canApprove = user?.can_approve ?? false;
  const [typeFilter, setTypeFilter] = useState("");
  const [approvalFilter, setApprovalFilter] = useState("");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [sentMessages, setSentMessages] = useState<Set<string>>(new Set());

  const params = new URLSearchParams();
  if (typeFilter) params.set("type", typeFilter);
  if (approvalFilter) params.set("approval", approvalFilter);

  const { data, mutate, isLoading } = useSWR<RemindersData>(`/reminders?${params}`, fetcher);
  const [acting, setActing] = useState<string | null>(null);

  const items = (data?.items ?? []).filter((r) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return r.student_name.toLowerCase().includes(q) || r.parent_name.toLowerCase().includes(q);
  });

  async function handleApprove(installmentId: number, reminderType: string) {
    const key = `${installmentId}_${reminderType}`;
    setActing(key);
    try {
      await apiFetch("/reminders/approve", {
        method: "POST",
        body: { installment_id: installmentId, reminder_type: reminderType },
      });
      mutate();
    } catch {
      // ignore
    } finally {
      setActing(null);
    }
  }

  function toggleExpand(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function simulateSend(key: string) {
    setSentMessages((prev) => new Set(prev).add(key));
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
      <h1 className="text-3xl font-bold text-gray-900 mb-1">Reminders</h1>
      <p className="text-sm text-gray-500 mb-6">
        Auto-drafted messages for upcoming and overdue installments.
        {data && ` Showing data as of ${formatDate(data.as_of)}.`}
      </p>

      {data && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <button onClick={() => { setTypeFilter("pre_due"); setApprovalFilter(""); }}
            className={`bg-white rounded-lg border p-4 text-left transition-colors ${typeFilter === "pre_due" ? "ring-2 ring-blue-300" : ""}`}
            style={{ borderColor: "var(--card-border)" }}>
            <div className="text-sm text-gray-500">Pre-due</div>
            <div className="text-2xl font-bold">{data.counts.pre_due}</div>
            <div className="text-xs text-gray-400 mt-1">3 days before due</div>
          </button>
          <button onClick={() => { setTypeFilter("on_due"); setApprovalFilter(""); }}
            className={`bg-white rounded-lg border p-4 text-left transition-colors ${typeFilter === "on_due" ? "ring-2 ring-green-300" : ""}`}
            style={{ borderColor: "var(--card-border)" }}>
            <div className="text-sm text-gray-500">Due today</div>
            <div className="text-2xl font-bold">{data.counts.on_due}</div>
            <div className="text-xs text-gray-400 mt-1">Payment due now</div>
          </button>
          <button onClick={() => { setTypeFilter("overdue"); setApprovalFilter(""); }}
            className={`bg-white rounded-lg border p-4 text-left transition-colors ${typeFilter === "overdue" ? "ring-2 ring-red-300" : ""}`}
            style={{ borderColor: "var(--card-border)" }}>
            <div className="text-sm text-gray-500">Overdue</div>
            <div className="text-2xl font-bold text-red-600">{data.counts.overdue}</div>
            <div className="text-xs text-gray-400 mt-1">7+ days past due</div>
          </button>
          <button onClick={() => { setTypeFilter(""); setApprovalFilter("needs_approval"); }}
            className={`bg-white rounded-lg border p-4 text-left transition-colors ${approvalFilter === "needs_approval" ? "ring-2 ring-orange-300" : ""}`}
            style={{ borderColor: "var(--card-border)" }}>
            <div className="text-sm text-gray-500">Needs approval</div>
            <div className="text-2xl font-bold text-orange-600">{data.counts.needs_approval}</div>
            <div className="text-xs text-gray-400 mt-1">3rd+ reminder, review first</div>
          </button>
        </div>
      )}

      {/* Overdue summary banner */}
      {overdueByStudent.size > 0 && typeFilter !== "pre_due" && typeFilter !== "on_due" && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
          <div className="text-sm font-medium text-red-800 mb-2">
            {overdueByStudent.size} students have overdue payments
          </div>
          <div className="flex flex-wrap gap-2">
            {Array.from(overdueByStudent.entries()).sort((a, b) => b[1].total - a[1].total).slice(0, 8).map(([sid, info]) => (
              <Link key={sid} href={`/students?id=${sid}`}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-white border border-red-200 text-xs hover:border-red-400 transition-colors">
                <span className="font-medium text-gray-900">{info.name}</span>
                <span className="text-red-600 font-medium">{formatMoney(info.total, info.currency)}</span>
              </Link>
            ))}
            {overdueByStudent.size > 8 && (
              <span className="text-xs text-red-600 self-center">+{overdueByStudent.size - 8} more</span>
            )}
          </div>
        </div>
      )}

      <div className="flex gap-3 mb-6 items-center">
        <select value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setApprovalFilter(""); }}
          className="text-sm border border-gray-300 rounded-md px-3 py-2">
          <option value="">All types</option>
          <option value="pre_due">Pre-due</option>
          <option value="on_due">Due today</option>
          <option value="overdue">Overdue</option>
        </select>
        <select value={approvalFilter} onChange={(e) => { setApprovalFilter(e.target.value); if (e.target.value) setTypeFilter(""); }}
          className="text-sm border border-gray-300 rounded-md px-3 py-2">
          <option value="">All</option>
          <option value="auto">Auto-send</option>
          <option value="needs_approval">Needs approval</option>
        </select>
        <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by student or parent name..."
          className="text-sm border border-gray-300 rounded-md px-3 py-2 w-64" />
        {(typeFilter || approvalFilter || search) && (
          <button onClick={() => { setTypeFilter(""); setApprovalFilter(""); setSearch(""); }}
            className="text-xs text-gray-500 hover:text-gray-700">Clear filters</button>
        )}
        <span className="text-xs text-gray-400 ml-auto">{items.length} reminders</span>
      </div>

      {isLoading ? (
        <div className="animate-pulse space-y-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-20 bg-gray-200 rounded" />)}
        </div>
      ) : items.length === 0 ? (
        <div className="bg-white rounded-lg border p-8 text-center" style={{ borderColor: "var(--card-border)" }}>
          <p className="text-gray-500">No reminders to show.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((r) => {
            const badge = typeBadge[r.reminder_type] ?? { bg: "#f3f4f6", text: "#374151", label: r.reminder_type };
            const key = `${r.installment_id}_${r.reminder_type}`;
            const isExpanded = expanded.has(key);
            const isSent = sentMessages.has(key);
            return (
              <div key={key} className="bg-white rounded-lg border" style={{ borderColor: "var(--card-border)" }}>
                <div className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3 min-w-0">
                      <span className="px-2 py-0.5 rounded text-xs font-semibold shrink-0 mt-0.5"
                        style={{ backgroundColor: badge.bg, color: badge.text }}>
                        {badge.label}
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <Link href={`/students?id=${r.student_id}`}
                            className="font-medium hover:underline" style={{ color: "var(--accent)" }}>
                            {r.student_name}
                          </Link>
                          <span className="text-gray-500 text-sm">— {r.enrollment_program}</span>
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                          {r.parent_name && <span>Parent: {r.parent_name}</span>}
                          {r.parent_phone && (
                            <a href={`https://wa.me/${r.parent_phone.replace(/[^+\d]/g, "")}`}
                              target="_blank" rel="noopener noreferrer"
                              className="hover:underline" style={{ color: "var(--accent)" }}>
                              {r.parent_phone}
                            </a>
                          )}
                          {r.parent_email && (
                            <a href={`mailto:${r.parent_email}`}
                              className="hover:underline" style={{ color: "var(--accent)" }}>
                              {r.parent_email}
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <div className="text-right">
                        <div className="text-sm font-medium text-gray-900">
                          {formatMoney(r.amount_due_paise, r.currency)}
                        </div>
                        <div className="text-xs text-gray-500">due {formatDate(r.due_date)}</div>
                      </div>
                      {r.needs_approval && !r.approved && canApprove ? (
                        <button
                          onClick={() => handleApprove(r.installment_id, r.reminder_type)}
                          disabled={acting === key}
                          className="px-3 py-1.5 text-xs font-medium text-white rounded-md disabled:opacity-50"
                          style={{ backgroundColor: "var(--accent)" }}
                        >
                          {acting === key ? "..." : "Approve & send"}
                        </button>
                      ) : r.approved ? (
                        <span className="px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">Sent</span>
                      ) : (
                        <span className="px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">Auto</span>
                      )}
                    </div>
                  </div>
                </div>
                {/* Expandable message + actions */}
                <div className="border-t px-4 py-2 flex items-center gap-3" style={{ borderColor: "var(--card-border)" }}>
                  <button onClick={() => toggleExpand(key)}
                    className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1">
                    <svg className={`w-3 h-3 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                    Preview message
                  </button>
                  <div className="flex items-center gap-2 ml-auto">
                    {r.parent_phone && (
                      <a href={`https://wa.me/${r.parent_phone.replace(/[^+\d]/g, "")}?text=${encodeURIComponent(r.message)}`}
                        target="_blank" rel="noopener noreferrer"
                        className="text-xs px-2.5 py-1 rounded border border-green-300 text-green-700 hover:bg-green-50 transition-colors">
                        Send via WhatsApp
                      </a>
                    )}
                    {r.parent_email && (
                      <a href={`mailto:${r.parent_email}?subject=Payment reminder — ${r.enrollment_program}&body=${encodeURIComponent(r.message)}`}
                        className="text-xs px-2.5 py-1 rounded border border-blue-300 text-blue-700 hover:bg-blue-50 transition-colors">
                        Send via Email
                      </a>
                    )}
                    {!isSent ? (
                      <button onClick={() => simulateSend(key)}
                        className="text-xs px-2.5 py-1 rounded border border-gray-300 text-gray-600 hover:bg-gray-50 transition-colors">
                        Mark as sent
                      </button>
                    ) : (
                      <span className="text-xs text-green-600 font-medium">Marked sent</span>
                    )}
                  </div>
                </div>
                {isExpanded && (
                  <div className="border-t px-4 py-3" style={{ borderColor: "var(--card-border)" }}>
                    <pre className="text-sm text-gray-600 whitespace-pre-wrap bg-gray-50 p-3 rounded">{r.message}</pre>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
