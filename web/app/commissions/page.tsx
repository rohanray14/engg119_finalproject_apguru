"use client";

import { Suspense, useState, useEffect, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import { apiFetch } from "@/lib/api";
import { formatMoney, formatDate } from "@/lib/format";
import { useAppUser } from "@/app/providers";
import CounselorProfile from "@/components/counselor-profile";

interface CounselorAmount { currency: string; earned_paise: number; tds_paise: number; net_paise: number; lines: number }
interface Counselor {
  id: number; name: string; terms_text: string;
  rule: { rate: number; rate_bps: number; scope: string; city: string | null; split: number | null; source: string };
  status: string;
  amounts: CounselorAmount[];
}
interface CommissionsData {
  totals: { currency: string; earned_paise: number; tds_paise: number; net_paise: number; counselors: number; payable_paise: number }[];
  needs_rate: number;
  counselors: Counselor[];
  approved_payouts: { id: number; approved_at: string; actor: string; currency: string; total_net_paise: number }[];
}

function fetcher<T>(path: string) { return apiFetch<T>(path); }

export default function CommissionsPage() {
  return (
    <Suspense fallback={<div className="p-8"><div className="animate-pulse h-64 rounded" style={{ backgroundColor: "var(--surface)" }} /></div>}>
      <CommissionsContent />
    </Suspense>
  );
}

type SortKey = "name" | "rate" | "earned" | "net" | "lines" | "status";
type SortDir = "asc" | "desc";

function CommissionsContent() {
  const { user } = useAppUser();
  const canApprove = user?.can_approve ?? false;
  const searchParams = useSearchParams();
  const { data, mutate, isLoading } = useSWR<CommissionsData>("/commissions", fetcher);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rateEdit, setRateEdit] = useState<number | null>(null);
  const [rateValue, setRateValue] = useState(1000);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [payoutConfirm, setPayoutConfirm] = useState<{ currency: string; payable: number } | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newTerms, setNewTerms] = useState("");
  const [newRate, setNewRate] = useState<number | "">("");
  const [newScope, setNewScope] = useState<"own_referrals" | "city">("own_referrals");
  const [newCity, setNewCity] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("earned");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  useEffect(() => {
    const id = searchParams.get("id");
    if (id) setSelectedId(Number(id));
  }, [searchParams]);

  // Sort helper
  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir(key === "name" ? "asc" : "desc"); }
  }
  function sortArrow(key: SortKey) {
    if (sortKey !== key) return "↕";
    return sortDir === "asc" ? "↑" : "↓";
  }

  // Sorted counselors — show ALL, not just those with earnings
  const sortedCounselors = useMemo(() => {
    if (!data) return [];
    return [...data.counselors].sort((a, b) => {
      const aAmt = a.amounts.find((x) => x.currency === "INR");
      const bAmt = b.amounts.find((x) => x.currency === "INR");
      let cmp = 0;
      switch (sortKey) {
        case "name": cmp = a.name.localeCompare(b.name); break;
        case "rate": cmp = a.rule.rate - b.rule.rate; break;
        case "earned": cmp = (aAmt?.earned_paise ?? 0) - (bAmt?.earned_paise ?? 0); break;
        case "net": cmp = (aAmt?.net_paise ?? 0) - (bAmt?.net_paise ?? 0); break;
        case "lines": cmp = (aAmt?.lines ?? 0) - (bAmt?.lines ?? 0); break;
        case "status": {
          const order: Record<string, number> = { needs_rate: 0, ready: 1, no_fees: 2 };
          cmp = (order[a.status] ?? 3) - (order[b.status] ?? 3);
          break;
        }
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [data, sortKey, sortDir]);

  if (isLoading || !data) {
    return <div className="p-8"><div className="animate-pulse h-64 rounded" style={{ backgroundColor: "var(--surface)" }} /></div>;
  }

  // Show counselor profile view
  if (selectedId !== null) {
    return (
      <div className="p-8">
        <CounselorProfile counselorId={selectedId} onBack={() => setSelectedId(null)} />
      </div>
    );
  }

  const inr = data.totals.find((t) => t.currency === "INR");
  const activeCount = data.counselors.filter((c) => {
    const amt = c.amounts.find((a) => a.currency === "INR");
    return amt && amt.earned_paise > 0;
  }).length;

  async function handlePayout(currency: string, payable: number) {
    setActing(true);
    setError(null);
    try {
      await apiFetch("/commissions/payout/approve", {
        method: "POST",
        body: { currency, expected_payable_paise: payable },
      });
      setPayoutConfirm(null);
      mutate();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setActing(false);
    }
  }

  async function handleSetRate(counselorId: number) {
    setActing(true);
    setError(null);
    try {
      await apiFetch(`/commissions/counselors/${counselorId}/rule`, {
        method: "POST",
        body: { rate_bps: rateValue },
      });
      setRateEdit(null);
      mutate();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setActing(false);
    }
  }

  async function handleAddCounselor() {
    if (!newName.trim()) return;
    setActing(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        name: newName.trim(),
        terms_text: newTerms.trim(),
      };
      if (newRate && Number(newRate) > 0) {
        body.rate_bps = Math.round(Number(newRate) * 100);
        body.scope = newScope;
        if (newScope === "city" && newCity.trim()) body.city = newCity.trim();
      }
      await apiFetch("/commissions/counselors", { method: "POST", body });
      setShowAddForm(false);
      setNewName("");
      setNewTerms("");
      setNewRate("");
      setNewScope("own_referrals");
      setNewCity("");
      mutate();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setActing(false);
    }
  }

  function ruleRate(c: Counselor): string {
    if (c.rule.rate <= 0) return "—";
    return `${(c.rule.rate * 100).toFixed(0)}%`;
  }

  function ruleScope(c: Counselor): string {
    const r = c.rule;
    if (r.rate <= 0) return r.source === "none" ? "No terms" : "Rate not stated";
    if (r.scope === "city" && r.city) return `All ${r.city} students`;
    if (r.scope === "own_referrals") return "Own referrals only";
    return "All students";
  }

  function ruleSplit(c: Counselor): string | null {
    if (!c.rule.split) return null;
    return `${(c.rule.split * 100).toFixed(0)}/${((1 - c.rule.split) * 100).toFixed(0)} co-referral split`;
  }

  return (
    <div className="p-8">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold" style={{ color: "var(--text)" }}>Commissions</h1>
          <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>
            Calculated only on fees that have reached the bank. Unmatched payments are held back.
          </p>
        </div>
        {canApprove && inr && inr.payable_paise > 0 && !payoutConfirm && (
          <button
            onClick={() => setPayoutConfirm({ currency: "INR", payable: inr.payable_paise })}
            className="px-5 py-2.5 text-sm font-medium text-white rounded-md"
            style={{ backgroundColor: "var(--accent)" }}
          >
            Approve payout · {formatMoney(inr.payable_paise, "INR")}
          </button>
        )}
      </div>

      {/* Payout confirmation banner */}
      {payoutConfirm && (
        <div className="rounded-lg border p-4 mb-4 flex items-center justify-between"
          style={{ backgroundColor: "rgba(255,176,32,0.08)", borderColor: "rgba(255,176,32,0.3)" }}>
          <div>
            <div className="text-sm font-medium" style={{ color: "var(--text)" }}>
              Approve payout of {formatMoney(payoutConfirm.payable, payoutConfirm.currency)} to all counselors?
            </div>
            <div className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>
              This will mark {activeCount} counselor commission{activeCount !== 1 ? "s" : ""} as paid. This action cannot be undone.
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0 ml-4">
            <button onClick={() => setPayoutConfirm(null)}
              className="px-3 py-1.5 text-sm rounded-md"
              style={{ color: "var(--text-secondary)", border: "1px solid var(--border)" }}>
              Cancel
            </button>
            <button onClick={() => handlePayout(payoutConfirm.currency, payoutConfirm.payable)}
              disabled={acting}
              className="px-4 py-1.5 text-sm font-medium text-white rounded-md disabled:opacity-50"
              style={{ backgroundColor: "var(--accent)" }}>
              {acting ? "Approving..." : "Confirm payout"}
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-lg p-3 mb-4 text-sm" style={{ backgroundColor: "rgba(255, 77, 77, 0.1)", border: "1px solid rgba(255, 77, 77, 0.3)", color: "var(--danger)" }}>{error}</div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <div className="rounded-lg border p-5" style={{ backgroundColor: "var(--surface)", borderColor: "var(--card-border)" }}>
          <div className="text-sm mb-1" style={{ color: "var(--text-secondary)" }}>Commission earned</div>
          <div className="text-2xl font-bold" style={{ color: "var(--text)" }}>{inr ? formatMoney(inr.earned_paise, "INR") : "—"}</div>
        </div>
        <div className="rounded-lg border p-5" style={{ backgroundColor: "var(--surface)", borderColor: "var(--card-border)" }}>
          <div className="text-sm mb-1" style={{ color: "var(--text-secondary)" }}>Net to pay</div>
          <div className="text-2xl font-bold" style={{ color: "var(--accent)" }}>{inr ? formatMoney(inr.net_paise, "INR") : "—"}</div>
          <div className="text-xs mt-1" style={{ color: "var(--text-tertiary)" }}>after 2% TDS ({inr ? formatMoney(inr.tds_paise, "INR") : "—"})</div>
        </div>
        <div className="rounded-lg border p-5" style={{ backgroundColor: "var(--surface)", borderColor: "var(--card-border)" }}>
          <div className="text-sm mb-1" style={{ color: "var(--text-secondary)" }}>Counselors</div>
          <div className="text-2xl font-bold" style={{ color: "var(--text)" }}>{activeCount}<span className="text-sm font-normal" style={{ color: "var(--text-tertiary)" }}> / {data.counselors.length}</span></div>
          <div className="text-xs mt-1" style={{ color: "var(--text-tertiary)" }}>with earnings</div>
        </div>
        {data.needs_rate > 0 ? (
          <button onClick={() => { setSortKey("status"); setSortDir("asc"); }}
            className="text-left rounded-lg border p-5"
            style={{ backgroundColor: "rgba(255,176,32,0.08)", borderColor: "rgba(255,176,32,0.3)" }}>
            <div className="text-sm mb-1" style={{ color: "var(--warning)" }}>Needs rate</div>
            <div className="text-2xl font-bold" style={{ color: "var(--warning)" }}>{data.needs_rate}</div>
            <div className="text-xs mt-1" style={{ color: "var(--warning)" }}>click to see</div>
          </button>
        ) : (
          <div className="rounded-lg border p-5" style={{ backgroundColor: "var(--surface)", borderColor: "var(--card-border)" }}>
            <div className="text-sm mb-1" style={{ color: "var(--text-secondary)" }}>Needs rate</div>
            <div className="text-2xl font-bold" style={{ color: "var(--accent)" }}>0</div>
            <div className="text-xs mt-1" style={{ color: "var(--text-tertiary)" }}>all rates set</div>
          </div>
        )}
      </div>

      {/* Counselors table */}
      <div className="rounded-xl border p-6 mb-6" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold" style={{ color: "var(--text)" }}>Counselors</h3>
          <div className="flex items-center gap-3">
            <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>{data.counselors.length} total</span>
            {canApprove && (
              <button onClick={() => setShowAddForm(!showAddForm)}
                className="text-xs px-3 py-1.5 rounded-md font-medium"
                style={{ backgroundColor: showAddForm ? "var(--surface-hover)" : "var(--accent)", color: showAddForm ? "var(--text-secondary)" : "var(--bg)" }}>
                {showAddForm ? "Cancel" : "+ Add counselor"}
              </button>
            )}
          </div>
        </div>

        {/* Add counselor form */}
        {showAddForm && (
          <div className="rounded-lg p-4 mb-4" style={{ backgroundColor: "var(--surface-hover)", border: "1px solid var(--border)" }}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
              <div>
                <label className="text-xs font-medium mb-1 block" style={{ color: "var(--text-secondary)" }}>Name *</label>
                <input
                  type="text" value={newName} onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. Priya Sharma"
                  className="w-full text-sm rounded-md px-2.5 py-1.5"
                  style={{ backgroundColor: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)" }}
                />
              </div>
              <div>
                <label className="text-xs font-medium mb-1 block" style={{ color: "var(--text-secondary)" }}>Terms (free text)</label>
                <input
                  type="text" value={newTerms} onChange={(e) => setNewTerms(e.target.value)}
                  placeholder="e.g. 10% commission on own referrals"
                  className="w-full text-sm rounded-md px-2.5 py-1.5"
                  style={{ backgroundColor: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)" }}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
              <div>
                <label className="text-xs font-medium mb-1 block" style={{ color: "var(--text-secondary)" }}>Rate (%)</label>
                <input
                  type="number" min={1} max={50} step={1}
                  value={newRate} onChange={(e) => setNewRate(e.target.value === "" ? "" : Number(e.target.value))}
                  placeholder="10"
                  className="w-full text-sm rounded-md px-2.5 py-1.5"
                  style={{ backgroundColor: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)" }}
                />
              </div>
              <div>
                <label className="text-xs font-medium mb-1 block" style={{ color: "var(--text-secondary)" }}>Applies to</label>
                <select value={newScope} onChange={(e) => setNewScope(e.target.value as "own_referrals" | "city")}
                  className="w-full text-sm rounded-md px-2.5 py-1.5"
                  style={{ backgroundColor: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)" }}>
                  <option value="own_referrals">Own referrals</option>
                  <option value="city">All students in a city</option>
                </select>
              </div>
              {newScope === "city" && (
                <div>
                  <label className="text-xs font-medium mb-1 block" style={{ color: "var(--text-secondary)" }}>City</label>
                  <input
                    type="text" value={newCity} onChange={(e) => setNewCity(e.target.value)}
                    placeholder="e.g. Mumbai"
                    className="w-full text-sm rounded-md px-2.5 py-1.5"
                    style={{ backgroundColor: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)" }}
                  />
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button onClick={handleAddCounselor} disabled={acting || !newName.trim()}
                className="px-4 py-1.5 text-sm font-medium text-white rounded-md disabled:opacity-50"
                style={{ backgroundColor: "var(--accent)" }}>
                {acting ? "Adding..." : "Add counselor"}
              </button>
              <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>
                {!newRate ? "Rate can be set later" : ""}
              </span>
            </div>
          </div>
        )}
        {sortedCounselors.length === 0 ? (
          <div className="py-8 text-center text-sm" style={{ color: "var(--text-secondary)" }}>No counselors found.</div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[800px]">
            <thead>
              <tr className="text-left text-xs border-b" style={{ color: "var(--text-secondary)", borderColor: "var(--border-subtle)" }}>
                <th className="pb-2 pr-4 font-medium cursor-pointer select-none" onClick={() => toggleSort("name")}>
                  Counselor {sortArrow("name")}
                </th>
                <th className="pb-2 pr-4 font-medium cursor-pointer select-none w-[60px]" onClick={() => toggleSort("rate")}>
                  Rate {sortArrow("rate")}
                </th>
                <th className="pb-2 pr-4 font-medium">Applies to</th>
                <th className="pb-2 px-4 font-medium text-right cursor-pointer select-none" onClick={() => toggleSort("earned")}>
                  Earned {sortArrow("earned")}
                </th>
                <th className="pb-2 px-4 font-medium text-right cursor-pointer select-none" onClick={() => toggleSort("net")}>
                  Net {sortArrow("net")}
                </th>
                <th className="pb-2 px-4 font-medium text-center cursor-pointer select-none" onClick={() => toggleSort("lines")}>
                  Payments {sortArrow("lines")}
                </th>
                <th className="pb-2 pl-4 font-medium cursor-pointer select-none" onClick={() => toggleSort("status")}>
                  {sortArrow("status")}
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedCounselors.map((c) => {
                const amt = c.amounts.find((a) => a.currency === "INR");
                const isEditing = rateEdit === c.id;
                const split = ruleSplit(c);
                return (
                  <tr key={c.id} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                    <td className="py-3 pr-4 font-medium cursor-pointer hover:underline" style={{ color: "var(--accent)" }}
                      onClick={() => setSelectedId(c.id)}>
                      {c.name}
                    </td>
                    <td className="py-3 pr-4" style={{ color: "var(--text)" }}>
                      {isEditing ? (
                        <div className="flex items-center gap-2">
                          <input
                            type="number" min={1} max={50} step={1}
                            value={rateValue / 100}
                            onChange={(e) => setRateValue(Math.round(Number(e.target.value) * 100))}
                            className="w-16 text-sm rounded px-1.5 py-0.5"
                            style={{ backgroundColor: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)" }}
                          />
                          <span className="text-xs" style={{ color: "var(--text-secondary)" }}>%</span>
                          <button onClick={() => handleSetRate(c.id)} disabled={acting}
                            className="px-2 py-0.5 text-xs font-medium text-white rounded disabled:opacity-50"
                            style={{ backgroundColor: "var(--accent)" }}>Save</button>
                          <button onClick={() => setRateEdit(null)}
                            className="text-xs" style={{ color: "var(--text-tertiary)" }}>Cancel</button>
                        </div>
                      ) : (
                        <span className="font-medium">{ruleRate(c)}</span>
                      )}
                    </td>
                    <td className="py-3 pr-4" style={{ color: "var(--text-secondary)" }}>
                      <div className="text-sm">{ruleScope(c)}</div>
                      {split && <div className="text-xs mt-0.5" style={{ color: "var(--text-tertiary)" }}>{split}</div>}
                    </td>
                    <td className="py-3 px-4 text-right">{amt && amt.earned_paise > 0 ? formatMoney(amt.earned_paise, "INR") : "—"}</td>
                    <td className="py-3 px-4 text-right font-medium">{amt && amt.net_paise > 0 ? formatMoney(amt.net_paise, "INR") : "—"}</td>
                    <td className="py-3 px-4 text-center" style={{ color: "var(--text-secondary)" }}>{amt?.lines ?? 0}</td>
                    <td className="py-3 pl-4">
                      {c.status === "ready" && (
                        <span className="px-2 py-0.5 rounded text-xs font-medium" style={{ backgroundColor: "rgba(0, 220, 130, 0.15)", color: "var(--accent)" }}>Earning</span>
                      )}
                      {c.status === "needs_rate" && canApprove && (
                        <button
                          onClick={() => { setRateEdit(c.id); setRateValue(c.rule.rate > 0 ? Math.round(c.rule.rate * 10000) : 1000); }}
                          className="text-xs px-2 py-1 rounded"
                          style={{ border: "1px solid rgba(255, 176, 32, 0.4)", color: "var(--warning)" }}
                        >
                          Set rate
                        </button>
                      )}
                      {c.status === "needs_rate" && !canApprove && (
                        <span className="text-xs px-2 py-0.5 rounded" style={{ backgroundColor: "rgba(255,176,32,0.1)", color: "var(--warning)" }}>No rate</span>
                      )}
                      {c.status === "no_fees" && (
                        <span className="text-xs px-2 py-0.5 rounded" style={{ backgroundColor: "var(--surface-hover)", color: "var(--text-tertiary)" }}>No fees yet</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        )}

        <p className="mt-4 text-xs" style={{ color: "var(--text-tertiary)" }}>
          The agent only turns written terms into a rule. The amounts, the 2% TDS and
          refund deductions are calculated by code, and each rule is saved once you confirm it.
        </p>
      </div>

      {/* Payout history */}
      {data.approved_payouts.length > 0 && (
        <div className="rounded-xl border p-6" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
          <h3 className="font-bold mb-4" style={{ color: "var(--text)" }}>Payout history</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs border-b" style={{ color: "var(--text-secondary)", borderColor: "var(--border-subtle)" }}>
                <th className="pb-2 font-medium">Date</th>
                <th className="pb-2 font-medium">Approved by</th>
                <th className="pb-2 font-medium text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {data.approved_payouts.map((p) => (
                <tr key={p.id} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                  <td className="py-2.5" style={{ color: "var(--text)" }}>{formatDate(p.approved_at)}</td>
                  <td className="py-2.5" style={{ color: "var(--text-secondary)" }}>{p.actor}</td>
                  <td className="py-2.5 text-right font-medium" style={{ color: "var(--text)" }}>{formatMoney(p.total_net_paise, p.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
