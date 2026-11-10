"use client";

import { useState } from "react";
import useSWR from "swr";
import { apiFetch } from "@/lib/api";
import { formatMoney, formatDate } from "@/lib/format";

interface StudentRow {
  id: number; name: string; city: string | null; country: string | null;
  owed: { currency: string; amount_paise: number }[];
  next_due: string | null; enrollment_count: number; status: string;
}
interface StudentDetail {
  id: number; name: string; city: string | null; country: string | null;
  aliases: string[]; payer_aliases: string[];
  enrollments: {
    id: number; program: string; fee_model: string; total_fee_paise: number; currency: string;
    installments: { id: number; due_date: string | null; amount_due_paise: number; currency: string; status: string; remaining_paise: number }[];
  }[];
  payments: { match_id: number; match_status: string; date: string; payer_name: string | null; amount_paid_paise: number; currency: string; confirmation: string }[];
}

function fetcher<T>(path: string) { return apiFetch<T>(path); }

const countryMap: Record<string, string> = {
  IN: "India", India: "India",
  US: "USA", USA: "USA", "United States": "USA",
  UK: "UK", "United Kingdom": "UK",
  UAE: "UAE", "United Arab Emirates": "UAE", "U.A.E": "UAE", Dubai: "UAE",
  SG: "Singapore", Singapore: "Singapore",
};
function displayCountry(raw: string | null): string {
  if (!raw) return "—";
  return countryMap[raw] ?? raw;
}

const cityMap: Record<string, string> = {
  Bengaluru: "Bangalore", Bangalore: "Bangalore", Blore: "Bangalore",
  Bombay: "Mumbai", Mumbai: "Mumbai",
  Calcutta: "Kolkata", Kolkata: "Kolkata",
  Madras: "Chennai", Chennai: "Chennai",
  DXB: "Dubai", Dubai: "Dubai", dubai: "Dubai",
};
function displayCity(raw: string | null): string {
  if (!raw) return "—";
  return cityMap[raw] ?? raw;
}

export default function StudentsPage() {
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const params = new URLSearchParams({ limit: "200" });
  if (search) params.set("search", search);

  const { data } = useSWR<{ total: number; items: StudentRow[] }>(
    `/students?${params}`, fetcher
  );
  const { data: detail } = useSWR<StudentDetail>(
    selectedId ? `/students/${selectedId}` : null, fetcher
  );

  const students = data?.items ?? [];

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-1">Students</h1>
      <p className="text-sm text-gray-500 mb-6">{data?.total ?? "—"} students</p>

      <input
        type="text" placeholder="Search by name..." value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="mb-4 w-full max-w-md text-sm border border-gray-300 rounded-md px-3 py-2"
      />

      <div className="bg-white rounded-lg border overflow-x-auto mb-6" style={{ borderColor: "var(--card-border)" }}>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500 border-b bg-gray-50">
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Location</th>
              <th className="px-4 py-3 font-medium text-right">Owed</th>
              <th className="px-4 py-3 font-medium">Next due</th>
              <th className="px-4 py-3 font-medium">Enrollments</th>
              <th className="px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {students.map((s) => (
              <tr key={s.id}
                className={`cursor-pointer hover:bg-gray-50 ${selectedId === s.id ? "bg-blue-50" : ""}`}
                onClick={() => setSelectedId(s.id)}>
                <td className="px-4 py-2.5 font-medium text-gray-900">{s.name}</td>
                <td className="px-4 py-2.5 text-gray-600">
                  {[displayCity(s.city), displayCountry(s.country)].filter(v => v !== "—").join(", ") || "—"}
                </td>
                <td className="px-4 py-2.5 text-right">
                  {s.owed.length > 0
                    ? s.owed.map((o) => formatMoney(o.amount_paise, o.currency)).join(", ")
                    : "—"}
                </td>
                <td className="px-4 py-2.5">{s.next_due ? formatDate(s.next_due) : "—"}</td>
                <td className="px-4 py-2.5">{s.enrollment_count}</td>
                <td className="px-4 py-2.5">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                    s.status === "paid_up"
                      ? "bg-green-100 text-green-800"
                      : "bg-amber-100 text-amber-800"
                  }`}>
                    {s.status === "paid_up" ? "Paid up" : "Outstanding"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Detail panel */}
      {detail && (
        <div className="bg-white rounded-lg border p-6 space-y-4" style={{ borderColor: "var(--card-border)" }}>
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-xl font-bold text-gray-900">{detail.name}</h2>
              <p className="text-sm text-gray-500">
                {[displayCity(detail.city), displayCountry(detail.country)].filter(v => v && v !== "—").join(", ") || "No location"}
              </p>
              {detail.aliases.length > 0 && (
                <p className="text-xs text-gray-400 mt-1">Aliases: {detail.aliases.join(", ")}</p>
              )}
              {detail.payer_aliases.length > 0 && (
                <p className="text-xs text-gray-400">Known payers: {detail.payer_aliases.join(", ")}</p>
              )}
            </div>
          </div>

          {detail.enrollments.map((e) => (
            <div key={e.id} className="border rounded-lg p-4" style={{ borderColor: "var(--card-border)" }}>
              <div className="font-medium text-gray-900 mb-2">
                {e.program} ({e.fee_model}) — Total: {formatMoney(e.total_fee_paise, e.currency)}
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-500 border-b">
                    <th className="pb-2 font-medium">Due</th>
                    <th className="pb-2 font-medium text-right">Amount</th>
                    <th className="pb-2 font-medium text-right">Remaining</th>
                    <th className="pb-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {e.installments.map((i) => (
                    <tr key={i.id}>
                      <td className="py-2">{i.due_date ? formatDate(i.due_date) : "—"}</td>
                      <td className="py-2 text-right">{formatMoney(i.amount_due_paise, i.currency)}</td>
                      <td className="py-2 text-right">{formatMoney(i.remaining_paise, i.currency)}</td>
                      <td className="py-2">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                          i.status === "paid" ? "bg-green-100 text-green-800" :
                          i.status === "overdue" ? "bg-red-100 text-red-800" :
                          "bg-gray-100 text-gray-700"
                        }`}>{i.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}

          {detail.payments.length > 0 && (
            <div>
              <h3 className="font-medium text-gray-900 mb-2">Linked payments</h3>
              <div className="space-y-1">
                {detail.payments.map((p) => (
                  <div key={p.match_id} className="flex items-center justify-between text-sm py-1">
                    <span>{formatDate(p.date)} · {p.payer_name || "(blank)"}</span>
                    <span className="font-medium">{formatMoney(p.amount_paid_paise, p.currency)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
