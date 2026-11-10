"use client";

import { useState, useEffect, useRef } from "react";
import type { ReviewDetail as ReviewDetailType, Installment } from "@/lib/types";
import { formatMoney, formatDate, formatConfidence } from "@/lib/format";
import { apiFetch } from "@/lib/api";

interface Props {
  detail: ReviewDetailType;
  canApprove: boolean;
  onDecision: () => void;
  onSkip?: () => void;
  queuePosition?: number;
  queueTotal?: number;
}

// ---------------------------------------------------------------------------
// Reason tags: parse raw reason codes into visual tags
// ---------------------------------------------------------------------------

type TagColor = "green" | "amber" | "red" | "gray" | "blue";

function parseReasonTags(reason: string | null): { label: string; color: TagColor }[] {
  if (!reason) return [];
  const tags: { label: string; color: TagColor }[] = [];

  if (reason.includes("exact_amount") || /^amount\+/.test(reason)) {
    tags.push({ label: "Exact amount", color: "green" });
  }
  if (reason.includes("remaining_")) {
    tags.push({ label: "Remaining balance", color: "blue" });
  }

  const nm = reason.match(/(?:^|[+])name\(([0-9.]+)\)/);
  if (nm) {
    const score = Math.round(parseFloat(nm[1]));
    tags.push({ label: `Name ${score}%`, color: score >= 80 ? "green" : "amber" });
  }
  const wn = reason.match(/weak_name\(([0-9.]+)\)/);
  if (wn) {
    const score = Math.round(parseFloat(wn[1]));
    tags.push({ label: `Weak name ${score}%`, color: "red" });
  }

  const gl = reason.match(/global\((\d+)\)/);
  if (gl) {
    const count = parseInt(gl[1]);
    tags.push({ label: `${count} share amount`, color: count <= 5 ? "gray" : "amber" });
  }
  const st = reason.match(/students\((\d+)\)/);
  if (st) {
    const count = parseInt(st[1]);
    tags.push({ label: `${count} students`, color: count <= 5 ? "gray" : "amber" });
  }

  if (reason.includes("fifo")) tags.push({ label: "FIFO", color: "gray" });
  if (reason.includes("blank_payer")) tags.push({ label: "Blank payer", color: "amber" });
  if (reason.includes("globally_unique")) tags.push({ label: "Unique amount", color: "green" });
  if (reason.includes("same_student")) tags.push({ label: "Same student", color: "green" });

  return tags;
}

