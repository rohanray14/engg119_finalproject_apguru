"use client";

import { useMemo, useState } from "react";
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

const confirmBadge: Record<string, { bg: string; text: string; tip: string }> = {
  in_bank: { bg: "#dcfce7", text: "#166534", tip: "Verified against bank statement — money is in the account" },
  seen_by_gateway: { bg: "#fef3c7", text: "#92400e", tip: "Gateway (Stripe/Razorpay/PayGlocal) confirms the payment, but not yet reconciled with bank" },
  screenshot_only: { bg: "#fee2e2", text: "#991b1b", tip: "Only evidence is a screenshot — not verified by bank or gateway" },
};

const matchBadge: Record<string, { bg: string; text: string }> = {
  auto: { bg: "#dcfce7", text: "#166534" },
  approved: { bg: "#dcfce7", text: "#166534" },
  pending_review: { bg: "#fef3c7", text: "#92400e" },
  rejected: { bg: "#fee2e2", text: "#991b1b" },
  unmatched: { bg: "#f3f4f6", text: "#374151" },
};

const methodLabels: Record<string, string> = {
  NEFT: "Bank Transfer (NEFT)",
  UPI: "UPI",
  IMPS: "Bank Transfer (IMPS)",
  RTGS: "Bank Transfer (RTGS)",
  STRIPE: "Stripe",
  PAYGLOCAL: "PayGlocal",
  RAZORPAY: "Razorpay",
  SCREENSHOT: "Screenshot",
  CASH: "Cash",
  bank: "Bank Transfer",
  gateway: "Gateway",
  cash: "Cash",
  screenshot: "Screenshot",
};

function friendlyMethod(method: string | null, source: string): string {
  const raw = method || source;
  return methodLabels[raw] ?? methodLabels[raw.toUpperCase()] ?? raw;
}

function DeductionBreakdown({ r }: { r: PaymentRow }) {
  if (r.deductions_paise <= 0) return <span>—</span>;
  const parts: { label: string; value: string }[] = [];
  if (r.gateway_fee_paise > 0) parts.push({ label: "Gateway fee", value: formatMoney(r.gateway_fee_paise, r.currency) });
  if (r.gst_on_fee_paise > 0) parts.push({ label: "GST on fee", value: formatMoney(r.gst_on_fee_paise, r.currency) });
  if (r.tds_paise > 0) parts.push({ label: "TDS", value: formatMoney(r.tds_paise, r.currency) });
  if (r.fx_diff_paise > 0) parts.push({ label: "FX loss", value: formatMoney(r.fx_diff_paise, r.currency) });
  return (
    <span className="relative group cursor-help">
      <span className="underline decoration-dotted">{formatMoney(r.deductions_paise, r.currency)}</span>
      <span className="hidden group-hover:block absolute right-0 top-full mt-1 z-50 bg-gray-900 text-white text-xs rounded-lg px-3 py-2 whitespace-nowrap shadow-lg">
        {parts.map((p, i) => (
          <span key={i} className="flex justify-between gap-4">
            <span className="text-gray-300">{p.label}</span>
            <span className="font-medium">{p.value}</span>
          </span>
        ))}
        <span className="flex justify-between gap-4 border-t border-gray-700 mt-1 pt-1">
          <span className="text-gray-300">Total</span>
          <span className="font-medium">{formatMoney(r.deductions_paise, r.currency)}</span>
        </span>
      </span>
    </span>
  );
}

function ConfirmBadge({ confirmation }: { confirmation: string }) {
  const info = confirmBadge[confirmation];
  const style = {
    backgroundColor: info?.bg ?? "#f3f4f6",
    color: info?.text ?? "#374151",
  };
  return (
    <span className="relative group">
      <span className="px-2 py-0.5 rounded text-xs font-medium cursor-help" style={style}>
        {confirmation.replace(/_/g, " ")}
      </span>
      {info?.tip && (
        <span className="hidden group-hover:block absolute right-0 top-full mt-1 z-50 bg-gray-900 text-white text-xs rounded-lg px-3 py-2 w-56 shadow-lg leading-relaxed">
          {info.tip}
        </span>
      )}
    </span>
  );
}

