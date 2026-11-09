"use client";

import { useState } from "react";
import useSWR from "swr";
import { apiFetch } from "@/lib/api";
import { formatMoney, formatDate } from "@/lib/format";
import { useAppUser } from "@/app/providers";

interface Reminder {
  installment_id: number; student_name: string; enrollment_program: string;
  amount_due_paise: number; currency: string; due_date: string;
  reminder_type: string; scheduled_for: string; needs_approval: boolean;
  message: string; approved: boolean;
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

  const params = new URLSearchParams();
  if (typeFilter) params.set("type", typeFilter);
  if (approvalFilter) params.set("approval", approvalFilter);

  const { data, mutate, isLoading } = useSWR<RemindersData>(`/reminders?${params}`, fetcher);
  const [acting, setActing] = useState<string | null>(null);

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

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-1">Reminders</h1>
      <p className="text-sm text-gray-500 mb-6">Auto-drafted messages for upcoming and overdue installments.</p>

      {data && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-lg border p-4" style={{ borderColor: "var(--card-border)" }}>
            <div className="text-sm text-gray-500">Pre-due</div>
            <div className="text-2xl font-bold">{data.counts.pre_due}</div>
          </div>
          <div className="bg-white rounded-lg border p-4" style={{ borderColor: "var(--card-border)" }}>
            <div className="text-sm text-gray-500">Due today</div>
            <div className="text-2xl font-bold">{data.counts.on_due}</div>
          </div>
          <div className="bg-white rounded-lg border p-4" style={{ borderColor: "var(--card-border)" }}>
            <div className="text-sm text-gray-500">Overdue</div>
            <div className="text-2xl font-bold text-red-600">{data.counts.overdue}</div>
          </div>
          <div className="bg-white rounded-lg border p-4" style={{ borderColor: "var(--card-border)" }}>
            <div className="text-sm text-gray-500">Needs approval</div>
            <div className="text-2xl font-bold text-orange-600">{data.counts.needs_approval}</div>
          </div>
        </div>
      )}

      <div className="flex gap-3 mb-6">
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}
          className="text-sm border border-gray-300 rounded-md px-3 py-2">
          <option value="">All types</option>
          <option value="pre_due">Pre-due</option>
          <option value="on_due">Due today</option>
          <option value="overdue">Overdue</option>
        </select>
        <select value={approvalFilter} onChange={(e) => setApprovalFilter(e.target.value)}
          className="text-sm border border-gray-300 rounded-md px-3 py-2">
          <option value="">All</option>
          <option value="auto">Auto-send</option>
          <option value="needs_approval">Needs approval</option>
        </select>
      </div>

      {isLoading ? (
        <div className="animate-pulse space-y-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-20 bg-gray-200 rounded" />)}
        </div>
      ) : !data || data.items.length === 0 ? (
        <div className="bg-white rounded-lg border p-8 text-center" style={{ borderColor: "var(--card-border)" }}>
          <p className="text-gray-500">No reminders to show.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {data.items.map((r) => {
            const badge = typeBadge[r.reminder_type] ?? { bg: "#f3f4f6", text: "#374151", label: r.reminder_type };
            const key = `${r.installment_id}_${r.reminder_type}`;
            return (
              <div key={key} className="bg-white rounded-lg border p-4" style={{ borderColor: "var(--card-border)" }}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="px-2 py-0.5 rounded text-xs font-semibold"
                      style={{ backgroundColor: badge.bg, color: badge.text }}>
                      {badge.label}
                    </span>
                    <div>
                      <span className="font-medium text-gray-900">{r.student_name}</span>
                      <span className="text-gray-500"> — {r.enrollment_program}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-gray-500">
                      {formatMoney(r.amount_due_paise, r.currency)} · due {formatDate(r.due_date)}
                    </span>
                    {r.needs_approval && !r.approved && canApprove ? (
                      <button
                        onClick={() => handleApprove(r.installment_id, r.reminder_type)}
                        disabled={acting === key}
                        className="px-3 py-1 text-xs font-medium text-white rounded-md disabled:opacity-50"
                        style={{ backgroundColor: "var(--accent)" }}
                      >
                        {acting === key ? "..." : "Approve"}
                      </button>
                    ) : r.approved ? (
                      <span className="px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">Approved</span>
                    ) : (
                      <span className="px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">Auto</span>
                    )}
                  </div>
                </div>
                <details className="mt-2">
                  <summary className="text-xs text-gray-400 cursor-pointer">Preview message</summary>
                  <pre className="mt-2 text-sm text-gray-600 whitespace-pre-wrap bg-gray-50 p-3 rounded">{r.message}</pre>
                </details>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
