"use client";

import { Suspense, useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import { apiFetch } from "@/lib/api";
import { formatMoney } from "@/lib/format";
import { useAppUser } from "@/app/providers";
import StatCard from "@/components/stat-card";
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

  useEffect(() => {
    const id = searchParams.get("id");
    if (id) setSelectedId(Number(id));
  }, [searchParams]);

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

  async function handlePayout(currency: string, payable: number) {
    setActing(true);
    setError(null);
    try {
      await apiFetch("/commissions/payout/approve", {
        method: "POST",
        body: { currency, expected_payable_paise: payable },
      });
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

  function ruleText(c: Counselor): string {
    const r = c.rule;
    if (r.rate <= 0) return r.source === "none" ? "No terms" : "Rate not stated";
    let text = `${(r.rate * 100).toFixed(0)}% x fees`;
    if (r.scope === "city" && r.city) text += ` from students in ${r.city}`;
    else if (r.scope === "own_referrals") text += " from students they referred";
    if (r.split) text += `, split ${(r.split * 100).toFixed(0)}%/${((1 - r.split) * 100).toFixed(0)}%`;
    return text;
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
        {canApprove && inr && inr.payable_paise > 0 && (
          <button
            onClick={() => handlePayout("INR", inr.payable_paise)}
            disabled={acting}
            className="px-5 py-2.5 text-sm font-medium text-white rounded-md disabled:opacity-50"
            style={{ backgroundColor: "var(--accent)" }}
          >
            {acting ? "Approving..." : `Approve payout · ${formatMoney(inr.payable_paise, "INR")}`}
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-lg p-3 mb-4 text-sm" style={{ backgroundColor: "rgba(255, 77, 77, 0.1)", border: "1px solid rgba(255, 77, 77, 0.3)", color: "var(--danger)" }}>{error}</div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Commission earned" value={inr ? formatMoney(inr.earned_paise, "INR") : "—"} />
        <StatCard label="TDS withheld (2%)" value={inr ? formatMoney(inr.tds_paise, "INR") : "—"} />
        <StatCard label="Net to pay" value={inr ? formatMoney(inr.net_paise, "INR") : "—"} />
        <StatCard
          label="Needs rate set"
          value={String(data.needs_rate)}
          sub="counselors without a parsed rate"
        />
      </div>

      {/* Counselors table */}
      <div className="rounded-xl border p-6 mb-6" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
        <h3 className="font-bold mb-4" style={{ color: "var(--text)" }}>Counselors</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs border-b" style={{ color: "var(--text-secondary)", borderColor: "var(--border-subtle)" }}>
              <th className="pb-2 font-medium">Counselor</th>
              <th className="pb-2 font-medium">Rate</th>
              <th className="pb-2 font-medium text-right">Commission</th>
              <th className="pb-2 font-medium text-right">Net after TDS</th>
              <th className="pb-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {data.counselors.filter((c) => {
              const amt = c.amounts.find((a) => a.currency === "INR");
              return (amt && amt.earned_paise > 0) || c.status === "needs_rate";
            }).map((c) => {
              const amt = c.amounts.find((a) => a.currency === "INR");
              return (
                <tr key={c.id} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                  <td className="py-3 font-medium cursor-pointer hover:underline" style={{ color: "var(--accent)" }}
                    onClick={() => setSelectedId(c.id)}>{c.name}</td>
                  <td className="py-3 text-sm" title={c.terms_text || undefined} style={{ color: "var(--text)" }}>
                    {ruleText(c)}
                  </td>
                  <td className="py-3 text-right">{amt && amt.earned_paise > 0 ? formatMoney(amt.earned_paise, "INR") : "—"}</td>
                  <td className="py-3 text-right font-medium">{amt && amt.net_paise > 0 ? formatMoney(amt.net_paise, "INR") : "—"}</td>
                  <td className="py-3">
                    {c.status === "ready" && (
                      <span className="px-2 py-0.5 rounded text-xs font-medium" style={{ backgroundColor: "rgba(0, 220, 130, 0.15)", color: "var(--accent)" }}>Ready</span>
                    )}
                    {c.status === "needs_rate" && canApprove && (
                      <button
                        onClick={() => { setRateEdit(c.id); setRateValue(1000); }}
                        className="text-xs px-2 py-1 rounded"
                        style={{ border: "1px solid rgba(255, 176, 32, 0.4)", color: "var(--warning)" }}
                      >
                        Set the rate
                      </button>
                    )}
                    {c.status === "needs_rate" && !canApprove && (
                      <span className="text-xs" style={{ color: "var(--warning)" }}>Needs rate</span>
                    )}
                    {c.status === "no_fees" && <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Rate edit panel */}
        {rateEdit && (
          <div className="mt-4 rounded-lg p-4" style={{ backgroundColor: "var(--surface-hover)", border: "1px solid var(--border)" }}>
            <div className="text-sm font-medium mb-2" style={{ color: "var(--text)" }}>
              Set commission rate for {data.counselors.find((c) => c.id === rateEdit)?.name}
            </div>
            <div className="flex items-center gap-3">
              <label className="text-sm" style={{ color: "var(--text-secondary)" }}>Rate (%)</label>
              <input
                type="number" min={1} max={50} step={1}
                value={rateValue / 100}
                onChange={(e) => setRateValue(Math.round(Number(e.target.value) * 100))}
                className="w-24 text-sm rounded-md px-2 py-1"
                style={{ backgroundColor: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)" }}
              />
              <button onClick={() => handleSetRate(rateEdit)} disabled={acting}
                className="px-3 py-1 text-sm font-medium text-white rounded-md disabled:opacity-50"
                style={{ backgroundColor: "var(--accent)" }}>
                Save
              </button>
              <button onClick={() => setRateEdit(null)}
                className="px-3 py-1 text-sm rounded-md"
                style={{ color: "var(--text-secondary)", border: "1px solid var(--border)" }}>
                Cancel
              </button>
            </div>
          </div>
        )}

        <p className="mt-4 text-xs" style={{ color: "var(--text-tertiary)" }}>
          The agent only turns written terms into a rule. The amounts, the 2% TDS and
          refund deductions are calculated by code, and each rule is saved once you confirm it.
        </p>
      </div>
    </div>
  );
}
