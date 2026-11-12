"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import useSWR from "swr";
import { apiFetch } from "@/lib/api";
import { formatMoney, formatDate, displayLocation } from "@/lib/format";
import { useAppUser } from "@/app/providers";

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
  let text = `${(rule.rate * 100).toFixed(0)}% commission`;
  if (rule.scope === "city" && rule.city) text += ` on all ${rule.city} students`;
  else if (rule.scope === "own_referrals") text += " on own referrals only";
  else text += " on all students";
  if (rule.split) text += ` (${(rule.split * 100).toFixed(0)}/${((1 - rule.split) * 100).toFixed(0)} co-referral split)`;
  return text;
}

interface Props {
  counselorId: number;
  onBack: () => void;
}

interface SearchResult {
  id: number; name: string; city: string | null; country: string | null; already_linked: boolean;
}

export default function CounselorProfile({ counselorId, onBack }: Props) {
  const { user } = useAppUser();
  const canApprove = user?.can_approve ?? false;
  const { data: counselor, isLoading, mutate } = useSWR<CounselorData>(`/counselors/${counselorId}`, fetcher);
  const [tab, setTab] = useState<"students" | "commissions" | "payouts">("students");
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Debounced student search
  useEffect(() => {
    if (!searchQuery || searchQuery.length < 2) { setSearchResults([]); return; }
    const t = setTimeout(async () => {
      try {
        const res = await apiFetch<{ results: SearchResult[] }>(
          `/counselors/${counselorId}/search-students?q=${encodeURIComponent(searchQuery)}`
        );
        setSearchResults(res.results);
      } catch { setSearchResults([]); }
    }, 300);
    return () => clearTimeout(t);
  }, [searchQuery, counselorId]);

  // Focus search input when shown
  useEffect(() => {
    if (showSearch) searchRef.current?.focus();
  }, [showSearch]);

  async function linkStudent(studentId: number) {
    setActing(true);
    setError(null);
    try {
      await apiFetch(`/counselors/${counselorId}/link-student`, {
        method: "POST", body: { student_id: studentId },
      });
      setSearchQuery("");
      setSearchResults([]);
      mutate();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setActing(false);
    }
  }

  async function unlinkStudent(studentId: number) {
    setActing(true);
    setError(null);
    try {
      await apiFetch(`/counselors/${counselorId}/unlink-student`, {
        method: "POST", body: { student_id: studentId },
      });
      mutate();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setActing(false);
    }
  }

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

  // Check for referred students with no commission lines (per-student check)
  const studentIdsWithCommission = new Set(
    counselor.commission_lines.map((l) => l.payment_id)
  );
  const studentsWithEnrollments = counselor.students.filter((s) => s.enrollments.length > 0);
  // A student has "generated commission" if any commission line exists for this counselor
  // We can't map payment→student directly, so use count-based heuristic
  if (studentsWithEnrollments.length > 0 && counselor.commission_lines.length < studentsWithEnrollments.length) {
    const gap = studentsWithEnrollments.length - counselor.commission_lines.length;
    if (gap > 0) {
      actionItems.push({
        severity: "medium",
        text: `${counselor.commission_lines.length} commission lines for ${studentsWithEnrollments.length} enrolled students. Some referrals may not have matched payments yet.`,
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

  // Commission line totals
  const lineTotals = counselor.commission_lines.reduce(
    (acc, l) => ({
      base_paise: acc.base_paise + l.base_paise,
      commission_paise: acc.commission_paise + l.commission_paise,
      tds_paise: acc.tds_paise + l.tds_paise,
      net_paise: acc.net_paise + l.net_paise,
    }),
    { base_paise: 0, commission_paise: 0, tds_paise: 0, net_paise: 0 }
  );

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
              <span className="font-bold shrink-0">!</span>
              <span>{item.text}</span>
            </div>
          ))}
        </div>
      )}

      {/* Summary cards — responsive */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
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

      {error && (
        <div className="rounded-lg p-3 mb-4 text-sm" style={{ backgroundColor: "rgba(255, 77, 77, 0.1)", border: "1px solid rgba(255, 77, 77, 0.3)", color: "var(--danger)" }}>{error}</div>
      )}

      {/* Referred students */}
      {tab === "students" && (
      <div className="rounded-lg border p-5 mb-4" style={{ backgroundColor: "var(--surface)", borderColor: "var(--card-border)" }}>
        {/* Link student search */}
        {canApprove && (
          <div className="mb-4">
            {!showSearch ? (
              <button onClick={() => setShowSearch(true)}
                className="text-xs px-3 py-1.5 rounded-md font-medium"
                style={{ backgroundColor: "var(--accent)", color: "var(--bg)" }}>
                + Link student
              </button>
            ) : (
              <div className="relative">
                <div className="flex items-center gap-2 mb-2">
                  <input
                    ref={searchRef}
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search students by name..."
                    className="flex-1 text-sm rounded-md px-2.5 py-1.5"
                    style={{ backgroundColor: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)" }}
                  />
                  <button onClick={() => { setShowSearch(false); setSearchQuery(""); setSearchResults([]); }}
                    className="text-xs px-2 py-1.5 rounded-md"
                    style={{ color: "var(--text-secondary)", border: "1px solid var(--border)" }}>
                    Cancel
                  </button>
                </div>
                {searchResults.length > 0 && (
                  <div className="rounded-lg border overflow-hidden" style={{ backgroundColor: "var(--bg)", borderColor: "var(--border)" }}>
                    {searchResults.map((r) => (
                      <div key={r.id} className="flex items-center justify-between px-3 py-2 text-sm"
                        style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                        <div>
                          <span className="font-medium" style={{ color: "var(--text)" }}>{r.name}</span>
                          {(r.city || r.country) && (
                            <span className="ml-2 text-xs" style={{ color: "var(--text-tertiary)" }}>
                              {displayLocation(r.city, r.country)}
                            </span>
                          )}
                        </div>
                        {r.already_linked ? (
                          <span className="text-xs px-2 py-0.5 rounded" style={{ backgroundColor: "rgba(0,220,130,0.1)", color: "var(--accent)" }}>
                            Already linked
                          </span>
                        ) : (
                          <button onClick={() => linkStudent(r.id)} disabled={acting}
                            className="text-xs px-2 py-1 rounded font-medium disabled:opacity-50"
                            style={{ backgroundColor: "var(--accent)", color: "var(--bg)" }}>
                            Link
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {searchQuery.length >= 2 && searchResults.length === 0 && (
                  <div className="text-xs py-2" style={{ color: "var(--text-tertiary)" }}>No students found.</div>
                )}
              </div>
            )}
          </div>
        )}

        {counselor.students.length === 0 && !showSearch ? (
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>No students linked to this counselor.</p>
        ) : counselor.students.length > 0 ? (
          <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[600px]">
            <thead>
              <tr className="text-left text-xs border-b" style={{ color: "var(--text-secondary)", borderColor: "var(--border)" }}>
                <th className="pb-2 font-medium">Student</th>
                <th className="pb-2 font-medium">Location</th>
                <th className="pb-2 font-medium">Program</th>
                <th className="pb-2 font-medium">Type</th>
                <th className="pb-2 font-medium text-right">Total fee</th>
                <th className="pb-2 font-medium pl-4">Enrolled</th>
                {canApprove && <th className="pb-2 font-medium w-[60px]" />}
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
                      <td className="py-2.5" style={{ color: "var(--text-tertiary)" }} colSpan={3}>No enrollments</td>
                      <td className="py-2.5" />
                      {canApprove && (
                        <td className="py-2.5 text-right">
                          <button onClick={() => unlinkStudent(s.id)} disabled={acting}
                            className="text-[10px] px-1.5 py-0.5 rounded hover:underline disabled:opacity-50"
                            style={{ color: "var(--text-tertiary)" }}>
                            Unlink
                          </button>
                        </td>
                      )}
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
                    <td className="py-2.5 pl-4" style={{ color: "var(--text-secondary)" }}>{e.enrolled_around ? formatDate(e.enrolled_around) : "—"}</td>
                    {ei === 0 && canApprove && (
                      <td className="py-2.5 text-right" rowSpan={s.enrollments.length}>
                        <button onClick={() => unlinkStudent(s.id)} disabled={acting}
                          className="text-[10px] px-1.5 py-0.5 rounded hover:underline disabled:opacity-50"
                          style={{ color: "var(--text-tertiary)" }}>
                          Unlink
                        </button>
                      </td>
                    )}
                  </tr>
                ));
              })}
            </tbody>
          </table>
          </div>
        ) : null}
      </div>

      )}

      {/* Commission lines */}
      {tab === "commissions" && (
      <div className="rounded-lg border p-5 mb-4" style={{ backgroundColor: "var(--surface)", borderColor: "var(--card-border)" }}>
        {counselor.commission_lines.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>No commissions calculated yet.</p>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[600px]">
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
            {/* Totals row */}
            <tfoot>
              <tr className="border-t-2" style={{ borderColor: "var(--border)" }}>
                <td className="py-2.5 font-bold" style={{ color: "var(--text)" }} colSpan={2}>Total</td>
                <td className="py-2.5 text-right font-bold" style={{ color: "var(--text)" }}>{formatMoney(lineTotals.base_paise, "INR")}</td>
                <td className="py-2.5" />
                <td className="py-2.5 text-right font-bold" style={{ color: "var(--text)" }}>{formatMoney(lineTotals.commission_paise, "INR")}</td>
                <td className="py-2.5 text-right font-bold" style={{ color: "var(--text-secondary)" }}>{formatMoney(lineTotals.tds_paise, "INR")}</td>
                <td className="py-2.5 text-right font-bold" style={{ color: "var(--accent)" }}>{formatMoney(lineTotals.net_paise, "INR")}</td>
              </tr>
            </tfoot>
          </table>
          </div>
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
