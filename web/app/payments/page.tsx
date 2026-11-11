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
  matched_student_id: number | null;
  matched_student_name: string | null;
}

interface PaymentsResponse {
  total: number;
  limit: number;
  offset: number;
  items: PaymentRow[];
}

function fetcher<T>(path: string) { return apiFetch<T>(path); }

const confirmBadge: Record<string, { bg: string; text: string; tip: string }> = {
  in_bank: { bg: "rgba(0, 220, 130, 0.15)", text: "var(--accent)", tip: "Verified against bank statement — money is in the account" },
  seen_by_gateway: { bg: "rgba(255, 176, 32, 0.15)", text: "var(--warning)", tip: "Gateway (Stripe/Razorpay/PayGlocal) confirms the payment, but not yet reconciled with bank" },
  screenshot_only: { bg: "rgba(255, 77, 77, 0.15)", text: "var(--danger)", tip: "Only evidence is a screenshot — not verified by bank or gateway" },
};

const matchBadge: Record<string, { bg: string; text: string }> = {
  auto: { bg: "rgba(0, 220, 130, 0.15)", text: "var(--accent)" },
  approved: { bg: "rgba(0, 220, 130, 0.15)", text: "var(--accent)" },
  pending_review: { bg: "rgba(255, 176, 32, 0.15)", text: "var(--warning)" },
  rejected: { bg: "rgba(255, 77, 77, 0.15)", text: "var(--danger)" },
  unmatched: { bg: "var(--surface-hover)", text: "var(--text-secondary)" },
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
          className="fixed z-[9999] text-xs rounded-lg px-3 py-2"
          style={{ top: pos.top, left: pos.left, transform: "translateX(-100%)", backgroundColor: "#252530", color: "var(--text)", border: "1px solid var(--border)", boxShadow: "0 4px 12px rgba(0,0,0,0.5)" }}
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
  if (r.deductions_paise <= 0) return <span>{"—"}</span>;
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
            <span style={{ color: "var(--text-tertiary)" }}>{p.label}</span>
            <span className="font-medium">{p.value}</span>
          </div>
        ))}
        <div className="flex justify-between gap-4 mt-1 pt-1" style={{ borderTop: "1px solid var(--border)" }}>
          <span style={{ color: "var(--text-tertiary)" }}>Total</span>
          <span className="font-medium">{formatMoney(r.deductions_paise, r.currency)}</span>
        </div>
      </div>
    </Popover>
  );
}

