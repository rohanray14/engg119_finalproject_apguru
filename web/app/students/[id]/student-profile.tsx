"use client";

import { use } from "react";
import Link from "next/link";
import useSWR from "swr";
import { apiFetch } from "@/lib/api";
import { formatMoney, formatDate } from "@/lib/format";

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
  enrollments: Enrollment[]; payments: PaymentLink[];
}

function fetcher<T>(path: string) { return apiFetch<T>(path); }

const countryMap: Record<string, string> = {
  IN: "India", India: "India", US: "USA", USA: "USA", UK: "UK",
  UAE: "UAE", SG: "Singapore", Singapore: "Singapore",
};
const cityMap: Record<string, string> = {
  Bengaluru: "Bangalore", Bangalore: "Bangalore", Bombay: "Mumbai", Mumbai: "Mumbai",
  Calcutta: "Kolkata", Kolkata: "Kolkata", Madras: "Chennai", Chennai: "Chennai",
  DXB: "Dubai", Dubai: "Dubai",
};

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

export default function StudentProfile({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: student, isLoading } = useSWR<StudentData>(`/students/${id}`, fetcher);

  if (isLoading) {
    return (
      <div className="p-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-48" />
          <div className="h-64 bg-gray-200 rounded" />
        </div>
      </div>
    );
  }

  if (!student) {
    return (
      <div className="p-8">
        <Link href="/students" className="text-sm hover:underline" style={{ color: "var(--accent)" }}>
          &larr; Back to students
        </Link>
        <div className="mt-8 text-center text-gray-500">Student not found.</div>
      </div>
    );
  }

  const location = [
    cityMap[student.city ?? ""] ?? student.city,
    countryMap[student.country ?? ""] ?? student.country,
  ].filter(Boolean).join(", ") || "No location";

  const totalOwed = student.enrollments.reduce((sum, e) =>
    sum + e.installments.reduce((s, i) => s + i.remaining_paise, 0), 0);
  const totalFee = student.enrollments.reduce((sum, e) => sum + e.total_fee_paise, 0);
  const totalPaid = student.payments.reduce((sum, p) =>
    p.match_status === "approved" || p.match_status === "auto" ? sum + p.amount_paid_paise : sum, 0);
  const mainCurrency = student.enrollments[0]?.currency ?? "INR";

  return (
    <div className="p-8 max-w-4xl">
      <Link href="/students" className="text-sm hover:underline" style={{ color: "var(--accent)" }}>
        &larr; Back to students
      </Link>

      {/* Header */}
      <div className="mt-4 mb-6">
        <h1 className="text-3xl font-bold text-gray-900">{student.name}</h1>
        <p className="text-sm text-gray-500 mt-1">{location}</p>
        {student.aliases.length > 0 && (
          <p className="text-xs text-gray-400 mt-1">Also known as: {student.aliases.join(", ")}</p>
        )}
        {student.payer_aliases.length > 0 && (
          <p className="text-xs text-gray-400">Known payers: {student.payer_aliases.join(", ")}</p>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-lg border p-4" style={{ borderColor: "var(--card-border)" }}>
          <div className="text-xs text-gray-500 uppercase tracking-wider font-medium">Total fees</div>
          <div className="text-xl font-bold text-gray-900 mt-1">{formatMoney(totalFee, mainCurrency)}</div>
        </div>
        <div className="bg-white rounded-lg border p-4" style={{ borderColor: "var(--card-border)" }}>
          <div className="text-xs text-gray-500 uppercase tracking-wider font-medium">Paid</div>
          <div className="text-xl font-bold mt-1" style={{ color: "var(--accent)" }}>{formatMoney(totalPaid, mainCurrency)}</div>
        </div>
        <div className="bg-white rounded-lg border p-4" style={{ borderColor: "var(--card-border)" }}>
          <div className="text-xs text-gray-500 uppercase tracking-wider font-medium">Outstanding</div>
          <div className={`text-xl font-bold mt-1 ${totalOwed > 0 ? "text-red-600" : "text-green-600"}`}>
            {totalOwed > 0 ? formatMoney(totalOwed, mainCurrency) : "Paid up"}
          </div>
        </div>
      </div>

      {/* Enrollments */}
      {student.enrollments.map((e) => {
        const enrollPaid = e.installments.reduce((s, i) => s + (i.amount_due_paise - i.remaining_paise), 0);
        const pct = e.total_fee_paise > 0 ? Math.round((enrollPaid / e.total_fee_paise) * 100) : 0;
        return (
          <div key={e.id} className="bg-white rounded-lg border p-5 mb-4" style={{ borderColor: "var(--card-border)" }}>
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="font-bold text-gray-900">{e.program}</div>
                <div className="text-xs text-gray-500">
                  {e.fee_model === "package" ? "Package" : "Hourly"} · Total: {formatMoney(e.total_fee_paise, e.currency)}
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
