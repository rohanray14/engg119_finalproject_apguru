"use client";

import { useState } from "react";
import useSWR from "swr";
import { apiFetch } from "@/lib/api";
import { formatDate } from "@/lib/format";

interface AuditEntry {
  id: number; timestamp: string; actor: string; action: string;
  entity: string; old_value: string | null; new_value: string | null;
}
interface AuditData {
  items: AuditEntry[];
  next_before_id: number | null;
}

function fetcher<T>(path: string) { return apiFetch<T>(path); }

export default function AuditPage() {
  const [beforeId, setBeforeId] = useState<number | null>(null);
  const [actionFilter, setActionFilter] = useState("");
  const [search, setSearch] = useState("");

  const params = beforeId ? `?before_id=${beforeId}` : "";
  const { data, isLoading, error } = useSWR<AuditData>(`/audit${params}`, fetcher);

  // Derive unique actions for the filter dropdown
  const actions = [...new Set((data?.items ?? []).map((e) => e.action))].sort();

  // Client-side filtering
  const filtered = (data?.items ?? []).filter((e) => {
    if (actionFilter && e.action !== actionFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return e.actor.toLowerCase().includes(q)
        || e.entity.toLowerCase().includes(q)
        || (e.new_value ?? "").toLowerCase().includes(q);
    }
    return true;
  });

  if (error?.message?.includes("403")) {
    return (
      <div className="p-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-4">Audit log</h1>
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-6">
          <p className="text-amber-800">Only the finance lead can view the audit log.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-1">Audit log</h1>
      <p className="text-sm text-gray-500 mb-6">Every decision and change, with who did it and when.</p>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4">
        <select value={actionFilter} onChange={(e) => setActionFilter(e.target.value)}
          className="text-sm border border-gray-300 rounded-md px-3 py-2">
          <option value="">All actions</option>
          {actions.map((a) => <option key={a} value={a}>{a.replace(/_/g, " ")}</option>)}
        </select>
        <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search actor, entity, or details..."
          className="text-sm border border-gray-300 rounded-md px-3 py-2 w-72" />
        {(actionFilter || search) && (
          <button onClick={() => { setActionFilter(""); setSearch(""); }}
            className="text-xs text-gray-500 hover:text-gray-700 underline">Clear</button>
        )}
        <span className="text-xs text-gray-400 ml-auto">{filtered.length} entries</span>
      </div>

      {isLoading ? (
        <div className="animate-pulse h-64 bg-gray-200 rounded" />
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-lg border p-8 text-center" style={{ borderColor: "var(--card-border)" }}>
          <p className="text-gray-500">{data && data.items.length > 0 ? "No entries match the filters." : "No audit entries yet."}</p>
        </div>
      ) : (
        <>
          <div className="bg-white rounded-lg border overflow-x-auto" style={{ borderColor: "var(--card-border)" }}>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b bg-gray-50">
                  <th className="px-4 py-3 font-medium">ID</th>
                  <th className="px-4 py-3 font-medium">When</th>
                  <th className="px-4 py-3 font-medium">Who</th>
                  <th className="px-4 py-3 font-medium">Action</th>
                  <th className="px-4 py-3 font-medium">Entity</th>
                  <th className="px-4 py-3 font-medium">Changed from</th>
                  <th className="px-4 py-3 font-medium">Changed to</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map((e) => (
                  <tr key={e.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 text-gray-400">{e.id}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap">{formatDate(e.timestamp)}</td>
                    <td className="px-4 py-2.5 text-gray-700">{e.actor}</td>
                    <td className="px-4 py-2.5 font-medium">{e.action.replace(/_/g, " ")}</td>
                    <td className="px-4 py-2.5">{e.entity}</td>
                    <td className="px-4 py-2.5 text-xs text-gray-500 max-w-[200px] truncate" title={e.old_value || ""}>
                      {e.old_value || "—"}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-gray-500 max-w-[200px] truncate" title={e.new_value || ""}>
                      {e.new_value || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data?.next_before_id && (
            <button
              onClick={() => setBeforeId(data!.next_before_id)}
              className="mt-4 px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50"
            >
              Load older entries
            </button>
          )}
        </>
      )}
    </div>
  );
}
