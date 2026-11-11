"use client";

import React from "react";
import Link from "next/link";
import useSWR from "swr";
import { apiFetch } from "@/lib/api";
import { formatMoney, formatDate, displayLocation } from "@/lib/format";

interface Installment {
  id: number; due_date: string | null; amount_due_paise: number; currency: string; status: string; remaining_paise: number;
}
interface Enrollment {
  id: number; program: string; fee_model: string; total_fee_paise: number; currency: string; gst_applicable: boolean;
  installments: Installment[];
}
interface PaymentLink {
  match_id: number; match_status: string; date: string; payer_name: string | null;
  amount_paid_paise: number; currency: string; confirmation: string;
}
interface StudentData {
  id: number; name: string; city: string | null; country: string | null;
  aliases: string[]; payer_aliases: string[];
  parent_name: string | null; parent_phone: string | null; parent_email: string | null;
  enrollments: Enrollment[]; payments: PaymentLink[];
}

function fetcher<T>(path: string) { return apiFetch<T>(path); }

function statusStyle(status: string): React.CSSProperties {
  switch (status) {
    case "paid": return { backgroundColor: "rgba(0,220,130,0.15)", color: "var(--accent)" };
    case "partial": return { backgroundColor: "rgba(77,158,255,0.15)", color: "var(--info)" };
    case "overdue": return { backgroundColor: "rgba(255,77,77,0.15)", color: "var(--danger)" };
    default: return { backgroundColor: "var(--surface-hover)", color: "var(--text-secondary)" };
  }
}

function matchStatusCss(status: string): React.CSSProperties {
  switch (status) {
    case "approved": case "auto": return { backgroundColor: "rgba(0,220,130,0.15)", color: "var(--accent)" };
    case "pending_review": return { backgroundColor: "rgba(255,176,32,0.15)", color: "var(--warning)" };
    default: return { backgroundColor: "var(--surface-hover)", color: "var(--text-secondary)" };
  }
}

interface Props {
  studentId: number;
  onBack: () => void;
}