function ConfirmBadge({ confirmation }: { confirmation: string }) {
  const info = confirmBadge[confirmation];
  const style = {
    backgroundColor: info?.bg ?? "var(--surface-hover)",
    color: info?.text ?? "var(--text-secondary)",
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
        className={`px-4 py-3 font-medium cursor-pointer select-none ${align === "right" ? "text-right" : ""}`}
        style={{ color: "var(--text-secondary)" }}
        onClick={() => toggleSort(field)}
      >
        {label}
        {active
          ? <span className="ml-1" style={{ color: "var(--text)" }}>{sortDir === "asc" ? "\u2191" : "\u2193"}</span>
          : <span className="ml-1" style={{ color: "var(--text-tertiary)" }}>{"\u2195"}</span>}
      </th>
    );
  }

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-1" style={{ color: "var(--text)" }}>Payments</h1>
      <p className="text-sm mb-6" style={{ color: "var(--text-secondary)" }}>
        Every incoming payment with amount paid, deductions, and confirmation level.
      </p>

      {/* Filters */}
      <div className="rounded-xl border p-4 mb-6"
        style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-tertiary)" }}>Filter payments</span>
          {activeFilters > 0 && (
            <button onClick={clearAll} className="text-xs underline" style={{ color: "var(--text-secondary)" }}>
              Clear all filters
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <div>
            <label className="block text-xs mb-1" style={{ color: "var(--text-secondary)" }}>How they paid</label>
            <select value={source} onChange={(e) => { setSource(e.target.value); setPage(0); }}
              className="w-full text-sm rounded-md px-3 py-2"
              style={{ backgroundColor: "var(--surface-hover)", border: "1px solid var(--border)", color: "var(--text)" }}>
              <option value="">All methods</option>
              <option value="bank">Bank transfer (NEFT/UPI/IMPS)</option>
              <option value="gateway">Gateway (Stripe/PayGlocal/Razorpay)</option>
              <option value="cash">Cash</option>
              <option value="screenshot">Screenshot only</option>
            </select>
          </div>
          <div>
            <label className="block text-xs mb-1" style={{ color: "var(--text-secondary)" }}>Currency</label>
            <select value={currency} onChange={(e) => { setCurrency(e.target.value); setPage(0); }}
              className="w-full text-sm rounded-md px-3 py-2"
              style={{ backgroundColor: "var(--surface-hover)", border: "1px solid var(--border)", color: "var(--text)" }}>
              <option value="">All currencies</option>
              <option value="INR">INR (₹)</option>
            </select>
          </div>
          <div>
            <label className="block text-xs mb-1" style={{ color: "var(--text-secondary)" }}>Month</label>
            <select value={month} onChange={(e) => { setMonth(e.target.value); setPage(0); }}
              className="w-full text-sm rounded-md px-3 py-2"
              style={{ backgroundColor: "var(--surface-hover)", border: "1px solid var(--border)", color: "var(--text)" }}>
              <option value="">All time</option>
              {availableMonths.map((m) => {
                const [y, mo] = m.split("-");
                return <option key={m} value={m}>{MONTHS[parseInt(mo) - 1]} {y}</option>;
              })}
            </select>
          </div>
          <div>
            <label className="block text-xs mb-1" style={{ color: "var(--text-secondary)" }}>Verified?</label>
            <select value={confirmation} onChange={(e) => { setConfirmation(e.target.value); setPage(0); }}
              className="w-full text-sm rounded-md px-3 py-2"
              style={{ backgroundColor: "var(--surface-hover)", border: "1px solid var(--border)", color: "var(--text)" }}>
              <option value="">Any level</option>
              <option value="in_bank">Confirmed in bank</option>
              <option value="seen_by_gateway">Seen by gateway</option>
              <option value="screenshot_only">Screenshot only (unverified)</option>
            </select>
          </div>
          <div>
            <label className="block text-xs mb-1" style={{ color: "var(--text-secondary)" }}>Linked to a student?</label>
            <select value={match} onChange={(e) => { setMatch(e.target.value); setPage(0); }}
              className="w-full text-sm rounded-md px-3 py-2"
              style={{ backgroundColor: "var(--surface-hover)", border: "1px solid var(--border)", color: "var(--text)" }}>
              <option value="">Any status</option>
              <option value="matched">Matched (auto or approved)</option>
              <option value="unmatched">Not matched yet</option>
              <option value="pending_review">Waiting for your review</option>
            </select>
          </div>
          <div>
            <label className="block text-xs mb-1" style={{ color: "var(--text-secondary)" }}>Payer name</label>
            <input
              type="text"
              placeholder="Search..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              className="w-full text-sm rounded-md px-3 py-2"
              style={{ backgroundColor: "var(--surface-hover)", border: "1px solid var(--border)", color: "var(--text)" }}
            />
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="animate-pulse h-64 rounded" style={{ backgroundColor: "var(--surface)" }} />
      ) : !data || filtered.length === 0 ? (
        <div className="rounded-xl border p-8 text-center" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
          <p style={{ color: "var(--text-secondary)" }}>No payments match the filters.</p>
        </div>
      ) : (
        <>
          {/* Summary bar */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
            <div className="rounded-xl border px-4 py-3" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
              <div className="text-xs" style={{ color: "var(--text-secondary)" }}>Total received</div>
              <div className="text-lg font-bold" style={{ color: "var(--text)" }}>{formatMoneyCompact(stats.totalReceived, "INR")}</div>
              <div className="text-xs" style={{ color: "var(--text-tertiary)" }}>in bank (INR)</div>
            </div>
            <div className="rounded-xl border px-4 py-3" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
              <div className="text-xs" style={{ color: "var(--text-secondary)" }}>Payments</div>
              <div className="text-lg font-bold" style={{ color: "var(--text)" }}>{filtered.length}</div>
              <div className="text-xs" style={{ color: "var(--text-tertiary)" }}>{activeFilters > 0 ? "matching filters" : "total"}</div>
            </div>
            {stats.reviewCount > 0 && (
              <Link href="/review"
                className="rounded-xl border px-4 py-3 transition-colors block"
                style={{ backgroundColor: "rgba(255, 176, 32, 0.1)", borderColor: "rgba(255, 176, 32, 0.3)" }}>
                <div className="text-xs" style={{ color: "var(--warning)" }}>Needs review</div>
                <div className="text-lg font-bold" style={{ color: "var(--warning)" }}>{stats.reviewCount}</div>
                <div className="text-xs" style={{ color: "var(--warning)", opacity: 0.8 }}>waiting for you →</div>
              </Link>
            )}
            {stats.unmatchedCount > 0 && (
              <button onClick={() => { setMatch(match === "unmatched" ? "" : "unmatched"); setPage(0); }}
                className={`text-left rounded-xl border px-4 py-3 transition-colors ${match === "unmatched" ? "ring-2" : ""}`}
                style={{ borderColor: "var(--border)" }}>
                <div className="text-xs" style={{ color: "var(--text-secondary)" }}>Unmatched</div>
                <div className="text-lg font-bold" style={{ color: "var(--text)" }}>{stats.unmatchedCount}</div>
                <div className="text-xs" style={{ color: "var(--text-tertiary)" }}>{stats.blankCount > 0 ? `${stats.blankCount} with no payer name` : "no student linked"} →</div>
              </button>
            )}
            {stats.screenshotCount > 0 && (
              <button onClick={() => { setConfirmation(confirmation === "screenshot_only" ? "" : "screenshot_only"); setPage(0); }}
                className={`text-left rounded-xl border px-4 py-3 transition-colors ${confirmation === "screenshot_only" ? "ring-2" : ""}`}
                style={{ backgroundColor: "rgba(255, 77, 77, 0.1)", borderColor: "rgba(255, 77, 77, 0.3)" }}>
                <div className="text-xs" style={{ color: "var(--danger)" }}>Unverified</div>
                <div className="text-lg font-bold" style={{ color: "var(--danger)" }}>{stats.screenshotCount}</div>
                <div className="text-xs" style={{ color: "var(--danger)", opacity: 0.8 }}>screenshot only — not confirmed →</div>
              </button>
            )}
          </div>

          {/* Pagination top + export */}
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
              {sorted.length} payments{activeFilters > 0 ? " (filtered)" : ""}
              {totalPages > 1 && ` · page ${page + 1} of ${totalPages}`}
            </p>
            <div className="flex items-center gap-3">
              <button onClick={() => setShowDetails((v) => !v)}
                className="px-3 py-1.5 text-xs font-medium rounded-md"
                style={{
                  border: showDetails ? "1px solid var(--text)" : "1px solid var(--border)",
                  backgroundColor: showDetails ? "var(--surface-hover)" : "transparent",
                  color: "var(--text)",
                }}>
                {showDetails ? "Hide details" : "Show details"}
              </button>
              <button onClick={() => exportCSV(sorted)}
                className="px-3 py-1.5 text-xs font-medium rounded-md"
                style={{ border: "1px solid var(--border)", color: "var(--text)" }}>
                Export CSV
              </button>
              {totalPages > 1 && (
                <div className="flex items-center gap-1">
                  <button onClick={() => setPage(0)} disabled={page === 0}
                    className="px-2 py-1 text-xs rounded disabled:opacity-30"
                    style={{ border: "1px solid var(--border)", color: "var(--text)" }}>First</button>
                  <button onClick={() => setPage(page - 1)} disabled={page === 0}
                    className="px-2 py-1 text-xs rounded disabled:opacity-30"
                    style={{ border: "1px solid var(--border)", color: "var(--text)" }}>Prev</button>
                  <span className="text-xs px-2" style={{ color: "var(--text-secondary)" }}>{page + 1} / {totalPages}</span>
                  <button onClick={() => setPage(page + 1)} disabled={page >= totalPages - 1}
                    className="px-2 py-1 text-xs rounded disabled:opacity-30"
                    style={{ border: "1px solid var(--border)", color: "var(--text)" }}>Next</button>
                  <button onClick={() => setPage(totalPages - 1)} disabled={page >= totalPages - 1}
                    className="px-2 py-1 text-xs rounded disabled:opacity-30"
                    style={{ border: "1px solid var(--border)", color: "var(--text)" }}>Last</button>
                </div>
              )}
            </div>
          </div>

          <div className="rounded-xl border overflow-x-auto" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs border-b" style={{ color: "var(--text-secondary)", borderColor: "var(--border-subtle)", backgroundColor: "var(--surface-hover)" }}>
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
              <tbody>
                {pageItems.map((r) => {
                  const isScreenshot = r.confirmation === "screenshot_only";
                  const isBlank = !r.payer_name;
                  return (
                    <tr key={r.id}
                      style={{
                        borderBottom: "1px solid var(--border-subtle)",
                        backgroundColor: isScreenshot ? "rgba(255, 77, 77, 0.05)" : isBlank ? "rgba(255, 176, 32, 0.05)" : undefined,
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.backgroundColor = isScreenshot ? "rgba(255, 77, 77, 0.1)" : isBlank ? "rgba(255, 176, 32, 0.1)" : "var(--surface-hover)"}
                      onMouseLeave={(e) => e.currentTarget.style.backgroundColor = isScreenshot ? "rgba(255, 77, 77, 0.05)" : isBlank ? "rgba(255, 176, 32, 0.05)" : ""}
                    >
                      <td className="px-4 py-2.5 whitespace-nowrap">{formatDate(r.date)}</td>
                      <td className="px-4 py-2.5 font-medium max-w-[200px] truncate" style={{ color: "var(--text)" }}>
                        {r.payer_name ? (
                          <Link href={r.matched_student_id
                            ? `/students?id=${r.matched_student_id}`
                            : `/students?search=${encodeURIComponent(r.payer_name)}`}
                            className="hover:underline" style={{ color: "var(--accent)" }}>
                            {r.payer_name}
                          </Link>
                        ) : <span style={{ color: "var(--warning)", fontWeight: "normal" }}>(no payer name)</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap font-medium">
                        {formatMoney(r.amount_paid_paise, r.currency)}
                      </td>
                      {showDetails && (
                        <td className="px-4 py-2.5 text-right whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>
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
                        {r.matched_student_id ? (
                          <span className="inline-flex items-center gap-1.5">
                            <Link href={`/students?id=${r.matched_student_id}`}
                              className="px-2 py-0.5 rounded text-xs font-medium hover:opacity-80 inline-block"
                              style={{
                                backgroundColor: matchBadge[r.match_status]?.bg ?? matchBadge.auto.bg,
                                color: matchBadge[r.match_status]?.text ?? matchBadge.auto.text,
                              }}>
                              {r.matched_student_name ?? "Student"} →
                            </Link>
                            {r.match_status === "pending_review" && (
                              <Link href={`/review?id=${r.match_id}`}
                                style={{ color: "var(--warning)" }} title="Needs review">
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                              </Link>
                            )}
                          </span>
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
                              backgroundColor: matchBadge[r.match_status]?.bg ?? "var(--surface-hover)",
                              color: matchBadge[r.match_status]?.text ?? "var(--text-secondary)",
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
                className="px-2 py-1 text-xs rounded disabled:opacity-30"
                style={{ border: "1px solid var(--border)", color: "var(--text)" }}>First</button>
              <button onClick={() => setPage(page - 1)} disabled={page === 0}
                className="px-2 py-1 text-xs rounded disabled:opacity-30"
                style={{ border: "1px solid var(--border)", color: "var(--text)" }}>Prev</button>
              {Array.from({ length: totalPages }, (_, i) => (
                <button key={i} onClick={() => setPage(i)}
                  className="px-2.5 py-1 text-xs rounded"
                  style={i === page
                    ? { backgroundColor: "var(--text)", color: "var(--bg)", border: "1px solid var(--text)" }
                    : { border: "1px solid var(--border)", color: "var(--text)" }
                  }>
                  {i + 1}
                </button>
              )).slice(
                Math.max(0, page - 3),
                Math.min(totalPages, page + 4)
              )}
              <button onClick={() => setPage(page + 1)} disabled={page >= totalPages - 1}
                className="px-2 py-1 text-xs rounded disabled:opacity-30"
                style={{ border: "1px solid var(--border)", color: "var(--text)" }}>Next</button>
              <button onClick={() => setPage(totalPages - 1)} disabled={page >= totalPages - 1}
                className="px-2 py-1 text-xs rounded disabled:opacity-30"
                style={{ border: "1px solid var(--border)", color: "var(--text)" }}>Last</button>
            </div>
          )}

          <p className="text-xs mt-3" style={{ color: "var(--text-tertiary)" }}>
            &ldquo;In Bank&rdquo; shows the amount received after gateway fees, GST, and FX conversion — always in INR (₹).
            Hover over deductions to see the breakdown.
          </p>
          {stats.blankCount > 0 && (
            <p className="text-xs mt-2" style={{ color: "var(--text-tertiary)" }}>
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
