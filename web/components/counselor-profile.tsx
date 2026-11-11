"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { apiFetch } from "@/lib/api";
import { formatMoney, formatDate, displayLocation } from "@/lib/format";

interface StudentEnrollment {
  program: string; fee_model: string; total_fee_paise: number; currency: string;
  enrolled_around: string | null;
}
interface CounselorStudent {
  id: number; name: string; city: string | null; country: string | null;
  enrollments: StudentEnrollment[];
}
interface CommissionLine {
  id: number; payment_id: number; date: string; payer_name: string | null;
  currency: string; base_paise: number; rate: number;
  commission_paise: number; tds_paise: number; net_paise: number;
}
interface CurrencyTotal {
  currency: string; earned_paise: number; tds_paise: number; net_paise: number; lines: number;
}
interface Payout {
  id: number; approved_at: string; actor: string; currency: string; net_paise: number;
}
interface CounselorData {
  id: number; name: string; terms_text: string;
  rule: { rate: number; scope: string; city: string | null; split: number | null; source: string };
  students: CounselorStudent[];
  commission_lines: CommissionLine[];
  totals: CurrencyTotal[];
  payouts: Payout[];
  total_paid_out: { currency: string; net_paise: number }[];
}

function fetcher<T>(path: string) { return apiFetch<T>(path); }

function ruleText(rule: CounselorData["rule"]): string {
  if (rule.rate <= 0) return rule.source === "none" ? "No terms provided" : "Rate not stated";
  let text = `${(rule.rate * 100).toFixed(0)}% on fees`;
  if (rule.scope === "city" && rule.city) text += ` from ${rule.city} students`;
  else if (rule.scope === "own_referrals") text += " from referred students";
  if (rule.split) text += `, split ${(rule.split * 100).toFixed(0)}/${((1 - rule.split) * 100).toFixed(0)}`;
  return text;
}

interface Props {
  counselorId: number;
  onBack: () => void;
}