const TAG_STYLES: Record<TagColor, { bg: string; text: string }> = {
  green: { bg: "#dcfce7", text: "#166534" },
  amber: { bg: "#fef3c7", text: "#92400e" },
  red: { bg: "#fee2e2", text: "#991b1b" },
  gray: { bg: "#f3f4f6", text: "#374151" },
  blue: { bg: "#dbeafe", text: "#1e40af" },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ReviewDetail({ detail, canApprove, onDecision, onSkip, queuePosition, queueTotal }: Props) {
  const [acting, setActing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSuccess, setShowSuccess] = useState<string | null>(null); // "approved" | "rejected" | "assigned"
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Installment[]>([]);
  const [searching, setSearching] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const p = detail.payment;
  const suggested = detail.suggested_installments;
  const others = detail.other_candidates.filter(
    (c) => !suggested.some((s) => s.installment_id === c.installment_id)
  );

  // Deduplicate others by installment_id
  const seenIds = new Set<number>();
  const dedupedOthers = others.filter((c) => {
    if (seenIds.has(c.installment_id)) return false;
    seenIds.add(c.installment_id);
    return true;
  });

  const reasonTags = parseReasonTags(detail.reason);

  // Reset search when detail changes
  useEffect(() => {
    setSearchQuery("");
    setSearchResults([]);
    setError(null);
    setShowSuccess(null);
  }, [detail.match_id]);

  // Debounced search
  useEffect(() => {
    if (searchQuery.length < 2) {
      setSearchResults([]);
      return;
    }
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await apiFetch<{ results: Installment[] }>(
          `/review/${detail.match_id}/search-students?q=${encodeURIComponent(searchQuery)}`
        );
        setSearchResults(res.results);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(searchTimer.current);
  }, [searchQuery, detail.match_id]);

  function succeedThen(label: string) {
    setShowSuccess(label);
    setTimeout(() => {
      setShowSuccess(null);
      onDecision();
    }, 700);
  }

  async function handleApprove() {
    setActing(true);
    setError(null);
    try {
      await apiFetch(`/review/${detail.match_id}/approve`, { method: "POST" });
      succeedThen("approved");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setActing(false);
    }
  }

  async function handleReject() {
    setActing(true);
    setError(null);
    try {
      await apiFetch(`/review/${detail.match_id}/reject`, {
        method: "POST",
        body: { reason: "not_a_fee", note: "" },
      });
      succeedThen("rejected");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setActing(false);
    }
  }

  async function handleAssign(installmentId: number) {
    setActing(true);
    setError(null);
    try {
      await apiFetch(`/review/${detail.match_id}/assign`, {
        method: "POST",
        body: { installment_id: installmentId },
      });
      succeedThen("assigned");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setActing(false);
    }
  }

  // Amount comparison for suggestion
  const suggestedDiff = suggested.length > 0
    ? suggested[0].amount_due_paise - p.amount_paid_paise
    : 0;

  // Candidates to show in the assign table (search results take priority)
  const assignCandidates = searchQuery.length >= 2 ? searchResults : dedupedOthers;

  return (
    <div className="space-y-4 relative">
      {/* Success overlay */}
      {showSuccess && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/80 rounded-lg animate-fade-in">
          <div className="flex flex-col items-center gap-2">
            <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{
              backgroundColor: showSuccess === "rejected" ? "#fee2e2" : "#dcfce7",
            }}>
              {showSuccess === "rejected" ? (
                <svg className="w-6 h-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
            </div>
            <span className="text-sm font-medium capitalize" style={{
              color: showSuccess === "rejected" ? "#991b1b" : "#166534",
            }}>
              {showSuccess === "approved" ? "Approved" : showSuccess === "assigned" ? "Assigned" : "Rejected"}
            </span>
          </div>
        </div>
      )}

      {/* Sticky payment header */}
      <div className="bg-white rounded-lg border p-5 sticky top-0 z-10" style={{ borderColor: "var(--card-border)" }}>
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs font-bold uppercase tracking-wider text-gray-500">
            From the bank statement
          </div>
          {queuePosition != null && queueTotal != null && (
            <span className="text-xs text-gray-400 font-medium">
              {queuePosition} of {queueTotal}
            </span>
          )}
        </div>
        <div className="flex items-start justify-between">
          <div className="text-3xl font-bold text-gray-900">
            {formatMoney(p.amount_paid_paise, p.currency)}
          </div>
          <div className="text-right text-sm text-gray-500">
            <div>{formatDate(p.date)} · {p.method || p.source}</div>
          </div>
        </div>
        {p.payer_name ? (
          <div className="mt-3 px-3 py-2 bg-gray-100 rounded text-sm font-mono text-gray-700">
            {p.payer_name}
          </div>
        ) : (
          <div className="mt-3 px-3 py-2 bg-amber-50 border border-amber-200 rounded text-sm text-amber-700">
            No payer name on bank statement
          </div>
        )}
        {(p.gateway_fee_paise > 0 || p.tds_paise > 0) && (
          <div className="mt-3 flex gap-4 text-xs text-gray-500">
            {p.gateway_fee_paise > 0 && (
              <span>Gateway fee: {formatMoney(p.gateway_fee_paise, p.currency)}</span>
            )}
            {p.gst_on_fee_paise > 0 && (
              <span>GST on fee: {formatMoney(p.gst_on_fee_paise, p.currency)}</span>
            )}
            {p.tds_paise > 0 && (
              <span>TDS: {formatMoney(p.tds_paise, p.currency)}</span>
            )}
          </div>
        )}
      </div>

      {/* AI suggestion */}
      {detail.has_suggestion && suggested.length > 0 ? (
        <div className="bg-white rounded-lg border p-5" style={{ borderColor: "var(--card-border)" }}>
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--accent)" }}>
              Matching agent suggests
            </span>
            <span className="text-xs px-2 py-1 rounded font-medium"
              style={{
                backgroundColor: detail.confidence >= 0.95 ? "#dcfce7" : "#fef3c7",
                color: detail.confidence >= 0.95 ? "#166534" : "#92400e",
              }}>
              {formatConfidence(detail.confidence)} sure · auto-match needs 95%
            </span>
          </div>
          {suggested.map((inst) => (
            <div key={inst.installment_id}>
              <div className="text-lg font-bold text-gray-900">
                {inst.student_name} — {inst.program}, {inst.fee_model === "package"
                  ? `installment`
                  : "top-up"}
              </div>
              {/* Amount comparison */}
              <div className="mt-2 text-sm text-gray-700">
                {Math.abs(suggestedDiff) < 100 ? (
                  <span className="text-green-700 font-medium">
                    {formatMoney(p.amount_paid_paise, p.currency)} paid — exact match
                  </span>
                ) : suggestedDiff > 0 ? (
                  <span className="text-amber-700">
                    {formatMoney(p.amount_paid_paise, p.currency)} paid → {formatMoney(inst.amount_due_paise, inst.currency)} due ({formatMoney(suggestedDiff, p.currency)} short)
                  </span>
                ) : (
                  <span className="text-amber-700">
                    {formatMoney(p.amount_paid_paise, p.currency)} paid → {formatMoney(inst.amount_due_paise, inst.currency)} due ({formatMoney(Math.abs(suggestedDiff), p.currency)} over)
                  </span>
                )}
              </div>
              {/* Reason tags */}
              {reasonTags.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {reasonTags.map((tag, i) => (
                    <span key={i} className="text-xs px-2 py-0.5 rounded-full font-medium"
                      style={{ backgroundColor: TAG_STYLES[tag.color].bg, color: TAG_STYLES[tag.color].text }}>
                      {tag.label}
                    </span>
                  ))}
                </div>
              )}
              <div className="mt-3 text-xs text-gray-500">
                Remaining: {formatMoney(inst.remaining_paise, inst.currency)}
                {inst.due_date && ` · Due ${formatDate(inst.due_date)}`}
              </div>
            </div>
          ))}
          <div className="mt-3 text-xs text-gray-400">
            The amount check and the balance are calculated by the rules engine, not the AI.
          </div>

          {/* Action buttons */}
          {canApprove && detail.status === "pending_review" && (
            <div className="flex gap-3 mt-4 pt-4 border-t" style={{ borderColor: "var(--card-border)" }}>
              <button
                onClick={handleApprove}
                disabled={acting}
                className="px-5 py-2.5 text-sm font-medium text-white rounded-md disabled:opacity-50"
                style={{ backgroundColor: "var(--accent)" }}
              >
                {acting ? "Approving..." : `Approve: ${suggested[0]?.student_name || "suggestion"}`}
              </button>
              <button
                onClick={handleReject}
                disabled={acting}
                className="px-5 py-2.5 text-sm font-medium text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
              >
                Not a fee payment
              </button>
              {onSkip && (
                <button
                  onClick={onSkip}
                  className="px-5 py-2.5 text-sm font-medium text-gray-500 border border-gray-200 rounded-md hover:bg-gray-50 ml-auto"
                >
                  Skip for now
                </button>
              )}
            </div>
          )}
        </div>
      ) : (
        /* No suggestion — prominent search */
        <div className="bg-amber-50 rounded-lg border border-amber-200 p-5">
          <div className="text-sm font-bold text-amber-800 mb-1">No AI suggestion for this payment</div>
          <p className="text-sm text-amber-700 mb-3">
            The matching agent couldn&apos;t find a likely student. Search below to assign it manually.
          </p>
          {canApprove && detail.status === "pending_review" && (
            <div className="flex gap-3">
              <button
                onClick={handleReject}
                disabled={acting}
                className="px-4 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 bg-white"
              >
                Not a fee payment
              </button>
              {onSkip && (
                <button
                  onClick={onSkip}
                  className="px-4 py-2 text-sm font-medium text-gray-500 border border-gray-200 rounded-md hover:bg-gray-50 bg-white"
                >
                  Skip for now
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Assign to a different student */}
      <div className="bg-white rounded-lg border p-5" style={{ borderColor: "var(--card-border)" }}>
        <h4 className="font-bold text-gray-900 mb-1">
          {detail.has_suggestion ? "Or assign to a different student" : "Search and assign"}
        </h4>
        <p className="text-xs text-gray-400 mb-3">
          Search by name or pick from the list below to link this payment to a student.
        </p>

        {/* Search box */}
        <div className="relative mb-3">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Type a student name to search..."
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-gray-300 focus:border-gray-400"
          />
          {searching && (
            <div className="absolute right-3 top-2.5 text-xs text-gray-400">Searching...</div>
          )}
        </div>

        {searchQuery.length >= 2 && assignCandidates.length === 0 && !searching && (
          <div className="text-sm text-gray-500 py-4 text-center">
            No students found matching &ldquo;{searchQuery}&rdquo;
          </div>
        )}

        {assignCandidates.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b" style={{ borderColor: "var(--card-border)" }}>
                <th className="pb-2 font-medium">Student</th>
                <th className="pb-2 font-medium">What&apos;s due</th>
                <th className="pb-2 font-medium">Due date</th>
                <th className="pb-2 font-medium">Amount fits?</th>
                {canApprove && detail.status === "pending_review" && (
                  <th className="pb-2 font-medium" />
                )}
              </tr>
            </thead>
            <tbody className="divide-y" style={{ borderColor: "var(--card-border)" }}>
              {assignCandidates.map((inst) => {
                const diff = (inst.amount_difference_paise ?? (inst.amount_due_paise - p.amount_paid_paise));
                return (
                  <tr key={inst.installment_id}>
                    <td className="py-2 font-medium text-gray-900">{inst.student_name}</td>
                    <td className="py-2 text-gray-600">
                      {inst.program} · {formatMoney(inst.amount_due_paise, inst.currency)}
                    </td>
                    <td className="py-2 text-gray-500 text-xs">
                      {inst.due_date ? formatDate(inst.due_date) : "—"}
                    </td>
                    <td className="py-2">
                      {Math.abs(diff) < 100 ? (
                        <span className="text-green-700 text-xs font-medium">Exact</span>
                      ) : (
                        <span className="text-red-600 text-xs">
                          {diff > 0 ? "Short by " : "Over by "}
                          {formatMoney(Math.abs(diff), inst.currency)}
                        </span>
                      )}
                    </td>
                    {canApprove && detail.status === "pending_review" && (
                      <td className="py-2 text-right">
                        <button
                          onClick={() => handleAssign(inst.installment_id)}
                          disabled={acting}
                          className="text-xs px-3 py-1.5 rounded font-medium text-white disabled:opacity-50"
                          style={{ backgroundColor: "var(--accent)" }}
                        >
                          Assign
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {/* Show candidates list when not searching */}
        {searchQuery.length < 2 && dedupedOthers.length === 0 && (
          <div className="text-sm text-gray-500 py-4 text-center">
            No other candidates with matching amounts. Use the search box above to find any student.
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {detail.status === "pending_review" && detail.has_suggestion && (
        <p className="text-xs text-gray-400">
          Approving records the payment, updates the student&apos;s balance, credits their counselor&apos;s
          commission, and logs who approved it and when.
        </p>
      )}
    </div>
  );
}
