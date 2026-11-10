"use client";

import { useState } from "react";
import type { ReviewDetail as ReviewDetailType } from "@/lib/types";
import { formatMoney, formatDate, formatConfidence } from "@/lib/format";
import { apiFetch } from "@/lib/api";

interface Props {
  detail: ReviewDetailType;
  canApprove: boolean;
  onDecision: () => void;
}

export default function ReviewDetail({ detail, canApprove, onDecision }: Props) {
  const [acting, setActing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const p = detail.payment;
  const suggested = detail.suggested_installments;
  const others = detail.other_candidates.filter(
    (c) => !suggested.some((s) => s.installment_id === c.installment_id)
  );

  async function handleApprove() {
    setActing(true);
    setError(null);
    try {
      await apiFetch(`/review/${detail.match_id}/approve`, { method: "POST" });
      onDecision();
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
      onDecision();
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
      onDecision();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setActing(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Bank statement card */}
      <div className="bg-white rounded-lg border p-5" style={{ borderColor: "var(--card-border)" }}>
        <div className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-3">
          From the bank statement
        </div>
        <div className="flex items-start justify-between">
          <div className="text-3xl font-bold text-gray-900">
            {formatMoney(p.amount_paid_paise, p.currency)}
          </div>
          <div className="text-right text-sm text-gray-500">
            <div>{formatDate(p.date)} · {p.method || p.source}</div>
          </div>
        </div>
        {p.payer_name && (
          <div className="mt-3 px-3 py-2 bg-gray-100 rounded text-sm font-mono text-gray-700">
            {p.payer_name}
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
      {detail.has_suggestion && suggested.length > 0 && (
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
              {detail.reason_text && (
                <ul className="mt-3 space-y-1.5 text-sm text-gray-700">
                  {detail.reason_text.split(". ").filter(Boolean).map((r, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="mt-1.5 w-1 h-1 rounded-full bg-gray-400 shrink-0" />
                      {r.replace(/\.$/, "")}
                    </li>
                  ))}
                </ul>
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

          {/* Action buttons right under suggestion */}
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
            </div>
          )}
        </div>
      )}

      {/* Other candidates — always show assign buttons */}
      {(others.length > 0 || suggested.length > 0) && (
        <div className="bg-white rounded-lg border p-5" style={{ borderColor: "var(--card-border)" }}>
          <h4 className="font-bold text-gray-900 mb-1">Other possibilities</h4>
          <p className="text-xs text-gray-400 mb-3">Click &ldquo;Assign&rdquo; to link this payment to a different student instead.</p>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b" style={{ borderColor: "var(--card-border)" }}>
                <th className="pb-2 font-medium">Student</th>
                <th className="pb-2 font-medium">What&apos;s due</th>
                <th className="pb-2 font-medium">Amount fits?</th>
                {canApprove && detail.status === "pending_review" && (
                  <th className="pb-2 font-medium" />
                )}
              </tr>
            </thead>
            <tbody className="divide-y" style={{ borderColor: "var(--card-border)" }}>
              {[...suggested, ...others].map((inst) => {
                const diff = (inst.amount_difference_paise ?? (inst.amount_due_paise - p.amount_paid_paise));
                const isSuggested = suggested.some(s => s.installment_id === inst.installment_id);
                return (
                  <tr key={inst.installment_id} className={isSuggested ? "bg-gray-50" : ""}>
                    <td className="py-2 font-medium text-gray-900">{inst.student_name}</td>
                    <td className="py-2 text-gray-600">
                      {inst.program} · {formatMoney(inst.amount_due_paise, inst.currency)}
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
                        {!isSuggested ? (
                          <button
                            onClick={() => handleAssign(inst.installment_id)}
                            disabled={acting}
                            className="text-xs px-3 py-1.5 rounded font-medium border border-gray-300 hover:bg-gray-100 disabled:opacity-50"
                          >
                            Assign
                          </button>
                        ) : (
                          <span className="text-xs text-gray-400">suggested</span>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

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
