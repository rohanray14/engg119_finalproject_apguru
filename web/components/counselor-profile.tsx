"use client";

import { useState, useEffect, useRef, useMemo } from "react";
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
interface PayableEntry {
  currency: string; net_paise: number;
}
interface CounselorData {
  id: number; name: string; terms_text: string;
  rule: { rate: number; scope: string; city: string | null; split: number | null; source: string };
  students: CounselorStudent[];
  commission_lines: CommissionLine[];
  totals: CurrencyTotal[];
  payouts: Payout[];
  total_paid_out: { currency: string; net_paise: number }[];
  payable: PayableEntry[];
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
  const [payConfirm, setPayConfirm] = useState(false);
  const [paySuccess, setPaySuccess] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Filter state for students tab
  const [locationFilter, setLocationFilter] = useState<string | null>(null);
  const [programFilter, setProgramFilter] = useState<string | null>(null);

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

  // Derive unique locations and programs from students
  const { locations, programs } = useMemo(() => {
    if (!counselor) return { locations: [] as string[], programs: [] as string[] };
    const locs = new Set<string>();
    const progs = new Set<string>();
    for (const s of counselor.students) {
      const loc = displayLocation(s.city, s.country);
      if (loc) locs.add(loc);
      for (const e of s.enrollments) {
        if (e.program) progs.add(e.program);
      }
    }
    return { locations: Array.from(locs).sort(), programs: Array.from(progs).sort() };
  }, [counselor]);

  // Filter students
  const filteredStudents = useMemo(() => {
    if (!counselor) return [];
    return counselor.students.filter((s) => {
      if (locationFilter) {
        const loc = displayLocation(s.city, s.country);
        if (loc !== locationFilter) return false;
      }
      if (programFilter) {
        if (!s.enrollments.some((e) => e.program === programFilter)) return false;
      }
      return true;
    });
  }, [counselor, locationFilter, programFilter]);

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

