"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { apiFetch } from "@/lib/api";
import { formatMoney, formatMoneyCompact, formatDate } from "@/lib/format";

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

function Popover({ trigger, children }: { trigger: React.ReactNode; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const ref = useRef<HTMLSpanElement>(null);

  function show() {
    if (ref.current) {
      const rect = ref.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 4, left: rect.right });
    }
    setOpen(true);
  }

  return (
    <>
      <span ref={ref} className="cursor-help" onMouseEnter={show} onMouseLeave={() => setOpen(false)}>
        {trigger}
      </span>
      {open && (
        <div
          className="fixed z-[9999] bg-gray-900 text-white text-xs rounded-lg px-3 py-2 shadow-lg"
          style={{ top: pos.top, left: pos.left, transform: "translateX(-100%)" }}
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
        >
          {children}
        </div>
      )}
    </>
  );
}

function DeductionBreakdown({ r }: { r: PaymentRow }) {
  if (r.deductions_paise <= 0) return <span>—</span>;
  const parts: { label: string; value: string }[] = [];
  if (r.gateway_fee_paise > 0) parts.push({ label: "Gateway fee", value: formatMoney(r.gateway_fee_paise, r.currency) });
  if (r.gst_on_fee_paise > 0) parts.push({ label: "GST on fee", value: formatMoney(r.gst_on_fee_paise, r.currency) });
  if (r.tds_paise > 0) parts.push({ label: "TDS", value: formatMoney(r.tds_paise, r.currency) });
  if (r.fx_diff_paise > 0) parts.push({ label: "FX loss", value: formatMoney(r.fx_diff_paise, r.currency) });
  return (
    <Popover trigger={<span className="underline decoration-dotted">{formatMoney(r.deductions_paise, r.currency)}</span>}>
      <div className="whitespace-nowrap">
        {parts.map((p, i) => (
          <div key={i} className="flex justify-between gap-4">
            <span className="text-gray-300">{p.label}</span>
            <span className="font-medium">{p.value}</span>
          </div>
        ))}
        <div className="flex justify-between gap-4 border-t border-gray-700 mt-1 pt-1">
          <span className="text-gray-300">Total</span>
          <span className="font-medium">{formatMoney(r.deductions_paise, r.currency)}</span>
        </div>
      </div>
    </Popover>
  );
}

function ConfirmBadge({ confirmation }: { confirmation: string }) {
  const info = confirmBadge[confirmation];
  const style = {
    backgroundColor: info?.bg ?? "#f3f4f6",
    color: info?.text ?? "#374151",
  };
  return info?.tip ? (
    <Popover trigger={<span className="px-2 py-0.5 rounded text-xs font-medium" style={style}>{confirmation.replace(/_/g, " ")}</span>}>
      <div className="w-52 leading-relaxed">{info.tip}</div>
    </Popover>
  ) : (
    <span className="px-2 py-0.5 rounded text-xs font-medium" style={style}>
      {confirmation.replace(/_/g, " ")}
    </span>
  );
}

type SortKey = "date" | "payer_name" | "amount_paid_paise" | "amount_in_bank_paise" | null;
type SortDir = "asc" | "desc";

