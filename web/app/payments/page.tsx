"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { apiFetch } from "@/lib/api";
import { formatMoney, formatDate } from "@/lib/format";

interface PaymentRow {
  id: number;
  source: string;
  method: string | null;
  payer_name: string | null;
  date: string;
  amount_paid_paise: number;
  currency: string;
  gateway_fee_paise: number;
  gst_on_fee_paise: number;
  fx_diff_paise: number;
  tds_paise: number;
  amount_in_bank_paise: number;
  confirmation: string;
  match_id: number | null;
  match_status: string;
  deductions_paise: number;
}

interface PaymentsResponse {
  total: number;
  limit: number;
  offset: number;
  items: PaymentRow[];
}

function fetcher<T>(path: string) { return apiFetch<T>(path); }

const confirmBadge: Record<string, { bg: string; text: string }> = {
  in_bank: { bg: "#dcfce7", text: "#166534" },
  seen_by_gateway: { bg: "#fef3c7", text: "#92400e" },
  screenshot_only: { bg: "#fee2e2", text: "#991b1b" },
};

const matchBadge: Record<string, { bg: string; text: string }> = {
  auto: { bg: "#dcfce7", text: "#166534" },
  approved: { bg: "#dcfce7", text: "#166534" },
  pending_review: { bg: "#fef3c7", text: "#92400e" },
  rejected: { bg: "#fee2e2", text: "#991b1b" },
  unmatched: { bg: "#f3f4f6", text: "#374151" },
};

export default function PaymentsPage() {
  const [source, setSource] = useState("");
  const [currency, setCurrency] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [match, setMatch] = useState("");
  const [search, setSearch] = useState("");

  const params = new URLSearchParams();
  if (source) params.set("source", source);
  if (currency) params.set("currency", currency);
  if (confirmation) params.set("confirmation", confirmation);
  if (match) params.set("match", match);
  if (search) params.set("search", search);
  params.set("limit", "200");

  const { data, isLoading } = useSWR<PaymentsResponse>(
    `/payments?${params.toString()}`,
    fetcher
  );

  const activeFilters = [source, currency, confirmation, match, search].filter(Boolean).length;

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-1">Payments</h1>
      <p className="text-sm text-gray-500 mb-6">
        Every incoming payment with amount paid, deductions, and confirmation level.
      </p>

      {/* Filters */}
      <div className="bg-white rounded-lg border p-4 mb-6"
        style={{ borderColor: "var(--card-border)" }}>
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">Filter payments</span>
          {activeFilters > 0 && (
            <button
              onClick={() => { setSource(""); setCurrency(""); setConfirmation(""); setMatch(""); setSearch(""); }}
              className="text-xs text-gray-500 hover:text-gray-700 underline"
            >
              Clear all filters
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">How they paid</label>
            <select value={source} onChange={(e) => setSource(e.target.value)}
              className="w-full text-sm border border-gray-300 rounded-md px-3 py-2">
              <option value="">All methods</option>
              <option value="bank">Bank transfer (NEFT/UPI/IMPS)</option>
              <option value="gateway">Gateway (Stripe/PayGlocal/Razorpay)</option>
              <option value="cash">Cash</option>
              <option value="screenshot">Screenshot only</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Currency</label>
            <select value={currency} onChange={(e) => setCurrency(e.target.value)}
              className="w-full text-sm border border-gray-300 rounded-md px-3 py-2">
              <option value="">All currencies</option>
              <option value="INR">INR (₹)</option>
              <option value="USD">USD ($)</option>
              <option value="AED">AED</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Verified?</label>
            <select value={confirmation} onChange={(e) => setConfirmation(e.target.value)}
              className="w-full text-sm border border-gray-300 rounded-md px-3 py-2">
              <option value="">Any level</option>
              <option value="in_bank">Confirmed in bank</option>
              <option value="seen_by_gateway">Seen by gateway</option>
              <option value="screenshot_only">Screenshot only (unverified)</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Linked to a student?</label>
            <select value={match} onChange={(e) => setMatch(e.target.value)}
              className="w-full text-sm border border-gray-300 rounded-md px-3 py-2">
              <option value="">Any status</option>
              <option value="matched">Matched (auto or approved)</option>
              <option value="unmatched">Not matched yet</option>
              <option value="pending_review">Waiting for your review</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Payer name</label>
            <input
              type="text"
              placeholder="Search..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full text-sm border border-gray-300 rounded-md px-3 py-2"
            />
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="animate-pulse h-64 bg-gray-200 rounded" />
      ) : !data || data.items.length === 0 ? (
        <div className="bg-white rounded-lg border p-8 text-center" style={{ borderColor: "var(--card-border)" }}>
          <p className="text-gray-500">No payments match the filters.</p>
        </div>
      ) : (
        <>
          <p className="text-sm text-gray-500 mb-3">
            {data.total} payments
            {activeFilters > 0 && " (filtered)"}
          </p>
          <div className="bg-white rounded-lg border overflow-x-auto" style={{ borderColor: "var(--card-border)" }}>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b bg-gray-50">
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Payer</th>
                  <th className="px-4 py-3 font-medium text-right">Amount</th>
                  <th className="px-4 py-3 font-medium text-right">Deductions</th>
                  <th className="px-4 py-3 font-medium text-right">In Bank</th>
                  <th className="px-4 py-3 font-medium">Method</th>
                  <th className="px-4 py-3 font-medium">Confirmation</th>
                  <th className="px-4 py-3 font-medium">Match</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.items.map((r) => (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 whitespace-nowrap">{formatDate(r.date)}</td>
                    <td className="px-4 py-2.5 font-medium text-gray-900 max-w-[200px] truncate">
                      {r.payer_name || "(blank)"}
                    </td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap font-medium">
                      {formatMoney(r.amount_paid_paise, r.currency)}
                    </td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap text-gray-500">
                      {r.deductions_paise > 0 ? formatMoney(r.deductions_paise, r.currency) : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      {r.amount_in_bank_paise > 0 ? formatMoney(r.amount_in_bank_paise, "INR") : "—"}
                    </td>
                    <td className="px-4 py-2.5 uppercase text-xs">{r.method || r.source}</td>
                    <td className="px-4 py-2.5">
                      <span className="px-2 py-0.5 rounded text-xs font-medium"
                        style={{
                          backgroundColor: confirmBadge[r.confirmation]?.bg ?? "#f3f4f6",
                          color: confirmBadge[r.confirmation]?.text ?? "#374151",
                        }}>
                        {r.confirmation.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      {r.match_id && r.match_status === "pending_review" ? (
                        <Link href={`/review?id=${r.match_id}`}
                          className="px-2 py-0.5 rounded text-xs font-medium hover:opacity-80 inline-block"
                          style={{
                            backgroundColor: matchBadge.pending_review.bg,
                            color: matchBadge.pending_review.text,
                          }}>
                          review →
                        </Link>
                      ) : r.match_status === "unmatched" ? (
                        <Link href="/review"
                          className="px-2 py-0.5 rounded text-xs font-medium hover:opacity-80 inline-block"
                          style={{
                            backgroundColor: matchBadge.unmatched.bg,
                            color: matchBadge.unmatched.text,
                          }}>
                          unmatched →
                        </Link>
                      ) : (
                        <span className="px-2 py-0.5 rounded text-xs font-medium"
                          style={{
                            backgroundColor: matchBadge[r.match_status]?.bg ?? "#f3f4f6",
                            color: matchBadge[r.match_status]?.text ?? "#374151",
                          }}>
                          {r.match_status.replace(/_/g, " ")}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