type SortKey = "date" | "payer_name" | "amount_paid_paise" | "amount_in_bank_paise" | null;
type SortDir = "asc" | "desc";

const PAGE_SIZE = 50;

export default function PaymentsPage() {
  const [source, setSource] = useState("");
  const [currency, setCurrency] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [match, setMatch] = useState("");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(0);

  const params = new URLSearchParams();
  if (source) params.set("source", source);
  if (currency) params.set("currency", currency);
  if (confirmation) params.set("confirmation", confirmation);
  if (match) params.set("match", match);
  if (search) params.set("search", search);
  params.set("limit", "500");

  const { data, isLoading } = useSWR<PaymentsResponse>(
    `/payments?${params.toString()}`,
    fetcher
  );

  const activeFilters = [source, currency, confirmation, match, search].filter(Boolean).length;

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir(key === "date" ? "desc" : "asc");
    }
    setPage(0);
  }

  const sorted = useMemo(() => {
    if (!data) return [];
    const items = [...data.items];
    if (sortKey) {
      items.sort((a, b) => {
        let av: string | number = a[sortKey] ?? "";
        let bv: string | number = b[sortKey] ?? "";
        if (typeof av === "string" && typeof bv === "string") {
          const cmp = av.localeCompare(bv);
          return sortDir === "asc" ? cmp : -cmp;
        }
        const na = Number(av), nb = Number(bv);
        return sortDir === "asc" ? na - nb : nb - na;
      });
    }
    return items;
  }, [data, sortKey, sortDir]);

  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  const pageItems = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  function SortHeader({ label, field, align }: { label: string; field: SortKey; align?: string }) {
    const active = sortKey === field;
    const arrow = active ? (sortDir === "asc" ? " ↑" : " ↓") : "";
    return (
      <th
        className={`px-4 py-3 font-medium cursor-pointer hover:text-gray-700 select-none ${align === "right" ? "text-right" : ""}`}
        onClick={() => toggleSort(field)}
      >
        {label}{arrow}
      </th>
    );
  }

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
              onClick={() => { setSource(""); setCurrency(""); setConfirmation(""); setMatch(""); setSearch(""); setPage(0); }}
              className="text-xs text-gray-500 hover:text-gray-700 underline"
            >
              Clear all filters
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">How they paid</label>
            <select value={source} onChange={(e) => { setSource(e.target.value); setPage(0); }}
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
            <select value={currency} onChange={(e) => { setCurrency(e.target.value); setPage(0); }}
              className="w-full text-sm border border-gray-300 rounded-md px-3 py-2">
              <option value="">All currencies</option>
              <option value="INR">INR (₹)</option>
              <option value="USD">USD ($)</option>
              <option value="AED">AED</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Verified?</label>
            <select value={confirmation} onChange={(e) => { setConfirmation(e.target.value); setPage(0); }}
              className="w-full text-sm border border-gray-300 rounded-md px-3 py-2">
              <option value="">Any level</option>
              <option value="in_bank">Confirmed in bank</option>
              <option value="seen_by_gateway">Seen by gateway</option>
              <option value="screenshot_only">Screenshot only (unverified)</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Linked to a student?</label>
            <select value={match} onChange={(e) => { setMatch(e.target.value); setPage(0); }}
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
              onChange={(e) => { setSearch(e.target.value); setPage(0); }}
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
          {/* Summary + pagination top */}
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm text-gray-500">
              {sorted.length} payments{activeFilters > 0 ? " (filtered)" : ""}
              {totalPages > 1 && ` · page ${page + 1} of ${totalPages}`}
            </p>
            {totalPages > 1 && (
              <div className="flex items-center gap-1">
                <button onClick={() => setPage(0)} disabled={page === 0}
                  className="px-2 py-1 text-xs border rounded disabled:opacity-30">First</button>
                <button onClick={() => setPage(page - 1)} disabled={page === 0}
                  className="px-2 py-1 text-xs border rounded disabled:opacity-30">Prev</button>
                <span className="text-xs text-gray-500 px-2">{page + 1} / {totalPages}</span>
                <button onClick={() => setPage(page + 1)} disabled={page >= totalPages - 1}
                  className="px-2 py-1 text-xs border rounded disabled:opacity-30">Next</button>
                <button onClick={() => setPage(totalPages - 1)} disabled={page >= totalPages - 1}
                  className="px-2 py-1 text-xs border rounded disabled:opacity-30">Last</button>
              </div>
            )}
          </div>

          <div className="bg-white rounded-lg border overflow-x-auto" style={{ borderColor: "var(--card-border)" }}>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b bg-gray-50">
                  <SortHeader label="Date" field="date" />
                  <SortHeader label="Payer" field="payer_name" />
                  <SortHeader label="Amount" field="amount_paid_paise" align="right" />
                  <th className="px-4 py-3 font-medium text-right">Deductions</th>
                  <SortHeader label="In Bank (₹)" field="amount_in_bank_paise" align="right" />
                  <th className="px-4 py-3 font-medium">Method</th>
                  <th className="px-4 py-3 font-medium">Confirmation</th>
                  <th className="px-4 py-3 font-medium">Match</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {pageItems.map((r) => {
                  const isScreenshot = r.confirmation === "screenshot_only";
                  return (
                    <tr key={r.id} className={isScreenshot ? "bg-red-50/40 hover:bg-red-50" : "hover:bg-gray-50"}>
                      <td className="px-4 py-2.5 whitespace-nowrap">{formatDate(r.date)}</td>
                      <td className="px-4 py-2.5 font-medium text-gray-900 max-w-[200px] truncate">
                        {r.payer_name || <span className="text-gray-400 font-normal">(blank)</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap font-medium">
                        {formatMoney(r.amount_paid_paise, r.currency)}
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap text-gray-500">
                        <DeductionBreakdown r={r} />
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        {r.amount_in_bank_paise > 0 ? formatMoney(r.amount_in_bank_paise, "INR") : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-xs">{friendlyMethod(r.method, r.source)}</td>
                      <td className="px-4 py-2.5">
                        <ConfirmBadge confirmation={r.confirmation} />
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
                              backgroundColor: r.payer_name ? "#dbeafe" : matchBadge.unmatched.bg,
                              color: r.payer_name ? "#1e40af" : matchBadge.unmatched.text,
                            }}>
                            {r.payer_name ? "try matching →" : "unmatched →"}
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
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination bottom */}
          {totalPages > 1 && (
            <div className="flex justify-center mt-4 gap-1">
              <button onClick={() => setPage(0)} disabled={page === 0}
                className="px-2 py-1 text-xs border rounded disabled:opacity-30">First</button>
              <button onClick={() => setPage(page - 1)} disabled={page === 0}
                className="px-2 py-1 text-xs border rounded disabled:opacity-30">Prev</button>
              {Array.from({ length: totalPages }, (_, i) => (
                <button key={i} onClick={() => setPage(i)}
                  className={`px-2.5 py-1 text-xs border rounded ${i === page ? "bg-gray-900 text-white border-gray-900" : "hover:bg-gray-50"}`}>
                  {i + 1}
                </button>
              )).slice(
                Math.max(0, page - 3),
                Math.min(totalPages, page + 4)
              )}
              <button onClick={() => setPage(page + 1)} disabled={page >= totalPages - 1}
                className="px-2 py-1 text-xs border rounded disabled:opacity-30">Next</button>
              <button onClick={() => setPage(totalPages - 1)} disabled={page >= totalPages - 1}
                className="px-2 py-1 text-xs border rounded disabled:opacity-30">Last</button>
            </div>
          )}

          <p className="text-xs text-gray-400 mt-3">
            &ldquo;In Bank&rdquo; shows the amount received after gateway fees, GST, and FX conversion — always in INR (₹).
            Hover over deductions to see the breakdown.
          </p>
        </>
      )}
    </div>
  );
}