export default function StudentProfile({ studentId, onBack }: Props) {
  const { data: student, isLoading } = useSWR<StudentData>(`/students/${studentId}`, fetcher);

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 rounded w-48" style={{ backgroundColor: "var(--surface)" }} />
        <div className="h-64 rounded" style={{ backgroundColor: "var(--surface)" }} />
      </div>
    );
  }

  if (!student) {
    return (
      <div>
        <button onClick={onBack} className="text-sm hover:underline" style={{ color: "var(--accent)" }}>
          &larr; Back to students
        </button>
        <div className="mt-8 text-center" style={{ color: "var(--text-secondary)" }}>Student not found.</div>
      </div>
    );
  }

  const location = displayLocation(student.city, student.country);

  const totalOwed = student.enrollments.reduce((sum, e) =>
    sum + e.installments.reduce((s, i) => s + i.remaining_paise, 0), 0);
  const totalPaid = student.payments.reduce((sum, p) =>
    p.match_status === "approved" || p.match_status === "auto" ? sum + p.amount_paid_paise : sum, 0);
  const mainCurrency = student.enrollments[0]?.currency ?? "INR";

  // Next due date: earliest open/overdue installment with a due date
  const nextDue = student.enrollments
    .flatMap((e) => e.installments)
    .filter((i) => i.remaining_paise > 0 && i.due_date)
    .sort((a, b) => (a.due_date! > b.due_date! ? 1 : -1))[0];

  return (
    <div>
      <button onClick={onBack} className="text-sm hover:underline" style={{ color: "var(--accent)" }}>
        &larr; Back to students
      </button>

      {/* Header */}
      <div className="mt-4 mb-6">
        <h1 className="text-3xl font-bold" style={{ color: "var(--text)" }}>{student.name}</h1>
        <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>{location}</p>
        {/* Contact info */}
        {(student.parent_name || student.parent_phone || student.parent_email) && (
          <div className="mt-3 flex items-center gap-4 text-sm">
            {student.parent_name && (
              <span style={{ color: "var(--text-secondary)" }}>
                <span className="text-xs uppercase tracking-wider mr-1" style={{ color: "var(--text-tertiary)" }}>Parent:</span>
                {student.parent_name}
              </span>
            )}
            {student.parent_phone && (
              <a href={`tel:${student.parent_phone}`} className="hover:underline" style={{ color: "var(--accent)" }}>
                {student.parent_phone}
              </a>
            )}
            {student.parent_email && (
              <a href={`mailto:${student.parent_email}`} className="hover:underline" style={{ color: "var(--accent)" }}>
                {student.parent_email}
              </a>
            )}
          </div>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="rounded-lg border p-4" style={{ backgroundColor: "var(--surface)", borderColor: "var(--card-border)" }}>
          <div className="text-xs uppercase tracking-wider font-medium" style={{ color: "var(--text-secondary)" }}>Paid</div>
          <div className="text-xl font-bold mt-1" style={{ color: "var(--accent)" }}>{formatMoney(totalPaid, mainCurrency)}</div>
        </div>
        {totalOwed > 0 ? (
          <Link href={`/reminders?student=${encodeURIComponent(student.name)}`}
            className="rounded-lg border p-4 transition-colors block"
            style={{ backgroundColor: "var(--surface)", borderColor: "var(--card-border)" }}>
            <div className="text-xs uppercase tracking-wider font-medium" style={{ color: "var(--text-secondary)" }}>Outstanding</div>
            <div className="text-xl font-bold mt-1" style={{ color: "var(--danger)" }}>{formatMoney(totalOwed, mainCurrency)}</div>
            <div className="text-xs mt-1" style={{ color: "var(--accent)" }}>Send reminder →</div>
          </Link>
        ) : (
          <div className="rounded-lg border p-4" style={{ backgroundColor: "var(--surface)", borderColor: "var(--card-border)" }}>
            <div className="text-xs uppercase tracking-wider font-medium" style={{ color: "var(--text-secondary)" }}>Outstanding</div>
            <div className="text-xl font-bold mt-1" style={{ color: "var(--accent)" }}>Paid up</div>
          </div>
        )}
        <div className="rounded-lg border p-4" style={{ backgroundColor: "var(--surface)", borderColor: "var(--card-border)" }}>
          <div className="text-xs uppercase tracking-wider font-medium" style={{ color: "var(--text-secondary)" }}>Next due</div>
          <div className="text-xl font-bold mt-1" style={{ color: "var(--text)" }}>
            {nextDue ? formatDate(nextDue.due_date!) : "—"}
          </div>
          {nextDue && (
            <div className="text-xs mt-1" style={{ color: "var(--text-secondary)" }}>{formatMoney(nextDue.remaining_paise, nextDue.currency)}</div>
          )}
        </div>
      </div>

      {/* Enrollments */}
      {student.enrollments.map((e) => {
        const enrollTotal = e.installments.reduce((s, i) => s + i.amount_due_paise, 0);
        const enrollPaid = e.installments.reduce((s, i) => s + (i.amount_due_paise - i.remaining_paise), 0);
        const pct = enrollTotal > 0 ? Math.round((enrollPaid / enrollTotal) * 100) : 0;
        return (
          <div key={e.id} className="rounded-lg border p-5 mb-4" style={{ backgroundColor: "var(--surface)", borderColor: "var(--card-border)" }}>
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="font-bold" style={{ color: "var(--text)" }}>{e.program}</div>
                <div className="text-xs" style={{ color: "var(--text-secondary)" }}>
                  Total: {formatMoney(enrollTotal, e.currency)}
                  {e.gst_applicable && " + GST"}
                </div>
              </div>
              <div className="text-sm font-medium" style={{ color: "var(--accent)" }}>{pct}% paid</div>
            </div>
            <div className="w-full rounded-full h-2 mb-4" style={{ backgroundColor: "var(--surface-hover)" }}>
              <div className="h-2 rounded-full" style={{
                width: `${pct}%`,
                backgroundColor: "var(--accent)",
              }} />
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs border-b" style={{ color: "var(--text-secondary)", borderColor: "var(--border)" }}>
                  <th className="pb-2 px-3 font-medium">Due date</th>
                  <th className="pb-2 px-3 font-medium text-right">Amount</th>
                  <th className="pb-2 px-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: "var(--border-subtle)" }}>
                {e.installments.map((i) => (
                  <tr key={i.id}>
                    <td className="py-2.5 px-3" style={{ color: "var(--text)" }}>{i.due_date ? formatDate(i.due_date) : "—"}</td>
                    <td className="py-2.5 px-3 text-right font-medium" style={{ color: "var(--text)" }}>{formatMoney(i.amount_due_paise, i.currency)}</td>
                    <td className="py-2.5 px-3">
                      <span className="px-2 py-0.5 rounded text-xs font-medium" style={statusStyle(i.status)}>
                        {i.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}

      {/* Payments */}
      <div className="rounded-lg border p-5" style={{ backgroundColor: "var(--surface)", borderColor: "var(--card-border)" }}>
        <h3 className="font-bold mb-3" style={{ color: "var(--text)" }}>Payment history</h3>
        {student.payments.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>No payments linked to this student yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs border-b" style={{ color: "var(--text-secondary)", borderColor: "var(--border)" }}>
                <th className="pb-2 px-3 font-medium">Date</th>
                <th className="pb-2 px-3 font-medium">Payer</th>
                <th className="pb-2 px-3 font-medium text-right">Amount</th>
                <th className="pb-2 px-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y" style={{ borderColor: "var(--border-subtle)" }}>
              {student.payments.map((p) => (
                <tr key={p.match_id}>
                  <td className="py-2.5 px-3" style={{ color: "var(--text)" }}>{formatDate(p.date)}</td>
                  <td className="py-2.5 px-3" style={{ color: "var(--text-secondary)" }}>{p.payer_name || "(blank)"}</td>
                  <td className="py-2.5 px-3 text-right font-medium" style={{ color: "var(--text)" }}>{formatMoney(p.amount_paid_paise, p.currency)}</td>
                  <td className="py-2.5 px-3">
                    {p.match_status === "pending_review" ? (
                      <Link href={`/review?id=${p.match_id}`}
                        className="px-2 py-0.5 rounded text-xs font-medium hover:underline"
                        style={matchStatusCss(p.match_status)}>
                        pending →
                      </Link>
                    ) : (
                      <span className="px-2 py-0.5 rounded text-xs font-medium" style={matchStatusCss(p.match_status)}>
                        {p.match_status === "auto" ? "auto-matched" : p.match_status === "approved" ? "approved" : p.match_status}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