export default function CounselorProfile({ counselorId, onBack }: Props) {
  const { data: counselor, isLoading, mutate } = useSWR<CounselorData>(`/counselors/${counselorId}`, fetcher);
  const [payoutStatus, setPayoutStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [payoutMsg, setPayoutMsg] = useState("");

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-gray-200 rounded w-48" />
        <div className="h-64 bg-gray-200 rounded" />
      </div>
    );
  }

  if (!counselor) {
    return (
      <div>
        <button onClick={onBack} className="text-sm hover:underline" style={{ color: "var(--accent)" }}>
          &larr; Back to commissions
        </button>
        <div className="mt-8 text-center text-gray-500">Counselor not found.</div>
      </div>
    );
  }

  const inr = counselor.totals.find((t) => t.currency === "INR");
  const paidOut = counselor.total_paid_out.find((t) => t.currency === "INR")?.net_paise ?? 0;
  const netOwed = (inr?.net_paise ?? 0) - paidOut;

  async function handleApprovePayout() {
    if (netOwed <= 0) return;
    setPayoutStatus("loading");
    try {
      await apiFetch("/commissions/payout/approve", {
        method: "POST",
        body: { currency: "INR", expected_payable_paise: netOwed },
      });
      setPayoutStatus("success");
      setPayoutMsg(`Payout of ${formatMoney(netOwed, "INR")} approved and logged.`);
      mutate();
    } catch (e: unknown) {
      setPayoutStatus("error");
      setPayoutMsg(e instanceof Error ? e.message : "Failed to approve payout. This is a prototype — the action has been recorded in the audit log.");
    }
  }

  // Compute action items
  const now = new Date();
  const actionItems: { severity: "high" | "medium" | "low"; text: string }[] = [];

  // Check for overdue unpaid commissions
  if (netOwed > 0 && counselor.commission_lines.length > 0) {
    const oldest = counselor.commission_lines[counselor.commission_lines.length - 1]; // sorted desc
    if (oldest.date) {
      const oldestDate = new Date(oldest.date);
      const monthsAgo = Math.floor((now.getTime() - oldestDate.getTime()) / (1000 * 60 * 60 * 24 * 30));
      if (monthsAgo >= 6) {
        actionItems.push({
          severity: "high",
          text: `Commission of ${formatMoney(netOwed, "INR")} unpaid for ${monthsAgo} months (since ${formatDate(oldest.date)}). Approve payout urgently.`,
        });
      } else if (monthsAgo >= 3) {
        actionItems.push({
          severity: "medium",
          text: `Commission pending for ${monthsAgo} months. Consider approving payout.`,
        });
      }
    }
  }

  // Check for students with no matched payments
  const studentsWithPayments = new Set(counselor.commission_lines.map((l) => l.payer_name));
  const studentsNoPayment = counselor.students.filter(
    (s) => s.enrollments.length > 0 && !counselor.commission_lines.some((l) => l.payment_id)
  );
  if (studentsNoPayment.length > 0 && counselor.students.length > 0) {
    const pct = Math.round((1 - counselor.commission_lines.length / counselor.students.length) * 100);
    if (pct > 50) {
      actionItems.push({
        severity: "medium",
        text: `Only ${counselor.commission_lines.length} of ${counselor.students.length} referred students have matched payments. ${pct}% of referrals haven't generated commission yet.`,
      });
    }
  }

  // Check if rate needs setting
  if (counselor.rule.rate <= 0) {
    actionItems.push({
      severity: "high",
      text: "No commission rate set. Set the rate on the Commissions page before payouts can be calculated.",
    });
  }

  return (
    <div>
      <button onClick={onBack} className="text-sm hover:underline" style={{ color: "var(--accent)" }}>
        &larr; Back to commissions
      </button>

      {/* Header */}
      <div className="mt-4 mb-6">
        <h1 className="text-3xl font-bold text-gray-900">{counselor.name}</h1>
        <p className="text-sm text-gray-500 mt-1">{ruleText(counselor.rule)}</p>
        {counselor.terms_text && (
          <p className="text-xs text-gray-400 mt-1 italic">&ldquo;{counselor.terms_text}&rdquo;</p>
        )}
        <div className="mt-2">
          <span className={`px-2 py-0.5 rounded text-xs font-medium ${
            counselor.rule.source === "finance_lead"
              ? "bg-green-100 text-green-800"
              : counselor.rule.source === "parsed_from_terms"
              ? "bg-blue-100 text-blue-800"
              : "bg-amber-100 text-amber-800"
          }`}>
            {counselor.rule.source === "finance_lead"
              ? "Rate set by finance lead"
              : counselor.rule.source === "parsed_from_terms"
              ? "Auto-parsed from terms"
              : "Needs rate set"}
          </span>
        </div>
      </div>

      {/* Action items */}
      {actionItems.length > 0 && (
        <div className="mb-6 space-y-2">
          {actionItems.map((item, i) => (
            <div key={i} className={`rounded-lg border p-3 text-sm flex items-start gap-2 ${
              item.severity === "high"
                ? "bg-red-50 border-red-200 text-red-800"
                : item.severity === "medium"
                ? "bg-amber-50 border-amber-200 text-amber-800"
                : "bg-blue-50 border-blue-200 text-blue-800"
            }`}>
              <span className="font-bold shrink-0">
                {item.severity === "high" ? "!" : item.severity === "medium" ? "!" : "i"}
              </span>
              <span>{item.text}</span>
              {item.severity === "high" && netOwed > 0 && item.text.includes("payout") && (
                <button
                  onClick={handleApprovePayout}
                  disabled={payoutStatus === "loading" || payoutStatus === "success"}
                  className="shrink-0 ml-auto underline font-medium disabled:opacity-50"
                >
                  {payoutStatus === "loading" ? "Approving..." : payoutStatus === "success" ? "Approved" : "Approve payout"}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {payoutStatus === "success" && (
        <div className="mb-4 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">
          {payoutMsg}
        </div>
      )}
      {payoutStatus === "error" && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {payoutMsg}
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-lg border p-4" style={{ borderColor: "var(--card-border)" }}>
          <div className="text-xs text-gray-500 uppercase tracking-wider font-medium">Students referred</div>
          <div className="text-xl font-bold text-gray-900 mt-1">{counselor.students.length}</div>
        </div>
        <div className="bg-white rounded-lg border p-4" style={{ borderColor: "var(--card-border)" }}>
          <div className="text-xs text-gray-500 uppercase tracking-wider font-medium">Commission earned</div>
          <div className="text-xl font-bold mt-1" style={{ color: "var(--accent)" }}>
            {inr ? formatMoney(inr.earned_paise, "INR") : "—"}
          </div>
        </div>
        <div className="bg-white rounded-lg border p-4" style={{ borderColor: "var(--card-border)" }}>
          <div className="text-xs text-gray-500 uppercase tracking-wider font-medium">TDS withheld (2%)</div>
          <div className="text-xl font-bold text-gray-900 mt-1">
            {inr ? formatMoney(inr.tds_paise, "INR") : "—"}
          </div>
        </div>
        <button
          onClick={handleApprovePayout}
          disabled={payoutStatus === "loading" || payoutStatus === "success" || netOwed <= 0}
          className="bg-white rounded-lg border p-4 hover:border-red-300 transition-colors text-left disabled:opacity-70"
          style={{ borderColor: "var(--card-border)" }}>
          <div className="text-xs text-gray-500 uppercase tracking-wider font-medium">Still owed</div>
          <div className={`text-xl font-bold mt-1 ${netOwed > 0 ? "text-red-600" : "text-green-600"}`}>
            {netOwed > 0 ? formatMoney(netOwed, "INR") : "Settled"}
          </div>
          {netOwed > 0 && (
            <div className="text-xs mt-1" style={{ color: "var(--accent)" }}>
              {payoutStatus === "loading" ? "Approving..." : payoutStatus === "success" ? "Approved!" : "Approve payout →"}
            </div>
          )}
        </button>
      </div>

      {/* Referred students */}
      <div className="bg-white rounded-lg border p-5 mb-4" style={{ borderColor: "var(--card-border)" }}>
        <h3 className="font-bold text-gray-900 mb-3">
          Referred students
          <span className="text-sm font-normal text-gray-500 ml-2">{counselor.students.length} students</span>
        </h3>
        {counselor.students.length === 0 ? (
          <p className="text-sm text-gray-500">No students linked to this counselor.</p>
        ) : (
          <table className="w-full text-sm table-fixed">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b" style={{ borderColor: "var(--card-border)" }}>
                <th className="pb-2 font-medium w-[18%]">Student</th>
                <th className="pb-2 font-medium w-[18%]">Location</th>
                <th className="pb-2 font-medium w-[16%]">Program</th>
                <th className="pb-2 font-medium w-[10%]">Type</th>
                <th className="pb-2 font-medium text-right w-[16%]">Total fee</th>
                <th className="pb-2 font-medium w-[22%] pl-6">Enrolled around</th>
              </tr>
            </thead>
            <tbody className="divide-y" style={{ borderColor: "var(--card-border)" }}>
              {counselor.students.map((s) => {
                const location = displayLocation(s.city, s.country);
                if (s.enrollments.length === 0) {
                  return (
                    <tr key={s.id}>
                      <td className="py-2.5 font-medium hover:underline" style={{ color: "var(--accent)" }}>
                        <Link href={`/students?id=${s.id}`}>{s.name}</Link>
                      </td>
                      <td className="py-2.5 text-gray-600">{location}</td>
                      <td className="py-2.5 text-gray-400" colSpan={4}>No enrollments</td>
                    </tr>
                  );
                }
                return s.enrollments.map((e, ei) => (
                  <tr key={`${s.id}-${ei}`}>
                    {ei === 0 ? (
                      <>
                        <td className="py-2.5 font-medium hover:underline" style={{ color: "var(--accent)" }}
                          rowSpan={s.enrollments.length}>
                          <Link href={`/students?id=${s.id}`}>{s.name}</Link>
                        </td>
                        <td className="py-2.5 text-gray-600" rowSpan={s.enrollments.length}>{location}</td>
                      </>
                    ) : null}
                    <td className="py-2.5 text-gray-900">{e.program}</td>
                    <td className="py-2.5">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                        e.fee_model === "package" ? "bg-blue-50 text-blue-700" : "bg-purple-50 text-purple-700"
                      }`}>
                        {e.fee_model === "package" ? "Package" : "Hourly"}
                      </span>
                    </td>
                    <td className="py-2.5 text-right font-medium">{formatMoney(e.total_fee_paise, e.currency)}</td>
                    <td className="py-2.5 text-gray-600 pl-6">{e.enrolled_around ? formatDate(e.enrolled_around) : "—"}</td>
                  </tr>
                ));
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Commission lines */}
      <div className="bg-white rounded-lg border p-5 mb-4" style={{ borderColor: "var(--card-border)" }}>
        <h3 className="font-bold text-gray-900 mb-3">
          Commission lines
          <span className="text-sm font-normal text-gray-500 ml-2">
            {counselor.commission_lines.length} payments
          </span>
        </h3>
        {counselor.commission_lines.length === 0 ? (
          <p className="text-sm text-gray-500">No commissions calculated yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b" style={{ borderColor: "var(--card-border)" }}>
                <th className="pb-2 font-medium">Date</th>
                <th className="pb-2 font-medium">Payer</th>
                <th className="pb-2 font-medium text-right">Fee collected</th>
                <th className="pb-2 font-medium text-right">Rate</th>
                <th className="pb-2 font-medium text-right">Commission</th>
                <th className="pb-2 font-medium text-right">TDS</th>
                <th className="pb-2 font-medium text-right">Net</th>
              </tr>
            </thead>
            <tbody className="divide-y" style={{ borderColor: "var(--card-border)" }}>
              {counselor.commission_lines.map((line) => (
                <tr key={line.id}>
                  <td className="py-2.5">{line.date ? formatDate(line.date) : "—"}</td>
                  <td className="py-2.5 text-gray-700">{line.payer_name || "(blank)"}</td>
                  <td className="py-2.5 text-right">{formatMoney(line.base_paise, line.currency)}</td>
                  <td className="py-2.5 text-right">{(line.rate * 100).toFixed(0)}%</td>
                  <td className="py-2.5 text-right">{formatMoney(line.commission_paise, line.currency)}</td>
                  <td className="py-2.5 text-right text-gray-500">{formatMoney(line.tds_paise, line.currency)}</td>
                  <td className="py-2.5 text-right font-medium">{formatMoney(line.net_paise, line.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Payout history */}
      {counselor.payouts.length > 0 && (
        <div className="bg-white rounded-lg border p-5" style={{ borderColor: "var(--card-border)" }}>
          <h3 className="font-bold text-gray-900 mb-3">Payout history</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b" style={{ borderColor: "var(--card-border)" }}>
                <th className="pb-2 font-medium">Approved</th>
                <th className="pb-2 font-medium">By</th>
                <th className="pb-2 font-medium text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y" style={{ borderColor: "var(--card-border)" }}>
              {counselor.payouts.map((p) => (
                <tr key={`${p.id}-${p.currency}`}>
                  <td className="py-2.5">{formatDate(p.approved_at)}</td>
                  <td className="py-2.5 text-gray-700">{p.actor}</td>
                  <td className="py-2.5 text-right font-medium">{formatMoney(p.net_paise, p.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
