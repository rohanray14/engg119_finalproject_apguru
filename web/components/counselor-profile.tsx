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
  const { data: counselor, isLoading } = useSWR<CounselorData>(`/counselors/${counselorId}`, fetcher);
  const [tab, setTab] = useState<"students" | "commissions" | "payouts">("students");

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 rounded w-48" style={{ backgroundColor: "var(--surface)" }} />
        <div className="h-64 rounded" style={{ backgroundColor: "var(--surface)" }} />
      </div>
    );
  }

  if (!counselor) {
    return (
      <div>
        <button onClick={onBack} className="text-sm hover:underline" style={{ color: "var(--accent)" }}>
          &larr; Back to commissions
        </button>
        <div className="mt-8 text-center" style={{ color: "var(--text-secondary)" }}>Counselor not found.</div>
      </div>
    );
  }

  const inr = counselor.totals.find((t) => t.currency === "INR");
  const paidOut = counselor.total_paid_out.find((t) => t.currency === "INR")?.net_paise ?? 0;
  const netOwed = (inr?.net_paise ?? 0) - paidOut;

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
        <h1 className="text-3xl font-bold" style={{ color: "var(--text)" }}>{counselor.name}</h1>
        <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>{ruleText(counselor.rule)}</p>
        {counselor.terms_text && (
          <p className="text-xs mt-1 italic" style={{ color: "var(--text-tertiary)" }}>&ldquo;{counselor.terms_text}&rdquo;</p>
        )}
        <div className="mt-2">
          <span className="px-2 py-0.5 rounded text-xs font-medium" style={
            counselor.rule.source === "finance_lead"
              ? { backgroundColor: "rgba(0,220,130,0.15)", color: "var(--accent)" }
              : counselor.rule.source === "parsed_from_terms"
              ? { backgroundColor: "rgba(77,158,255,0.15)", color: "var(--info)" }
              : { backgroundColor: "rgba(255,176,32,0.15)", color: "var(--warning)" }
          }>
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
            <div key={i} className="rounded-lg border p-3 text-sm flex items-start gap-2" style={
              item.severity === "high"
                ? { backgroundColor: "rgba(255,77,77,0.08)", borderColor: "rgba(255,77,77,0.3)", color: "var(--danger)" }
                : item.severity === "medium"
                ? { backgroundColor: "rgba(255,176,32,0.08)", borderColor: "rgba(255,176,32,0.3)", color: "var(--warning)" }
                : { backgroundColor: "rgba(77,158,255,0.08)", borderColor: "rgba(77,158,255,0.3)", color: "var(--info)" }
            }>
              <span className="font-bold shrink-0">
                {item.severity === "high" ? "!" : item.severity === "medium" ? "!" : "i"}
              </span>
              <span>{item.text}</span>
            </div>
          ))}
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="rounded-lg border p-4" style={{ backgroundColor: "var(--surface)", borderColor: "var(--card-border)" }}>
          <div className="text-xs uppercase tracking-wider font-medium" style={{ color: "var(--text-secondary)" }}>Students referred</div>
          <div className="text-xl font-bold mt-1" style={{ color: "var(--text)" }}>{counselor.students.length}</div>
        </div>
        <div className="rounded-lg border p-4" style={{ backgroundColor: "var(--surface)", borderColor: "var(--card-border)" }}>
          <div className="text-xs uppercase tracking-wider font-medium" style={{ color: "var(--text-secondary)" }}>Commission earned</div>
          <div className="text-xl font-bold mt-1" style={{ color: "var(--accent)" }}>
            {inr ? formatMoney(inr.earned_paise, "INR") : "—"}
          </div>
        </div>
        <div className="rounded-lg border p-4" style={{ backgroundColor: "var(--surface)", borderColor: "var(--card-border)" }}>
          <div className="text-xs uppercase tracking-wider font-medium" style={{ color: "var(--text-secondary)" }}>TDS withheld (2%)</div>
          <div className="text-xl font-bold mt-1" style={{ color: "var(--text)" }}>
            {inr ? formatMoney(inr.tds_paise, "INR") : "—"}
          </div>
        </div>
        <div className="rounded-lg border p-4" style={{ backgroundColor: "var(--surface)", borderColor: "var(--card-border)" }}>
          <div className="text-xs uppercase tracking-wider font-medium" style={{ color: "var(--text-secondary)" }}>Still owed</div>
          <div className="text-xl font-bold mt-1" style={{ color: netOwed > 0 ? "var(--danger)" : "var(--accent)" }}>
            {netOwed > 0 ? formatMoney(netOwed, "INR") : "Settled"}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b mb-4" style={{ borderColor: "var(--card-border)" }}>
        {([
          ["students", `Students (${counselor.students.length})`],
          ["commissions", `Commissions (${counselor.commission_lines.length})`],
          ["payouts", `Payouts (${counselor.payouts.length})`],
        ] as const).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className="px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px"
            style={{
              borderBottomColor: tab === key ? "var(--text)" : "transparent",
              color: tab === key ? "var(--text)" : "var(--text-secondary)",
            }}>
            {label}
          </button>
        ))}
      </div>

      {/* Referred students */}
      {tab === "students" && (
      <div className="rounded-lg border p-5 mb-4" style={{ backgroundColor: "var(--surface)", borderColor: "var(--card-border)" }}>
        {counselor.students.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>No students linked to this counselor.</p>
        ) : (
          <table className="w-full text-sm table-fixed">
            <thead>
              <tr className="text-left text-xs border-b" style={{ color: "var(--text-secondary)", borderColor: "var(--border)" }}>
                <th className="pb-2 font-medium w-[18%]">Student</th>
                <th className="pb-2 font-medium w-[18%]">Location</th>
                <th className="pb-2 font-medium w-[16%]">Program</th>
                <th className="pb-2 font-medium w-[10%]">Type</th>
                <th className="pb-2 font-medium text-right w-[16%]">Total fee</th>
                <th className="pb-2 font-medium w-[22%] pl-6">Enrolled around</th>
              </tr>
            </thead>
            <tbody className="divide-y" style={{ borderColor: "var(--border-subtle)" }}>
              {counselor.students.map((s) => {
                const location = displayLocation(s.city, s.country);
                if (s.enrollments.length === 0) {
                  return (
                    <tr key={s.id}>
                      <td className="py-2.5 font-medium hover:underline" style={{ color: "var(--accent)" }}>
                        <Link href={`/students?id=${s.id}`}>{s.name}</Link>
                      </td>
                      <td className="py-2.5" style={{ color: "var(--text-secondary)" }}>{location}</td>
                      <td className="py-2.5" style={{ color: "var(--text-tertiary)" }} colSpan={4}>No enrollments</td>
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
                        <td className="py-2.5" style={{ color: "var(--text-secondary)" }} rowSpan={s.enrollments.length}>{location}</td>
                      </>
                    ) : null}
                    <td className="py-2.5" style={{ color: "var(--text)" }}>{e.program}</td>
                    <td className="py-2.5">
                      <span className="px-2 py-0.5 rounded text-xs font-medium" style={
                        e.fee_model === "package"
                          ? { backgroundColor: "rgba(77,158,255,0.15)", color: "var(--info)" }
                          : { backgroundColor: "rgba(139,92,246,0.15)", color: "#a78bfa" }
                      }>
                        {e.fee_model === "package" ? "Package" : "Hourly"}
                      </span>
                    </td>
                    <td className="py-2.5 text-right font-medium" style={{ color: "var(--text)" }}>{formatMoney(e.total_fee_paise, e.currency)}</td>
                    <td className="py-2.5 pl-6" style={{ color: "var(--text-secondary)" }}>{e.enrolled_around ? formatDate(e.enrolled_around) : "—"}</td>
                  </tr>
                ));
              })}
            </tbody>
          </table>
        )}
      </div>

      )}

      {/* Commission lines */}
      {tab === "commissions" && (
      <div className="rounded-lg border p-5 mb-4" style={{ backgroundColor: "var(--surface)", borderColor: "var(--card-border)" }}>
        {counselor.commission_lines.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>No commissions calculated yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs border-b" style={{ color: "var(--text-secondary)", borderColor: "var(--border)" }}>
                <th className="pb-2 font-medium">Date</th>
                <th className="pb-2 font-medium">Payer</th>
                <th className="pb-2 font-medium text-right">Fee collected</th>
                <th className="pb-2 font-medium text-right">Rate</th>
                <th className="pb-2 font-medium text-right">Commission</th>
                <th className="pb-2 font-medium text-right">TDS</th>
                <th className="pb-2 font-medium text-right">Net</th>
              </tr>
            </thead>
            <tbody className="divide-y" style={{ borderColor: "var(--border-subtle)" }}>
              {counselor.commission_lines.map((line) => (
                <tr key={line.id}>
                  <td className="py-2.5" style={{ color: "var(--text)" }}>{line.date ? formatDate(line.date) : "—"}</td>
                  <td className="py-2.5" style={{ color: "var(--text-secondary)" }}>{line.payer_name || "(blank)"}</td>
                  <td className="py-2.5 text-right" style={{ color: "var(--text)" }}>{formatMoney(line.base_paise, line.currency)}</td>
                  <td className="py-2.5 text-right" style={{ color: "var(--text)" }}>{(line.rate * 100).toFixed(0)}%</td>
                  <td className="py-2.5 text-right" style={{ color: "var(--text)" }}>{formatMoney(line.commission_paise, line.currency)}</td>
                  <td className="py-2.5 text-right" style={{ color: "var(--text-secondary)" }}>{formatMoney(line.tds_paise, line.currency)}</td>
                  <td className="py-2.5 text-right font-medium" style={{ color: "var(--text)" }}>{formatMoney(line.net_paise, line.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      )}

      {/* Payout history */}
      {tab === "payouts" && (
        counselor.payouts.length === 0 ? (
          <div className="rounded-lg border p-8 text-center" style={{ backgroundColor: "var(--surface)", borderColor: "var(--card-border)" }}>
            <p style={{ color: "var(--text-secondary)" }}>No payouts approved yet.</p>
          </div>
        ) : (
          <div className="rounded-lg border p-5" style={{ backgroundColor: "var(--surface)", borderColor: "var(--card-border)" }}>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs border-b" style={{ color: "var(--text-secondary)", borderColor: "var(--border)" }}>
                  <th className="pb-2 font-medium">Approved</th>
                  <th className="pb-2 font-medium">By</th>
                  <th className="pb-2 font-medium text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: "var(--border-subtle)" }}>
                {counselor.payouts.map((p) => (
                  <tr key={`${p.id}-${p.currency}`}>
                    <td className="py-2.5" style={{ color: "var(--text)" }}>{formatDate(p.approved_at)}</td>
                    <td className="py-2.5" style={{ color: "var(--text-secondary)" }}>{p.actor}</td>
                    <td className="py-2.5 text-right font-medium" style={{ color: "var(--text)" }}>{formatMoney(p.net_paise, p.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  );
}
