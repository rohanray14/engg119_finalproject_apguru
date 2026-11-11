"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import type { ReviewDetail as ReviewDetailType, Installment } from "@/lib/types";
import { formatMoney, formatDate } from "@/lib/format";
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
// Component
// ---------------------------------------------------------------------------

export default function ReviewDetail({ detail, canApprove, onDecision, onSkip, queuePosition, queueTotal }: Props) {
  const [acting, setActing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSuccess, setShowSuccess] = useState<string | null>(null); // "approved" | "rejected" | "assigned"
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectNote, setRejectNote] = useState("");
  const [confirmAssign, setConfirmAssign] = useState<Installment | null>(null);
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

  // Reset search when detail changes
  useEffect(() => {
    setSearchQuery("");
    setSearchResults([]);
    setError(null);
    setShowSuccess(null);
    setRejectOpen(false);
    setRejectNote("");
    setConfirmAssign(null);
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
    }, 1500);
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
        body: { reason: "not_a_fee", note: rejectNote.trim() },
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
        <div className="absolute inset-0 z-20 flex items-center justify-center rounded-lg animate-fade-in" style={{ backgroundColor: "rgba(10,10,15,0.85)" }}>
          <div className="flex flex-col items-center gap-2">
            <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{
              backgroundColor: showSuccess === "rejected" ? "rgba(255,77,77,0.15)" : "rgba(0,220,130,0.15)",
            }}>
              {showSuccess === "rejected" ? (
                <svg className="w-6 h-6" style={{ color: "var(--danger)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                <svg className="w-6 h-6" style={{ color: "var(--accent)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
            </div>
            <span className="text-sm font-medium capitalize" style={{
              color: showSuccess === "rejected" ? "var(--danger)" : "var(--accent)",
            }}>
              {showSuccess === "approved" ? "Approved" : showSuccess === "assigned" ? "Assigned" : "Rejected"}
            </span>
          </div>
        </div>
      )}

      {/* Sticky payment header */}
      <div className="rounded-lg border p-5 sticky top-0 z-10" style={{ backgroundColor: "var(--surface)", borderColor: "var(--card-border)" }}>
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>
            From the bank statement
          </div>
          {queuePosition != null && queueTotal != null && (
            <span className="text-xs font-medium" style={{ color: "var(--text-tertiary)" }}>
              {queuePosition} of {queueTotal}
            </span>
          )}
        </div>
        <div className="flex items-start justify-between">
          <div className="text-3xl font-bold" style={{ color: "var(--text)" }}>
            {formatMoney(p.amount_paid_paise, p.currency)}
          </div>
          <div className="text-right text-sm" style={{ color: "var(--text-secondary)" }}>
            <div>{formatDate(p.date)} · {p.method || p.source}</div>
          </div>
        </div>
        {p.payer_name ? (
          <div className="mt-3 px-3 py-2 rounded text-sm font-mono" style={{ backgroundColor: "var(--surface-hover)", color: "var(--text)" }}>
            {p.payer_name}
          </div>
        ) : (
          <div className="mt-3 px-3 py-2 border rounded text-sm" style={{ backgroundColor: "rgba(255,176,32,0.1)", borderColor: "rgba(255,176,32,0.3)", color: "var(--warning)" }}>
            No payer name on bank statement
          </div>
        )}
        {(p.gateway_fee_paise > 0 || p.tds_paise > 0) && (
          <div className="mt-3 flex gap-4 text-xs" style={{ color: "var(--text-secondary)" }}>
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
        <div className="rounded-lg border p-5" style={{ backgroundColor: "var(--surface)", borderColor: "var(--card-border)" }}>
          <div className="mb-3">
            <span className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--accent)" }}>
              Suggested match
            </span>
          </div>
          {suggested.map((inst) => (
            <div key={inst.installment_id}>
              <div className="text-lg font-bold" style={{ color: "var(--text)" }}>
                <Link href={`/students?id=${inst.student_id}`} className="hover:underline" style={{ color: "var(--accent)" }}>
                  {inst.student_name}
                </Link>
                {" — "}{inst.program}
              </div>
              {/* Amount comparison */}
              <div className="mt-2 text-sm" style={{ color: "var(--text)" }}>
                {Math.abs(suggestedDiff) < 100 ? (
                  <span className="font-medium" style={{ color: "var(--accent)" }}>
                    {formatMoney(p.amount_paid_paise, p.currency)} paid — exact match
                  </span>
                ) : suggestedDiff > 0 ? (
                  <span style={{ color: "var(--warning)" }}>
                    {formatMoney(p.amount_paid_paise, p.currency)} paid → {formatMoney(inst.amount_due_paise, inst.currency)} due ({formatMoney(suggestedDiff, p.currency)} short)
                  </span>
                ) : (
                  <span style={{ color: "var(--warning)" }}>
                    {formatMoney(p.amount_paid_paise, p.currency)} paid → {formatMoney(inst.amount_due_paise, inst.currency)} due ({formatMoney(Math.abs(suggestedDiff), p.currency)} over)
                  </span>
                )}
              </div>
              <div className="mt-2 text-xs" style={{ color: "var(--text-secondary)" }}>
                Remaining: {formatMoney(inst.remaining_paise, inst.currency)}
                {inst.due_date && ` · Due ${formatDate(inst.due_date)}`}
              </div>
            </div>
          ))}
          {/* Action buttons */}
          {canApprove && detail.status === "pending_review" && (
            <div className="flex gap-3 mt-4 pt-4 border-t" style={{ borderColor: "var(--card-border)" }}>
              <button
                onClick={handleApprove}
                disabled={acting}
                className="px-5 py-2.5 text-sm font-medium text-white rounded-md disabled:opacity-50"
                style={{ backgroundColor: "var(--accent)" }}
              >
                {acting ? "Approving..." : `Approve → ${suggested[0]?.student_name}`}
              </button>
              <button
                onClick={() => setRejectOpen(!rejectOpen)}
                className="px-5 py-2.5 text-sm font-medium border rounded-md"
                style={{ color: "var(--text)", borderColor: "var(--border)" }}
              >
                Not a fee payment
              </button>
              {onSkip && (
                <button
                  onClick={onSkip}
                  className="px-5 py-2.5 text-sm font-medium border rounded-md ml-auto"
                  style={{ color: "var(--text-secondary)", borderColor: "var(--border-subtle)" }}
                >
                  Skip (S)
                </button>
              )}
            </div>
          )}
        </div>
      ) : (
        /* No suggestion — prominent search */
        <div className="rounded-lg border p-5" style={{ backgroundColor: "rgba(255,176,32,0.08)", borderColor: "rgba(255,176,32,0.3)" }}>
          <div className="text-sm font-bold mb-1" style={{ color: "var(--warning)" }}>No AI suggestion for this payment</div>
          <p className="text-sm mb-3" style={{ color: "var(--text-secondary)" }}>
            The matching agent couldn&apos;t find a likely student. Search below to assign it manually.
          </p>
          {canApprove && detail.status === "pending_review" && (
            <div className="flex gap-3">
              <button
                onClick={() => setRejectOpen(!rejectOpen)}
                className="px-4 py-2 text-sm font-medium border rounded-md"
                style={{ color: "var(--text)", borderColor: "var(--border)", backgroundColor: "var(--surface)" }}
              >
                Not a fee payment
              </button>
              {onSkip && (
                <button
                  onClick={onSkip}
                  className="px-4 py-2 text-sm font-medium border rounded-md"
                  style={{ color: "var(--text-secondary)", borderColor: "var(--border-subtle)", backgroundColor: "var(--surface)" }}
                >
                  Skip for now
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Reject confirmation with note */}
      {rejectOpen && (
        <div className="rounded-lg border p-4" style={{ backgroundColor: "rgba(255,77,77,0.08)", borderColor: "rgba(255,77,77,0.3)" }}>
          <div className="text-sm font-medium mb-2" style={{ color: "var(--danger)" }}>Mark as not a fee payment</div>
          <textarea
            value={rejectNote}
            onChange={(e) => setRejectNote(e.target.value)}
            placeholder="Optional: why is this not a fee? (e.g. internal transfer, refund, duplicate...)"
            className="w-full px-3 py-2 text-sm border rounded-md focus:outline-none focus:ring-2 resize-none"
            style={{ backgroundColor: "var(--surface)", borderColor: "rgba(255,77,77,0.3)", color: "var(--text)" }}
            rows={2}
            maxLength={500}
          />
          <div className="flex gap-2 mt-3">
            <button
              onClick={handleReject}
              disabled={acting}
              className="px-4 py-2 text-sm font-medium rounded-md disabled:opacity-50"
              style={{ backgroundColor: "var(--danger)", color: "var(--bg)" }}
            >
              {acting ? "Rejecting..." : "Confirm reject"}
            </button>
            <button
              onClick={() => { setRejectOpen(false); setRejectNote(""); }}
              className="px-4 py-2 text-sm font-medium border rounded-md"
              style={{ color: "var(--text-secondary)", borderColor: "var(--border)" }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Assign confirmation */}
      {confirmAssign && (
        <div className="rounded-lg border p-4" style={{ backgroundColor: "rgba(77,158,255,0.08)", borderColor: "rgba(77,158,255,0.3)" }}>
          <div className="text-sm font-medium mb-2" style={{ color: "var(--info)" }}>
            Assign this payment to {confirmAssign.student_name}?
          </div>
          <p className="text-xs mb-3" style={{ color: "var(--text-secondary)" }}>
            {formatMoney(p.amount_paid_paise, p.currency)} will be applied to {confirmAssign.student_name}&apos;s
            {" "}{confirmAssign.program} installment ({formatMoney(confirmAssign.amount_due_paise, confirmAssign.currency)} due
            {confirmAssign.due_date ? ` on ${formatDate(confirmAssign.due_date)}` : ""}).
            {detail.has_suggestion && ` This overrides the AI suggestion.`}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => { handleAssign(confirmAssign.installment_id); setConfirmAssign(null); }}
              disabled={acting}
              className="px-4 py-2 text-sm font-medium text-white rounded-md disabled:opacity-50"
              style={{ backgroundColor: "var(--accent)" }}
            >
              {acting ? "Assigning..." : `Yes, assign to ${confirmAssign.student_name}`}
            </button>
            <button
              onClick={() => setConfirmAssign(null)}
              className="px-4 py-2 text-sm font-medium border rounded-md"
              style={{ color: "var(--text-secondary)", borderColor: "var(--border)" }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Assign to a different student */}
      <div className="rounded-lg border p-5" style={{ backgroundColor: "var(--surface)", borderColor: "var(--card-border)" }}>
        <h4 className="font-bold mb-1" style={{ color: "var(--text)" }}>
          {detail.has_suggestion ? "Or assign to a different student" : "Search and assign"}
        </h4>
        <p className="text-xs mb-3" style={{ color: "var(--text-tertiary)" }}>
          Search by name or pick from the list below to link this payment to a student.
        </p>

        {/* Search box */}
        <div className="relative mb-3">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Type a student name to search..."
            className="w-full px-3 py-2 text-sm border rounded-md focus:outline-none focus:ring-2"
            style={{ backgroundColor: "var(--surface-hover)", borderColor: "var(--border)", color: "var(--text)" }}
          />
          {searching && (
            <div className="absolute right-3 top-2.5 text-xs" style={{ color: "var(--text-tertiary)" }}>Searching...</div>
          )}
        </div>

        {searchQuery.length >= 2 && assignCandidates.length === 0 && !searching && (
          <div className="text-sm py-4 text-center" style={{ color: "var(--text-secondary)" }}>
            No students found matching &ldquo;{searchQuery}&rdquo;
          </div>
        )}

        {assignCandidates.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs border-b" style={{ color: "var(--text-secondary)", borderColor: "var(--border)" }}>
                <th className="pb-2 font-medium">Student</th>
                <th className="pb-2 font-medium">What&apos;s due</th>
                <th className="pb-2 font-medium">Due date</th>
                <th className="pb-2 font-medium">Amount fits?</th>
                {canApprove && detail.status === "pending_review" && (
                  <th className="pb-2 font-medium" />
                )}
              </tr>
            </thead>
            <tbody className="divide-y" style={{ borderColor: "var(--border-subtle)" }}>
              {assignCandidates.map((inst) => {
                const diff = (inst.amount_difference_paise ?? (inst.amount_due_paise - p.amount_paid_paise));
                return (
                  <tr key={inst.installment_id}>
                    <td className="py-2 font-medium" style={{ color: "var(--text)" }}>{inst.student_name}</td>
                    <td className="py-2" style={{ color: "var(--text-secondary)" }}>
                      {inst.program} · {formatMoney(inst.amount_due_paise, inst.currency)}
                    </td>
                    <td className="py-2 text-xs" style={{ color: "var(--text-secondary)" }}>
                      {inst.due_date ? formatDate(inst.due_date) : "—"}
                    </td>
                    <td className="py-2">
                      {Math.abs(diff) < 100 ? (
                        <span className="text-xs font-medium" style={{ color: "var(--accent)" }}>Exact</span>
                      ) : (
                        <span className="text-xs" style={{ color: "var(--danger)" }}>
                          {diff > 0 ? "Short by " : "Over by "}
                          {formatMoney(Math.abs(diff), inst.currency)}
                        </span>
                      )}
                    </td>
                    {canApprove && detail.status === "pending_review" && (
                      <td className="py-2 text-right">
                        <button
                          onClick={() => setConfirmAssign(inst)}
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
          <div className="text-sm py-4 text-center" style={{ color: "var(--text-secondary)" }}>
            No other candidates with matching amounts. Use the search box above to find any student.
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="border rounded-lg p-3 text-sm" style={{ backgroundColor: "rgba(255,77,77,0.08)", borderColor: "rgba(255,77,77,0.3)", color: "var(--danger)" }}>
          {error}
        </div>
      )}

      {detail.status === "pending_review" && detail.has_suggestion && (
        <p className="text-xs" style={{ color: "var(--text-tertiary)" }}>
          Approving records the payment, updates the student&apos;s balance, credits their counselor&apos;s
          commission, and logs who approved it and when.
        </p>
      )}
    </div>
  );
}
