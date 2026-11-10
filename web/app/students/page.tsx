"use client";

import { Suspense, useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import { apiFetch } from "@/lib/api";
import { formatMoney, formatDate, displayLocation } from "@/lib/format";
import StudentProfile from "@/components/student-profile";

interface StudentRow {
  id: number; name: string; city: string | null; country: string | null;
  owed: { currency: string; amount_paise: number }[];
  next_due: string | null; enrollment_count: number; status: string;
}

function fetcher<T>(path: string) { return apiFetch<T>(path); }

export default function StudentsPage() {
  return (
    <Suspense fallback={<div className="p-8"><div className="animate-pulse h-64 bg-gray-200 rounded" /></div>}>
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

  const { data } = useSWR<{ total: number; items: StudentRow[] }>(
    `/students?${params}`, fetcher
  );

  const students = data?.items ?? [];

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
      <h1 className="text-3xl font-bold text-gray-900 mb-1">Students</h1>
      <p className="text-sm text-gray-500 mb-6">{data?.total ?? "—"} students</p>

      <input
        type="text" placeholder="Search by name..." value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="mb-4 w-full max-w-md text-sm border border-gray-300 rounded-md px-3 py-2"
      />

      <div className="bg-white rounded-lg border overflow-x-auto" style={{ borderColor: "var(--card-border)" }}>
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
                className="cursor-pointer hover:bg-gray-50 transition-colors"
                onClick={() => setSelectedId(s.id)}>
                <td className="px-4 py-2.5 font-medium" style={{ color: "var(--accent)" }}>{s.name}</td>
                <td className="px-4 py-2.5 text-gray-600">
                  {displayLocation(s.city, s.country)}
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
    </div>
  );
}