const PAGE_SIZE = 50;

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function exportCSV(items: PaymentRow[]) {
  const headers = ["Date", "Payer", "Amount", "Currency", "Gateway Fee", "GST on Fee", "TDS", "FX Diff", "Deductions", "In Bank (INR)", "Method", "Confirmation", "Match Status"];
  const rows = items.map((r) => [
    r.date,
    r.payer_name ?? "",
    (r.amount_paid_paise / 100).toFixed(0),
    r.currency,
    (r.gateway_fee_paise / 100).toFixed(0),
    (r.gst_on_fee_paise / 100).toFixed(0),
    (r.tds_paise / 100).toFixed(0),
    (r.fx_diff_paise / 100).toFixed(0),
    (r.deductions_paise / 100).toFixed(0),
    (r.amount_in_bank_paise / 100).toFixed(0),
    r.method || r.source,
    r.confirmation,
    r.match_status,
  ]);
  const csv = [headers, ...rows].map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `payments_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function PaymentsPage() {
  const [source, setSource] = useState("");
  const [currency, setCurrency] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [match, setMatch] = useState("");
  const [search, setSearch] = useState("");
  const [month, setMonth] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(0);
  const [showDetails, setShowDetails] = useState(false);

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

  const activeFilters = [source, currency, confirmation, match, search, month].filter(Boolean).length;

  function clearAll() {
    setSource(""); setCurrency(""); setConfirmation(""); setMatch(""); setSearch(""); setMonth(""); setPage(0);
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      if (sortDir === "asc") {
        setSortDir("desc");
      } else {
        setSortKey(null);
      }
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
    setPage(0);
  }

  // Apply client-side month filter
  const filtered = useMemo(() => {
    if (!data) return [];
    if (!month) return data.items;
    return data.items.filter((r) => r.date.startsWith(month));
  }, [data, month]);

  const sorted = useMemo(() => {
    const items = [...filtered];
    if (sortKey) {
      items.sort((a, b) => {
        const av: string | number = a[sortKey] ?? "";
        const bv: string | number = b[sortKey] ?? "";
        if (typeof av === "string" && typeof bv === "string") {
          const cmp = av.localeCompare(bv);
          return sortDir === "asc" ? cmp : -cmp;
        }
        const na = Number(av), nb = Number(bv);
        return sortDir === "asc" ? na - nb : nb - na;
      });
    }
    return items;
  }, [filtered, sortKey, sortDir]);

  // Compute summary stats from the filtered set
  const stats = useMemo(() => {
    const totalReceived = filtered.reduce((s, r) => s + r.amount_in_bank_paise, 0);
    const screenshotCount = filtered.filter((r) => r.confirmation === "screenshot_only").length;
    const unmatchedCount = filtered.filter((r) => r.match_status === "unmatched").length;
    const reviewCount = filtered.filter((r) => r.match_status === "pending_review").length;
    const blankCount = filtered.filter((r) => !r.payer_name).length;
    return { totalReceived, screenshotCount, unmatchedCount, reviewCount, blankCount };
  }, [filtered]);

  // Determine available months from the data for the filter dropdown
  const availableMonths = useMemo(() => {
    if (!data) return [];
    const set = new Set<string>();
    for (const r of data.items) {
      if (r.date) set.add(r.date.slice(0, 7)); // "2026-09"
    }
    return Array.from(set).sort().reverse();
  }, [data]);

  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  const pageItems = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  function SortHeader({ label, field, align }: { label: string; field: SortKey; align?: string }) {
    const active = sortKey === field;
    return (
      <th
        className={`px-4 py-3 font-medium cursor-pointer hover:text-gray-700 select-none ${align === "right" ? "text-right" : ""}`}
        onClick={() => toggleSort(field)}
      >
        {label}
        {active
          ? <span className="ml-1 text-gray-900">{sortDir === "asc" ? "↑" : "↓"}</span>
          : <span className="ml-1 text-gray-300">↕</span>}
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
            <button onClick={clearAll} className="text-xs text-gray-500 hover:text-gray-700 underline">
              Clear all filters
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
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
            <label className="block text-xs text-gray-500 mb-1">Month</label>
            <select value={month} onChange={(e) => { setMonth(e.target.value); setPage(0); }}
              className="w-full text-sm border border-gray-300 rounded-md px-3 py-2">
              <option value="">All time</option>
              {availableMonths.map((m) => {
                const [y, mo] = m.split("-");
                return <option key={m} value={m}>{MONTHS[parseInt(mo) - 1]} {y}</option>;
              })}
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
      ) : !data || filtered.length === 0 ? (
        <div className="bg-white rounded-lg border p-8 text-center" style={{ borderColor: "var(--card-border)" }}>
          <p className="text-gray-500">No payments match the filters.</p>
        </div>
      ) : (
        <>
          {/* Summary bar */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
            <div className="bg-white rounded-lg border px-4 py-3" style={{ borderColor: "var(--card-border)" }}>
              <div className="text-xs text-gray-500">Total received</div>
              <div className="text-lg font-bold text-gray-900">{formatMoneyCompact(stats.totalReceived, "INR")}</div>
              <div className="text-xs text-gray-400">in bank (INR)</div>
            </div>
            <div className="bg-white rounded-lg border px-4 py-3" style={{ borderColor: "var(--card-border)" }}>
              <div className="text-xs text-gray-500">Payments</div>
              <div className="text-lg font-bold text-gray-900">{filtered.length}</div>
              <div className="text-xs text-gray-400">{activeFilters > 0 ? "matching filters" : "total"}</div>
            </div>
            {stats.reviewCount > 0 && (
              <Link href="/review"
                className="bg-amber-50 rounded-lg border border-amber-200 px-4 py-3 hover:border-amber-400 transition-colors block">
                <div className="text-xs text-amber-700">Needs review</div>
                <div className="text-lg font-bold text-amber-800">{stats.reviewCount}</div>
                <div className="text-xs text-amber-600">waiting for you →</div>
              </Link>
            )}
            {stats.unmatchedCount > 0 && (
              <button onClick={() => { clearAll(); setMatch("unmatched"); }}
                className={`text-left rounded-lg border px-4 py-3 hover:border-gray-400 transition-colors ${match === "unmatched" ? "ring-2 ring-gray-300" : ""}`}
                style={{ borderColor: "var(--card-border)" }}>
                <div className="text-xs text-gray-500">Unmatched</div>
                <div className="text-lg font-bold text-gray-900">{stats.unmatchedCount}</div>
                <div className="text-xs text-gray-400">{stats.blankCount > 0 ? `${stats.blankCount} with no payer name` : "no student linked"} →</div>
              </button>
            )}
            {stats.screenshotCount > 0 && (
              <button onClick={() => { clearAll(); setConfirmation("screenshot_only"); }}
                className={`text-left bg-red-50 rounded-lg border border-red-200 px-4 py-3 hover:border-red-400 transition-colors ${confirmation === "screenshot_only" ? "ring-2 ring-red-300" : ""}`}>
                <div className="text-xs text-red-700">Unverified</div>
                <div className="text-lg font-bold text-red-800">{stats.screenshotCount}</div>
                <div className="text-xs text-red-600">screenshot only — not confirmed →</div>
              </button>
            )}
          </div>

          {/* Pagination top + export */}
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm text-gray-500">
              {sorted.length} payments{activeFilters > 0 ? " (filtered)" : ""}
              {totalPages > 1 && ` · page ${page + 1} of ${totalPages}`}
            </p>
            <div className="flex items-center gap-3">
              <button onClick={() => setShowDetails((v) => !v)}
                className={`px-3 py-1.5 text-xs font-medium border rounded-md hover:bg-gray-50 ${showDetails ? "border-gray-900 bg-gray-100" : "border-gray-300"}`}>
                {showDetails ? "Hide details" : "Show details"}
              </button>
              <button onClick={() => exportCSV(sorted)}
                className="px-3 py-1.5 text-xs font-medium border border-gray-300 rounded-md hover:bg-gray-50">
                Export CSV
              </button>
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
          </div>

          <div className="bg-white rounded-lg border overflow-x-auto" style={{ borderColor: "var(--card-border)" }}>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b bg-gray-50">
                  <SortHeader label="Date" field="date" />
                  <SortHeader label="Payer" field="payer_name" />
                  <SortHeader label="Amount" field="amount_paid_paise" align="right" />
                  {showDetails && <th className="px-4 py-3 font-medium text-right">Deductions</th>}
                  <SortHeader label="In Bank (₹)" field="amount_in_bank_paise" align="right" />
                  {showDetails && <th className="px-4 py-3 font-medium">Method</th>}
                  {showDetails && <th className="px-4 py-3 font-medium">Confirmation</th>}
                  <th className="px-4 py-3 font-medium">Match</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {pageItems.map((r) => {
                  const isScreenshot = r.confirmation === "screenshot_only";
                  const isBlank = !r.payer_name;
                  return (
                    <tr key={r.id} className={
                      isScreenshot ? "bg-red-50/40 hover:bg-red-50" :
                      isBlank ? "bg-amber-50/40 hover:bg-amber-50" :
                      "hover:bg-gray-50"
                    }>
                      <td className="px-4 py-2.5 whitespace-nowrap">{formatDate(r.date)}</td>
                      <td className="px-4 py-2.5 font-medium text-gray-900 max-w-[200px] truncate">
                        {r.payer_name ? (
                          <Link href={`/students?search=${encodeURIComponent(r.payer_name)}`}
                            className="hover:underline hover:text-teal-700">
                            {r.payer_name}
                          </Link>
                        ) : <span className="text-amber-500 font-normal">(no payer name)</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap font-medium">
                        {formatMoney(r.amount_paid_paise, r.currency)}
                      </td>
                      {showDetails && (
                        <td className="px-4 py-2.5 text-right whitespace-nowrap text-gray-500">
                          <DeductionBreakdown r={r} />
                        </td>
                      )}
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        {r.amount_in_bank_paise > 0 ? formatMoney(r.amount_in_bank_paise, "INR") : "—"}
                      </td>
                      {showDetails && <td className="px-4 py-2.5 text-xs">{friendlyMethod(r.method, r.source)}</td>}
                      {showDetails && (
                        <td className="px-4 py-2.5">
                          <ConfirmBadge confirmation={r.confirmation} />
                        </td>
                      )}
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
                          <span className="px-2 py-0.5 rounded text-xs font-medium"
                            style={{
                              backgroundColor: matchBadge.unmatched.bg,
                              color: matchBadge.unmatched.text,
                            }}>
                            unmatched
                          </span>
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
          {stats.blankCount > 0 && (
            <p className="text-xs text-gray-400 mt-2">
              {stats.blankCount} payment{stats.blankCount > 1 ? "s" : ""} show &ldquo;(blank)&rdquo; as the payer name.
              This happens when the bank statement or gateway report does not include the sender&rsquo;s
              name — common with UPI, NEFT batch transfers, and some international gateways. These
              payments need manual review to match them to a student.
            </p>
          )}
        </>
      )}
    </div>
  );
}
