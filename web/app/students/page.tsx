"use client";

import { Suspense, useState, useEffect, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import { apiFetch } from "@/lib/api";
import { formatMoney, formatDate, displayLocation } from "@/lib/format";
import StudentProfile from "@/components/student-profile";

type SortKey = "name" | "owed" | "next_due" | "enrollment_count" | "status" | null;
type SortDir = "asc" | "desc";

interface StudentRow {
  id: number; name: string; city: string | null; country: string | null;
  owed: { currency: string; amount_paise: number }[];
  next_due: string | null; enrollment_count: number; status: string;
}

function fetcher<T>(path: string) { return apiFetch<T>(path); }

export default function StudentsPage() {
  return (
    <Suspense fallback={<div className="p-8"><div className="animate-pulse h-64 rounded" style={{ backgroundColor: "var(--surface)" }} /></div>}>
      <StudentsContent />
    </Suspense>
  );
}

function StudentsContent() {
  const searchParams = useSearchParams();
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);

  useEffect(() => {
    const q = searchParams.get("search");
    if (q) setSearch(q);
    const id = searchParams.get("id");
    if (id) setSelectedId(Number(id));
  }, [searchParams]);

  const params = new URLSearchParams({ limit: "200" });
  if (search) params.set("search", search);

  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      if (sortDir === "asc") setSortDir("desc");
      else { setSortKey(null); }
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  const { data } = useSWR<{ total: number; items: StudentRow[] }>(
    `/students?${params}`, fetcher
  );

  const students = useMemo(() => {
    const items = [...(data?.items ?? [])];
    if (!sortKey) return items;
    items.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "name": cmp = a.name.localeCompare(b.name); break;
        case "owed": {
          const aOwed = a.owed.reduce((s, o) => s + o.amount_paise, 0);
          const bOwed = b.owed.reduce((s, o) => s + o.amount_paise, 0);
          cmp = aOwed - bOwed;
          break;
        }
        case "next_due": cmp = (a.next_due ?? "9999").localeCompare(b.next_due ?? "9999"); break;
        case "enrollment_count": cmp = a.enrollment_count - b.enrollment_count; break;
        case "status": cmp = a.status.localeCompare(b.status); break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return items;
  }, [data, sortKey, sortDir]);

  function SortHeader({ label, field, align }: { label: string; field: SortKey; align?: string }) {
    const active = sortKey === field;
    return (
      <th className={`px-4 py-3 font-medium cursor-pointer select-none ${align === "right" ? "text-right" : ""}`}
        style={{ color: "var(--text-secondary)" }}
        onClick={() => toggleSort(field)}>
        {label}
        {active
          ? <span className="ml-1" style={{ color: "var(--text)" }}>{sortDir === "asc" ? "\u2191" : "\u2193"}</span>
          : <span className="ml-1" style={{ color: "var(--text-tertiary)" }}>{"\u2195"}</span>}
      </th>
    );
  }

  // Show profile view
  if (selectedId !== null) {
    return (
      <div className="p-8">
        <StudentProfile studentId={selectedId} onBack={() => setSelectedId(null)} />
      </div>
    );
  }

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-1" style={{ color: "var(--text)" }}>Students</h1>
      <p className="text-sm mb-6" style={{ color: "var(--text-secondary)" }}>{data?.total ?? "—"} students</p>

      <input
        type="text" placeholder="Search by name..." value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="mb-4 w-full max-w-md text-sm rounded-md px-3 py-2"
        style={{ backgroundColor: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)" }}
      />

      <div className="rounded-xl border overflow-x-auto" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs border-b" style={{ color: "var(--text-secondary)", borderColor: "var(--border-subtle)", backgroundColor: "var(--surface-hover)" }}>
              <SortHeader label="Name" field="name" />
              <th className="px-4 py-3 font-medium">Location</th>
              <SortHeader label="Owed" field="owed" align="right" />
              <SortHeader label="Next due" field="next_due" />
              <SortHeader label="Status" field="status" />
            </tr>
          </thead>
          <tbody style={{ borderColor: "var(--border-subtle)" }}>
            {students.map((s, idx) => (
              <tr key={s.id}
                className="cursor-pointer transition-colors"
                style={{ borderBottom: "1px solid var(--border-subtle)" }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "var(--surface-hover)"}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = ""}
                onClick={() => setSelectedId(s.id)}>
                <td className="px-4 py-2.5 font-medium" style={{ color: "var(--accent)" }}>{s.name}</td>
                <td className="px-4 py-2.5" style={{ color: "var(--text-secondary)" }}>
                  {displayLocation(s.city, s.country)}
                </td>
                <td className="px-4 py-2.5 text-right">
                  {s.owed.length > 0
                    ? s.owed.map((o) => formatMoney(o.amount_paise, o.currency)).join(", ")
                    : "—"}
                </td>
                <td className="px-4 py-2.5">{s.next_due ? formatDate(s.next_due) : "—"}</td>
                <td className="px-4 py-2.5">
                  <span className="px-2 py-0.5 rounded text-xs font-medium" style={{
                    backgroundColor: s.status === "paid_up" ? "rgba(0, 220, 130, 0.15)" : "rgba(255, 176, 32, 0.15)",
                    color: s.status === "paid_up" ? "var(--accent)" : "var(--warning)",
                  }}>
                    {s.status === "paid_up" ? "Paid up" : "Outstanding"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
