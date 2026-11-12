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
        <h1 className="text-3xl font-bold mb-4" style={{ color: "var(--text)" }}>Audit log</h1>
        <div className="rounded-lg p-6" style={{ backgroundColor: "var(--surface)", border: "1px solid var(--border)", color: "var(--warning)" }}>
          <p>Only the finance lead can view the audit log.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-1" style={{ color: "var(--text)" }}>Audit log</h1>
      <p className="text-sm mb-6" style={{ color: "var(--text-secondary)" }}>Every decision and change, with who did it and when.</p>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4">
        <select value={actionFilter} onChange={(e) => setActionFilter(e.target.value)}
          className="text-sm rounded-md px-3 py-2"
          style={{ backgroundColor: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)" }}>
          <option value="">All actions</option>
          {actions.map((a) => <option key={a} value={a}>{a.replace(/_/g, " ")}</option>)}
        </select>
        <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search actor, entity, or details..."
          className="text-sm rounded-md px-3 py-2 w-72"
          style={{ backgroundColor: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)" }} />
        {(actionFilter || search) && (
          <button onClick={() => { setActionFilter(""); setSearch(""); }}
            className="text-xs underline" style={{ color: "var(--text-secondary)" }}>Clear</button>
        )}
        <span className="text-xs ml-auto" style={{ color: "var(--text-tertiary)" }}>{filtered.length} entries</span>
      </div>

      {isLoading ? (
        <div className="animate-pulse h-64 rounded" style={{ backgroundColor: "var(--surface)" }} />
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border p-8 text-center" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
          <p style={{ color: "var(--text-secondary)" }}>{data && data.items.length > 0 ? "No entries match the filters." : "No audit entries yet."}</p>
        </div>
      ) : (
        <>
          <div className="rounded-xl border overflow-x-auto" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs border-b" style={{ color: "var(--text-secondary)", borderColor: "var(--border-subtle)", backgroundColor: "var(--surface-hover)" }}>
                  <th className="px-4 py-3 font-medium">When</th>
                  <th className="px-4 py-3 font-medium">Who</th>
                  <th className="px-4 py-3 font-medium">Action</th>
                  <th className="px-4 py-3 font-medium">Entity</th>
                  <th className="px-4 py-3 font-medium">Changed from</th>
                  <th className="px-4 py-3 font-medium">Changed to</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((e) => (
                  <tr key={e.id}
                    style={{ borderBottom: "1px solid var(--border-subtle)" }}
                    onMouseEnter={(ev) => ev.currentTarget.style.backgroundColor = "var(--surface-hover)"}
                    onMouseLeave={(ev) => ev.currentTarget.style.backgroundColor = ""}>
                    <td className="px-4 py-2.5 whitespace-nowrap text-xs">
                      <div>{formatDate(e.timestamp)}</div>
                      <div style={{ color: "var(--text-tertiary)" }}>{new Date(e.timestamp).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</div>
                    </td>
                    <td className="px-4 py-2.5" style={{ color: "var(--text)" }}>{e.actor}</td>
                    <td className="px-4 py-2.5 font-medium">{e.action.replace(/_/g, " ")}</td>
                    <td className="px-4 py-2.5">{e.entity}</td>
                    <td className="px-4 py-2.5 text-xs max-w-[200px] truncate" style={{ color: "var(--text-secondary)" }} title={e.old_value || ""}>
                      {e.old_value || "—"}
                    </td>
                    <td className="px-4 py-2.5 text-xs max-w-[200px] truncate" style={{ color: "var(--text-secondary)" }} title={e.new_value || ""}>
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
              className="mt-4 px-4 py-2 text-sm rounded-md"
              style={{ border: "1px solid var(--border)", color: "var(--text)" }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "var(--surface-hover)"}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = ""}
            >
              Load older entries
            </button>
          )}
        </>
      )}
    </div>
  );
}
