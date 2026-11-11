"use client";

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

function statusColor(status: string) {
  switch (status) {
    case "paid": return "bg-green-100 text-green-800";
    case "partial": return "bg-blue-100 text-blue-800";
    case "overdue": return "bg-red-100 text-red-800";
    default: return "bg-gray-100 text-gray-700";
  }
}

function matchStatusStyle(status: string) {
  switch (status) {
    case "approved": case "auto": return "bg-green-100 text-green-800";
    case "pending_review": return "bg-amber-100 text-amber-800";
    default: return "bg-gray-100 text-gray-700";
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
        <div className="h-8 bg-gray-200 rounded w-48" />
        <div className="h-64 bg-gray-200 rounded" />
      </div>
    );
  }

  if (!student) {
    return (
      <div>
        <button onClick={onBack} className="text-sm hover:underline" style={{ color: "var(--accent)" }}>
          &larr; Back to students
        </button>
        <div className="mt-8 text-center text-gray-500">Student not found.</div>
      </div>
    );
  }

  const location = displayLocation(student.city, student.country);

  const totalOwed = student.enrollments.reduce((sum, e) =>
    sum + e.installments.reduce((s, i) => s + i.remaining_paise, 0), 0);
  const totalFee = student.enrollments.reduce((sum, e) =>
    sum + e.installments.reduce((s, i) => s + i.amount_due_paise, 0), 0);
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
        <h1 className="text-3xl font-bold text-gray-900">{student.name}</h1>
        <p className="text-sm text-gray-500 mt-1">{location}</p>
        {/* Contact info */}
        {(student.parent_name || student.parent_phone || student.parent_email) && (
          <div className="mt-3 flex items-center gap-4 text-sm">
            {student.parent_name && (
              <span className="text-gray-600">
                <span className="text-gray-400 text-xs uppercase tracking-wider mr-1">Parent:</span>
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
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-lg border p-4" style={{ borderColor: "var(--card-border)" }}>
          <div className="text-xs text-gray-500 uppercase tracking-wider font-medium">Total fees</div>
          <div className="text-xl font-bold text-gray-900 mt-1">{formatMoney(totalFee, mainCurrency)}</div>
        </div>
        <div className="bg-white rounded-lg border p-4" style={{ borderColor: "var(--card-border)" }}>
          <div className="text-xs text-gray-500 uppercase tracking-wider font-medium">Paid</div>
          <div className="text-xl font-bold mt-1" style={{ color: "var(--accent)" }}>{formatMoney(totalPaid, mainCurrency)}</div>
        </div>
        {totalOwed > 0 ? (
          <Link href={`/reminders?student=${encodeURIComponent(student.name)}`}
            className="bg-white rounded-lg border p-4 hover:border-red-300 transition-colors block"
            style={{ borderColor: "var(--card-border)" }}>
            <div className="text-xs text-gray-500 uppercase tracking-wider font-medium">Outstanding</div>
            <div className="text-xl font-bold mt-1 text-red-600">{formatMoney(totalOwed, mainCurrency)}</div>
            <div className="text-xs mt-1" style={{ color: "var(--accent)" }}>Send reminder →</div>
          </Link>
        ) : (
          <div className="bg-white rounded-lg border p-4" style={{ borderColor: "var(--card-border)" }}>
            <div className="text-xs text-gray-500 uppercase tracking-wider font-medium">Outstanding</div>
            <div className="text-xl font-bold mt-1 text-green-600">Paid up</div>
          </div>
        )}
        <div className="bg-white rounded-lg border p-4" style={{ borderColor: "var(--card-border)" }}>
          <div className="text-xs text-gray-500 uppercase tracking-wider font-medium">Next due</div>
          <div className="text-xl font-bold text-gray-900 mt-1">
            {nextDue ? formatDate(nextDue.due_date!) : "—"}
          </div>
          {nextDue && (
            <div className="text-xs text-gray-500 mt-1">{formatMoney(nextDue.remaining_paise, nextDue.currency)}</div>
          )}
        </div>
      </div>

      {/* Enrollments */}
      {student.enrollments.map((e) => {
        const enrollTotal = e.installments.reduce((s, i) => s + i.amount_due_paise, 0);
        const enrollPaid = e.installments.reduce((s, i) => s + (i.amount_due_paise - i.remaining_paise), 0);
        const pct = enrollTotal > 0 ? Math.round((enrollPaid / enrollTotal) * 100) : 0;
        return (
          <div key={e.id} className="bg-white rounded-lg border p-5 mb-4" style={{ borderColor: "var(--card-border)" }}>
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="font-bold text-gray-900">{e.program}</div>
                <div className="text-xs text-gray-500">
                  Total: {formatMoney(enrollTotal, e.currency)}
                  {e.gst_applicable && " + GST"}
                </div>
              </div>
              <div className="text-sm font-medium" style={{ color: "var(--accent)" }}>{pct}% paid</div>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2 mb-4">
              <div className="h-2 rounded-full" style={{
                width: `${pct}%`,
                backgroundColor: pct === 100 ? "#16a34a" : "var(--accent)",
              }} />
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b" style={{ borderColor: "var(--card-border)" }}>
                  <th className="pb-2 font-medium">Due date</th>
                  <th className="pb-2 font-medium text-right">Amount</th>
                  <th className="pb-2 font-medium text-right">Remaining</th>
                  <th className="pb-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: "var(--card-border)" }}>
                {e.installments.map((i) => (
                  <tr key={i.id}>
                    <td className="py-2.5">{i.due_date ? formatDate(i.due_date) : "—"}</td>
                    <td className="py-2.5 text-right font-medium">{formatMoney(i.amount_due_paise, i.currency)}</td>
                    <td className="py-2.5 text-right">
                      {i.remaining_paise > 0
                        ? formatMoney(i.remaining_paise, i.currency)
                        : <span className="text-green-600">—</span>}
                    </td>
                    <td className="py-2.5">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusColor(i.status)}`}>
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
      <div className="bg-white rounded-lg border p-5" style={{ borderColor: "var(--card-border)" }}>
        <h3 className="font-bold text-gray-900 mb-3">Payment history</h3>
        {student.payments.length === 0 ? (
          <p className="text-sm text-gray-500">No payments linked to this student yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b" style={{ borderColor: "var(--card-border)" }}>
                <th className="pb-2 font-medium">Date</th>
                <th className="pb-2 font-medium">Payer</th>
                <th className="pb-2 font-medium text-right">Amount</th>
                <th className="pb-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y" style={{ borderColor: "var(--card-border)" }}>
              {student.payments.map((p) => (
                <tr key={p.match_id}>
                  <td className="py-2.5">{formatDate(p.date)}</td>
                  <td className="py-2.5 text-gray-700">{p.payer_name || "(blank)"}</td>
                  <td className="py-2.5 text-right font-medium">{formatMoney(p.amount_paid_paise, p.currency)}</td>
                  <td className="py-2.5">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${matchStatusStyle(p.match_status)}`}>
                      {p.match_status === "auto" ? "auto-matched" : p.match_status === "approved" ? "approved" : p.match_status === "pending_review" ? "pending" : p.match_status}
                    </span>
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
