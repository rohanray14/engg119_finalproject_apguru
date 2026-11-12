"use client";

import { Suspense, useState, useCallback, useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import { apiFetch } from "@/lib/api";
import type { ReviewQueue, ReviewDetail as ReviewDetailType } from "@/lib/types";
import { useAppUser } from "@/app/providers";
import ReviewList from "@/components/review-list";
import ReviewDetailComponent from "@/components/review-detail";

function fetcher<T>(path: string) {
  return apiFetch<T>(path);
}

export default function ReviewPage() {
  return (
    <Suspense fallback={<div className="p-8"><div className="animate-pulse h-64 rounded" style={{ backgroundColor: "var(--surface)" }} /></div>}>
      <ReviewContent />
    </Suspense>
  );
}

type FilterKey = "all" | "high" | "medium" | "low";

const FILTER_OPTIONS: { value: FilterKey; label: string }[] = [
  { value: "all", label: "All items" },
  { value: "high", label: "Strong match" },
  { value: "medium", label: "Weak match" },
  { value: "low", label: "No suggestion" },
];

function ReviewContent() {
  const { user } = useAppUser();
  const canApprove = user?.can_approve ?? false;
  const searchParams = useSearchParams();

  const { data: queue, mutate: mutateQueue, isLoading } = useSWR<ReviewQueue>(
    "/review",
    fetcher
  );

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [reviewedCount, setReviewedCount] = useState(0);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [listSearch, setListSearch] = useState("");
  const [skippedIds, setSkippedIds] = useState<Set<number>>(new Set());

  // Read ?id= from URL (e.g. linked from Payments page)
  useEffect(() => {
    const idParam = searchParams.get("id");
    if (idParam) {
      const id = Number(idParam);
      setSelectedId(id);
      setFilter("all");
      setListSearch("");
      // Re-fetch queue so newly created items appear in the list
      mutateQueue();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const items = queue?.items ?? [];

  // Filter items
  const searchLower = listSearch.toLowerCase();
  const filteredItems = items.filter((item) => {
    // Category filter
    switch (filter) {
      case "high": if (!(item.has_suggestion && item.confidence >= 0.85)) return false; break;
      case "medium": if (!(item.has_suggestion && item.confidence < 0.85)) return false; break;
      case "low": if (item.has_suggestion) return false; break;
    }
    // Name search
    if (searchLower) {
      const payer = (item.payment.payer_name || "").toLowerCase();
      const student = (item.suggested_student || "").toLowerCase();
      if (!payer.includes(searchLower) && !student.includes(searchLower)) return false;
    }
    return true;
  });

  // Auto-select first filtered item
  const activeId = selectedId ?? filteredItems[0]?.match_id ?? null;

  const { data: detail, mutate: mutateDetail } = useSWR<ReviewDetailType>(
    activeId ? `/review/${activeId}` : null,
    fetcher
  );

  const handleDecision = useCallback(() => {
    mutateQueue();
    mutateDetail();
    setSelectedId(null);
    setReviewedCount((c) => c + 1);
  }, [mutateQueue, mutateDetail]);

  const handleSkip = useCallback(() => {
    if (!activeId || filteredItems.length === 0) return;
    setSkippedIds((prev) => new Set(prev).add(activeId));
    const idx = filteredItems.findIndex((i) => i.match_id === activeId);
    const next = filteredItems[idx + 1] ?? filteredItems[0];
    if (next && next.match_id !== activeId) setSelectedId(next.match_id);
  }, [activeId, filteredItems]);

  // Keyboard shortcuts
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      // Don't capture when typing in inputs
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        const idx = filteredItems.findIndex((i) => i.match_id === activeId);
        const next = filteredItems[idx + 1];
        if (next) setSelectedId(next.match_id);
      } else if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        const idx = filteredItems.findIndex((i) => i.match_id === activeId);
        const prev = filteredItems[idx - 1];
        if (prev) setSelectedId(prev.match_id);
      } else if (e.key === "s") {
        e.preventDefault();
        handleSkip();
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [activeId, filteredItems, handleSkip]);

  // Queue position
  const activeIndex = filteredItems.findIndex((i) => i.match_id === activeId);

  if (isLoading) {
    return (
      <div className="p-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 rounded w-64" style={{ backgroundColor: "var(--surface)" }} />
          <div className="h-64 rounded" style={{ backgroundColor: "var(--surface)" }} />
        </div>
      </div>
    );
  }

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold" style={{ color: "var(--text)" }}>Match review</h1>
        <div className="flex items-center gap-3 mt-1">
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            Payments the matching agent wasn&apos;t sure about.
            {queue && ` ${queue.auto_matched_count} others were matched automatically.`}
          </p>
          {reviewedCount > 0 && (
            <span className="text-xs font-medium px-2 py-1 rounded-full" style={{ backgroundColor: "rgba(0, 220, 130, 0.15)", color: "var(--accent)" }}>
              {reviewedCount} reviewed this session
            </span>
          )}
        </div>
        {queue && queue.auto_matched_count > 0 && items.length > 0 && (
          <div className="mt-3">
            <div className="flex items-center justify-between text-xs mb-1" style={{ color: "var(--text-secondary)" }}>
              <span>{queue.auto_matched_count} auto-matched</span>
              <span>{items.length} need review</span>
            </div>
            <div className="w-full rounded-full h-2" style={{ backgroundColor: "var(--surface)" }}>
              <div className="h-2 rounded-full" style={{
                width: `${Math.round((queue.auto_matched_count / (queue.auto_matched_count + items.length)) * 100)}%`,
                backgroundColor: "var(--accent)",
              }} />
            </div>
          </div>
        )}
      </div>


      {items.length === 0 ? (
        <div className="rounded-xl border p-12 text-center" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
          <div className="text-lg font-medium" style={{ color: "var(--text)" }}>All caught up</div>
          <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>No payments waiting for review.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left: payment list */}
          <div className="lg:col-span-4">
            {/* Filter + search */}
            <div className="mb-3 space-y-2">
              <div className="flex items-center gap-2">
                <select
                  value={filter}
                  onChange={(e) => { setFilter(e.target.value as FilterKey); setSelectedId(null); }}
                  className="text-sm rounded-md px-2 py-1.5 focus:outline-none focus:ring-2"
                  style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)", color: "var(--text)", border: "1px solid var(--border)" }}
                >
                  {FILTER_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
                <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>
                  {filteredItems.length} of {items.length}
                </span>
              </div>
              <input
                type="text"
                value={listSearch}
                onChange={(e) => { setListSearch(e.target.value); setSelectedId(null); }}
                placeholder="Search by payer or student name..."
                className="w-full text-sm rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-2"
                style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)", color: "var(--text)", border: "1px solid var(--border)" }}
              />
            </div>
            <div className="max-h-[calc(100vh-260px)] overflow-y-auto">
              {filteredItems.length === 0 ? (
                <div className="text-sm text-center py-8" style={{ color: "var(--text-secondary)" }}>
                  No items match this filter.
                </div>
              ) : (
                <ReviewList
                  items={filteredItems}
                  selectedId={activeId}
                  onSelect={setSelectedId}
                  skippedIds={skippedIds}
                />
              )}
            </div>
          </div>

          {/* Right: detail */}
          <div className="lg:col-span-8 max-h-[calc(100vh-200px)] overflow-y-auto">
            {detail ? (
              <ReviewDetailComponent
                detail={detail}
                canApprove={canApprove}
                onDecision={handleDecision}
                onSkip={handleSkip}
                queuePosition={activeIndex >= 0 ? activeIndex + 1 : undefined}
                queueTotal={filteredItems.length}
              />
            ) : (
              <div className="rounded-xl border p-12 text-center" style={{ backgroundColor: "var(--surface)", borderColor: "var(--border)" }}>
                <p className="text-sm" style={{ color: "var(--text-secondary)" }}>Select a payment to see details</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
