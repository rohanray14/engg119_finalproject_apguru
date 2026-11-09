"use client";

import { useState } from "react";
import useSWR from "swr";
import { apiFetch } from "@/lib/api";
import { formatMoney, formatDate } from "@/lib/format";

interface MoneyOutData {
  summary: { category: string; currency: string; count: number; total_paise: number }[];
  total: number;
  items: { id: number; date: string; payee: string; category: string; amount_paise: number; currency: string }[];
}

function fetcher<T>(path: string) { return apiFetch<T>(path); }

export default function MoneyOutPage() {
  const [category, setCategory] = useState("");
  const [currency, setCurrency] = useState("");

  const params = new URLSearchParams();
  if (category) params.set("category", category);
  if (currency) params.set("currency", currency);

  const { data, isLoading } = useSWR<MoneyOutData>(`/money-out?${params}`, fetcher);

  const categories = [...new Set(data?.summary.map((s) => s.category) ?? [])];

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-1">Money out</h1>
      <p className="text-sm text-gray-500 mb-6">All debits by category.</p>

      {/* Category summary cards */}
      {data && data.summary.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 mb-6">
          {data.summary.map((s, i) => (
            <div key={i} className="bg-white rounded-lg border p-4" style={{ borderColor: "var(--card-border)" }}>
              <div className="text-sm text-gray-500 capitalize">{s.category}</div>
              <div className="text-lg font-bold text-gray-900">{formatMoney(s.total_paise, s.currency)}</div>
              <div className="text-xs text-gray-400">{s.count} payments</div>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3 mb-4">
        <select value={category} onChange={(e) => setCategory(e.target.value)}
          className="text-sm border border-gray-300 rounded-md px-3 py-2">
          <option value="">All categories</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={currency} onChange={(e) => setCurrency(e.target.value)}
          className="text-sm border border-gray-300 rounded-md px-3 py-2">
          <option value="">All currencies</option>
          <option value="INR">INR</option>
          <option value="USD">USD</option>
        </select>
      </div>

      {isLoading ? (
        <div className="animate-pulse h-64 bg-gray-200 rounded" />
      ) : !data || data.items.length === 0 ? (
        <div className="bg-white rounded-lg border p-8 text-center" style={{ borderColor: "var(--card-border)" }}>
          <p className="text-gray-500">No outgoing payments.</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border overflow-x-auto" style={{ borderColor: "var(--card-border)" }}>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b bg-gray-50">
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Payee</th>
                <th className="px-4 py-3 font-medium">Category</th>
                <th className="px-4 py-3 font-medium text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.items.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5">{formatDate(r.date)}</td>
                  <td className="px-4 py-2.5 font-medium text-gray-900">{r.payee}</td>
                  <td className="px-4 py-2.5 capitalize">{r.category}</td>
                  <td className="px-4 py-2.5 text-right font-medium">{formatMoney(r.amount_paise, r.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