  async function approvePayout(currency: string, amount: number) {
    setActing(true);
    setError(null);
    try {
      await apiFetch(`/commissions/counselors/${counselorId}/payout/approve`, {
        method: "POST",
        body: { currency, expected_payable_paise: amount },
      });
      setPayConfirm(false);
      setPaySuccess(`Payout of ${formatMoney(amount, currency)} approved.`);
      mutate();
      setTimeout(() => setPaySuccess(null), 5000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Payout failed");
      setPayConfirm(false);
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
  const payableINR = counselor.payable.find((p) => p.currency === "INR");

  // Compute action items
  const now = new Date();
  const actionItems: { severity: "high" | "medium" | "low"; text: string }[] = [];

  if (netOwed > 0 && counselor.commission_lines.length > 0) {
    const oldest = counselor.commission_lines[counselor.commission_lines.length - 1];
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

  const studentsWithEnrollments = counselor.students.filter((s) => s.enrollments.length > 0);
  if (studentsWithEnrollments.length > 0 && counselor.commission_lines.length < studentsWithEnrollments.length) {
    const gap = studentsWithEnrollments.length - counselor.commission_lines.length;
    if (gap > 0) {
      actionItems.push({
        severity: "medium",
        text: `${counselor.commission_lines.length} commission lines for ${studentsWithEnrollments.length} enrolled students. Some referrals may not have matched payments yet.`,
      });
    }
  }

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

  const tabDescriptions = {
    students: "Students this counselor referred. Commission is earned when their fee payments are matched.",
    commissions: "Commission earned from matched fee payments, after 2% TDS. Approve payout when ready to pay.",
    payouts: "Record of money already paid to this counselor.",
  };

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

      {/* Payout success banner */}
      {paySuccess && (
        <div className="mb-4 rounded-lg p-3 text-sm font-medium flex items-center gap-2"
          style={{ backgroundColor: "rgba(0,220,130,0.1)", border: "1px solid rgba(0,220,130,0.3)", color: "var(--accent)" }}>
          <span>&#10003;</span> {paySuccess}
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

        {/* Still owed card — with pay button */}
        <div className="rounded-lg border p-4" style={{
          backgroundColor: payableINR && payableINR.net_paise > 0 ? "rgba(255,77,77,0.04)" : "var(--surface)",
          borderColor: payableINR && payableINR.net_paise > 0 ? "rgba(255,77,77,0.3)" : "var(--card-border)",
        }}>
          <div className="text-xs uppercase tracking-wider font-medium" style={{ color: "var(--text-secondary)" }}>Still owed</div>
          <div className="text-xl font-bold mt-1" style={{ color: netOwed > 0 ? "var(--danger)" : "var(--accent)" }}>
            {netOwed > 0 ? formatMoney(netOwed, "INR") : "Settled"}
          </div>
          {canApprove && payableINR && payableINR.net_paise > 0 && !payConfirm && (
            <button
              onClick={() => setPayConfirm(true)}
              className="mt-2 text-xs px-3 py-1.5 rounded-md font-medium w-full"
              style={{ backgroundColor: "var(--accent)", color: "var(--bg)" }}>
              Approve payout
            </button>
          )}
          {payConfirm && payableINR && (
            <div className="mt-2 space-y-1.5">
              <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                Pay <strong style={{ color: "var(--text)" }}>{formatMoney(payableINR.net_paise, "INR")}</strong> to {counselor.name}?
              </p>
              <div className="flex gap-2">
                <button onClick={() => approvePayout("INR", payableINR.net_paise)} disabled={acting}
                  className="flex-1 text-xs px-2 py-1.5 rounded-md font-medium disabled:opacity-50"
                  style={{ backgroundColor: "var(--accent)", color: "var(--bg)" }}>
                  {acting ? "..." : "Confirm"}
                </button>
                <button onClick={() => setPayConfirm(false)}
                  className="flex-1 text-xs px-2 py-1.5 rounded-md"
                  style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b mb-1" style={{ borderColor: "var(--card-border)" }}>
        {([
          ["students", `Referred (${counselor.students.length})`],
          ["commissions", `Earnings (${counselor.commission_lines.length})`],
          ["payouts", `Paid out (${counselor.payouts.length})`],
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

      {/* Tab description */}
      <p className="text-xs mb-4 mt-2" style={{ color: "var(--text-tertiary)" }}>
        {tabDescriptions[tab]}
      </p>

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

        {/* Filter chips */}
        {counselor.students.length > 0 && (locations.length > 1 || programs.length > 1) && (
          <div className="space-y-2 mb-4">
            {locations.length > 1 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-bold mr-1" style={{ color: "var(--text)" }}>
                  Location
                </span>
                <button
                  onClick={() => setLocationFilter(null)}
                  className="text-xs px-2.5 py-1 rounded-full font-medium transition-colors"
                  style={!locationFilter
                    ? { backgroundColor: "var(--text)", color: "var(--bg)" }
                    : { backgroundColor: "var(--bg)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}>
                  All
                </button>
                {locations.map((loc) => (
                  <button key={loc}
                    onClick={() => setLocationFilter(locationFilter === loc ? null : loc)}
                    className="text-xs px-2.5 py-1 rounded-full font-medium transition-colors"
                    style={locationFilter === loc
                      ? { backgroundColor: "var(--text)", color: "var(--bg)" }
                      : { backgroundColor: "var(--bg)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}>
                    {loc}
                  </button>
                ))}
              </div>
            )}
            {programs.length > 1 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-bold mr-1" style={{ color: "var(--text)" }}>
                  Program
                </span>
                <button
                  onClick={() => setProgramFilter(null)}
                  className="text-xs px-2.5 py-1 rounded-full font-medium transition-colors"
                  style={!programFilter
                    ? { backgroundColor: "var(--text)", color: "var(--bg)" }
                    : { backgroundColor: "var(--bg)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}>
                  All
                </button>
                {programs.map((prog) => (
                  <button key={prog}
                    onClick={() => setProgramFilter(programFilter === prog ? null : prog)}
                    className="text-xs px-2.5 py-1 rounded-full font-medium transition-colors"
                    style={programFilter === prog
                      ? { backgroundColor: "var(--text)", color: "var(--bg)" }
                      : { backgroundColor: "var(--bg)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}>
                    {prog}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Active filter summary */}
        {(locationFilter || programFilter) && (
          <div className="flex items-center gap-2 mb-3 text-xs" style={{ color: "var(--text-secondary)" }}>
            <span>Showing {filteredStudents.length} of {counselor.students.length} students</span>
            <button onClick={() => { setLocationFilter(null); setProgramFilter(null); }}
              className="underline hover:no-underline" style={{ color: "var(--accent)" }}>
              Clear filters
            </button>
          </div>
        )}

        {filteredStudents.length === 0 && !showSearch ? (
          <p className="text-sm py-4 text-center" style={{ color: "var(--text-secondary)" }}>
            {counselor.students.length === 0
              ? "No students linked to this counselor."
              : "No students match the selected filters."}
          </p>
        ) : filteredStudents.length > 0 ? (
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
              {filteredStudents.map((s) => {
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
      <div className="space-y-4 mb-4">
        {/* Payout CTA banner — always visible when money is owed */}
        {payableINR && payableINR.net_paise > 0 && counselor.commission_lines.length > 0 && (
          <div className="rounded-lg border p-4" style={{
            backgroundColor: "rgba(255, 77, 77, 0.06)",
            borderColor: "rgba(255, 77, 77, 0.3)",
          }}>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium" style={{ color: "var(--text)" }}>
                  {formatMoney(payableINR.net_paise, "INR")} unpaid
                </div>
                <div className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>
                  Total earned: {formatMoney(lineTotals.net_paise, "INR")} · Paid out: {formatMoney(paidOut, "INR")} · Remaining: {formatMoney(payableINR.net_paise, "INR")}
                </div>
              </div>
              {canApprove && (
                !payConfirm ? (
                  <button onClick={() => setPayConfirm(true)}
                    className="text-sm px-5 py-2 rounded-md font-semibold"
                    style={{ backgroundColor: "var(--accent)", color: "var(--bg)" }}>
                    Approve payout
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                      Pay {formatMoney(payableINR.net_paise, "INR")} to {counselor.name}?
                    </span>
                    <button onClick={() => approvePayout("INR", payableINR.net_paise)} disabled={acting}
                      className="text-xs px-3 py-1.5 rounded-md font-medium disabled:opacity-50"
                      style={{ backgroundColor: "var(--accent)", color: "var(--bg)" }}>
                      {acting ? "..." : "Confirm"}
                    </button>
                    <button onClick={() => setPayConfirm(false)}
                      className="text-xs px-3 py-1.5 rounded-md"
                      style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }}>
                      Cancel
                    </button>
                  </div>
                )
              )}
            </div>
          </div>
        )}

        {/* All settled banner */}
        {counselor.commission_lines.length > 0 && (!payableINR || payableINR.net_paise <= 0) && (
          <div className="rounded-lg border p-4" style={{
            backgroundColor: "rgba(0, 220, 130, 0.06)",
            borderColor: "rgba(0, 220, 130, 0.3)",
          }}>
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4" style={{ color: "var(--accent)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              <span className="text-sm font-medium" style={{ color: "var(--accent)" }}>All paid up</span>
              <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                — Total {formatMoney(lineTotals.net_paise, "INR")} earned and paid out
              </span>
            </div>
          </div>
        )}

        {/* Commission table */}
        <div className="rounded-lg border p-5" style={{ backgroundColor: "var(--surface)", borderColor: "var(--card-border)" }}>
          {counselor.commission_lines.length === 0 ? (
            <p className="text-sm py-4 text-center" style={{ color: "var(--text-secondary)" }}>No commissions calculated yet.</p>
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
      </div>

      )}

      {/* Payout history */}
      {tab === "payouts" && (
        counselor.payouts.length === 0 ? (
          <div className="rounded-lg border p-8 text-center" style={{ backgroundColor: "var(--surface)", borderColor: "var(--card-border)" }}>
            <p style={{ color: "var(--text-secondary)" }}>No payouts approved yet.</p>
            {canApprove && payableINR && payableINR.net_paise > 0 && (
              <button onClick={() => { setTab("commissions"); setPayConfirm(true); }}
                className="mt-3 text-xs px-4 py-2 rounded-md font-medium"
                style={{ backgroundColor: "var(--accent)", color: "var(--bg)" }}>
                Approve first payout ({formatMoney(payableINR.net_paise, "INR")})
              </button>
            )}
          </div>
        ) : (
          <div className="rounded-lg border p-5" style={{ backgroundColor: "var(--surface)", borderColor: "var(--card-border)" }}>
            {/* Total paid out summary */}
            <div className="flex items-center justify-between mb-4 pb-4" style={{ borderBottom: "1px solid var(--border)" }}>
              <div>
                <div className="text-xs uppercase tracking-wider font-medium" style={{ color: "var(--text-secondary)" }}>Total paid out</div>
                <div className="text-xl font-bold" style={{ color: "var(--accent)" }}>{formatMoney(paidOut, "INR")}</div>
              </div>
              {payableINR && payableINR.net_paise > 0 && (
                <div className="text-right">
                  <div className="text-xs" style={{ color: "var(--text-secondary)" }}>Still owed</div>
                  <div className="text-lg font-bold" style={{ color: "var(--danger)" }}>{formatMoney(payableINR.net_paise, "INR")}</div>
                </div>
              )}
            </div>

            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs border-b" style={{ color: "var(--text-secondary)", borderColor: "var(--border)" }}>
                  <th className="pb-2 font-medium">Date</th>
                  <th className="pb-2 font-medium">Approved by</th>
                  <th className="pb-2 font-medium text-right">Amount</th>
                  {canApprove && <th className="pb-2 font-medium w-[80px]" />}
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: "var(--border-subtle)" }}>
                {counselor.payouts.map((p) => (
                  <tr key={`${p.id}-${p.currency}`}>
                    <td className="py-2.5" style={{ color: "var(--text)" }}>{formatDate(p.approved_at)}</td>
                    <td className="py-2.5" style={{ color: "var(--text-secondary)" }}>{p.actor}</td>
                    <td className="py-2.5 text-right font-medium" style={{ color: "var(--text)" }}>{formatMoney(p.net_paise, p.currency)}</td>
                    {canApprove && (
                      <td className="py-2.5 text-right">
                        <button
                          onClick={async () => {
                            if (!confirm(`Reverse payout of ${formatMoney(p.net_paise, p.currency)} to ${counselor.name}? This will mark it as unpaid.`)) return;
                            setActing(true);
                            setError(null);
                            try {
                              await apiFetch(`/commissions/counselors/${counselorId}/payout/${p.id}/reverse`, { method: "POST" });
                              mutate();
                            } catch (e: unknown) {
                              setError(e instanceof Error ? e.message : "Failed to reverse");
                            } finally {
                              setActing(false);
                            }
                          }}
                          disabled={acting}
                          className="text-[11px] px-2 py-1 rounded hover:underline disabled:opacity-50"
                          style={{ color: "var(--danger)" }}>
                          Undo
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Pay more if there's still money owed */}
            {canApprove && payableINR && payableINR.net_paise > 0 && (
              <div className="mt-4 pt-4 flex items-center justify-between" style={{ borderTop: "1px solid var(--border)" }}>
                <div className="text-sm" style={{ color: "var(--text-secondary)" }}>
                  <span className="font-medium" style={{ color: "var(--danger)" }}>{formatMoney(payableINR.net_paise, "INR")}</span>{" "}
                  still owed
                </div>
                {!payConfirm ? (
                  <button onClick={() => setPayConfirm(true)}
                    className="text-xs px-4 py-2 rounded-md font-medium"
                    style={{ backgroundColor: "var(--accent)", color: "var(--bg)" }}>
                    Approve payout
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                      Pay {formatMoney(payableINR.net_paise, "INR")}?
                    </span>
                    <button onClick={() => approvePayout("INR", payableINR.net_paise)} disabled={acting}
                      className="text-xs px-3 py-1.5 rounded-md font-medium disabled:opacity-50"
                      style={{ backgroundColor: "var(--accent)", color: "var(--bg)" }}>
                      {acting ? "..." : "Confirm"}
                    </button>
                    <button onClick={() => setPayConfirm(false)}
                      className="text-xs px-3 py-1.5 rounded-md"
                      style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }}>
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )
      )}
    </div>
  );
}
