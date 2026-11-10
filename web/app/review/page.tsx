"use client";

import { Suspense, useState, useCallback, useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import useSWR from "swr";
import { apiFetch } from "@/lib/api";
import type { ReviewQueue, ReviewDetail as ReviewDetailType, BulkResult } from "@/lib/types";
import { useAppUser } from "@/app/providers";
import ReviewList from "@/components/review-list";
import ReviewDetailComponent from "@/components/review-detail";

function fetcher<T>(path: string) {
  return apiFetch<T>(path);
}

export default function ReviewPage() {
  return (
    <Suspense fallback={<div className="p-8"><div className="animate-pulse h-64 bg-gray-200 rounded" /></div>}>
      <ReviewContent />
    </Suspense>
  );
}

type FilterKey = "all" | "quick_approve" | "needs_attention" | "no_suggestion";

const FILTER_OPTIONS: { value: FilterKey; label: string }[] = [
  { value: "all", label: "All items" },
  { value: "quick_approve", label: "Quick approvals (90%+)" },
  { value: "needs_attention", label: "Needs attention (<85%)" },
  { value: "no_suggestion", label: "No suggestion" },
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
  const [bulkSelected, setBulkSelected] = useState<Set<number>>(new Set());
  const [bulkActing, setBulkActing] = useState(false);
  const [bulkResult, setBulkResult] = useState<BulkResult | null>(null);
  const [reviewedCount, setReviewedCount] = useState(0);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [listSearch, setListSearch] = useState("");

  // Read ?id= from URL (e.g. linked from Payments page)
  useEffect(() => {
    const idParam = searchParams.get("id");
    if (idParam && selectedId === null) {
      setSelectedId(Number(idParam));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const items = queue?.items ?? [];

  // Filter items
  const searchLower = listSearch.toLowerCase();
  const filteredItems = items.filter((item) => {
    // Category filter
    switch (filter) {
      case "quick_approve": if (!(item.has_suggestion && item.confidence >= 0.9)) return false; break;
      case "needs_attention": if (!(item.confidence < 0.85 || !item.has_suggestion)) return false; break;
      case "no_suggestion": if (item.has_suggestion) return false; break;
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
    const idx = filteredItems.findIndex((i) => i.match_id === activeId);
    const next = filteredItems[idx + 1] ?? filteredItems[0];
    if (next && next.match_id !== activeId) setSelectedId(next.match_id);
  }, [activeId, filteredItems]);

  // Queue position
  const activeIndex = filteredItems.findIndex((i) => i.match_id === activeId);

  const eligibleForBulk = items.filter(
    (i) => i.has_suggestion && i.confidence >= (queue?.bulk_approve_min_confidence ?? 0.9)
  );

  async function handleBulkApprove() {
    const ids = Array.from(bulkSelected);
    if (ids.length === 0) return;
    setBulkActing(true);
    setBulkResult(null);
    try {
      const result = await apiFetch<BulkResult>("/review/bulk-approve", {
        method: "POST",
        body: { match_ids: ids },
      });
      setBulkResult(result);
      setBulkSelected(new Set());
      setReviewedCount((c) => c + result.approved.length);
      mutateQueue();
    } catch (e: unknown) {
      setBulkResult(null);
      alert(e instanceof Error ? e.message : "Bulk approve failed");
    } finally {
      setBulkActing(false);
    }
  }

  function toggleBulk(id: number) {
    setBulkSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllBulk() {
    if (bulkSelected.size === eligibleForBulk.length) {
      setBulkSelected(new Set());
    } else {
      setBulkSelected(new Set(eligibleForBulk.map((i) => i.match_id)));
    }
  }

  if (isLoading) {
    return (
      <div className="p-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-64" />
          <div className="h-64 bg-gray-200 rounded" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Match review</h1>
        <div className="flex items-center gap-3 mt-1">
          <p className="text-sm text-gray-500">
            Payments the matching agent wasn&apos;t sure about.
            {queue && ` ${queue.auto_matched_count} others were matched automatically.`}
          </p>
          {reviewedCount > 0 && (
            <span className="text-xs font-medium px-2 py-1 rounded-full" style={{ backgroundColor: "#dcfce7", color: "#166534" }}>
              {reviewedCount} reviewed this session
            </span>
          )}
        </div>
        {queue && queue.auto_matched_count > 0 && items.length > 0 && (
          <div className="mt-3">
            <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
              <span>{queue.auto_matched_count} auto-matched</span>
              <span>{items.length} need review</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div className="h-2 rounded-full" style={{
                width: `${Math.round((queue.auto_matched_count / (queue.auto_matched_count + items.length)) * 100)}%`,
                backgroundColor: "var(--accent)",
              }} />
            </div>
          </div>
        )}
      </div>

      {/* Bulk approve bar */}
      {canApprove && eligibleForBulk.length > 0 && (
        <div className="bg-white rounded-lg border p-4 mb-6 flex items-center justify-between"
          style={{ borderColor: "var(--card-border)" }}>
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={bulkSelected.size === eligibleForBulk.length && eligibleForBulk.length > 0}
              onChange={selectAllBulk}
              className="rounded"
            />
            <span className="text-sm text-gray-700">
              {eligibleForBulk.length} items above {Math.round((queue?.bulk_approve_min_confidence ?? 0.9) * 100)}%
              confidence
            </span>
            {bulkSelected.size > 0 && (
              <span className="text-sm font-medium text-gray-900">
                ({bulkSelected.size} selected)
              </span>
            )}
          </div>
          <button
            onClick={handleBulkApprove}
            disabled={bulkSelected.size === 0 || bulkActing}
            className="px-4 py-2 text-sm font-medium text-white rounded-md disabled:opacity-50"
            style={{ backgroundColor: "var(--accent)" }}
          >
            {bulkActing ? "Approving..." : `Bulk approve ${bulkSelected.size}`}
          </button>
        </div>
      )}

      {/* Bulk result toast */}
      {bulkResult && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-4 text-sm text-green-800">
          Approved {bulkResult.approved.length} payments.
          {bulkResult.skipped.length > 0 && ` Skipped ${bulkResult.skipped.length}.`}
        </div>
      )}

      {items.length === 0 ? (
        <div className="bg-white rounded-lg border p-12 text-center" style={{ borderColor: "var(--card-border)" }}>
          <div className="text-lg font-medium text-gray-900">All caught up</div>
          <p className="text-sm text-gray-500 mt-1">No payments waiting for review.</p>
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
                  className="text-sm border border-gray-300 rounded-md px-2 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-300"
                >
                  {FILTER_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
                <span className="text-xs text-gray-400">
                  {filteredItems.length} of {items.length}
                </span>
              </div>
              <input
                type="text"
                value={listSearch}
                onChange={(e) => { setListSearch(e.target.value); setSelectedId(null); }}
                placeholder="Search by payer or student name..."
                className="w-full text-sm border border-gray-300 rounded-md px-2.5 py-1.5 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-300 placeholder:text-gray-400"
              />
            </div>
            <div className="max-h-[calc(100vh-260px)] overflow-y-auto">
              <div className="space-y-0">
                {filteredItems.map((item) => {
                  const active = item.match_id === activeId;
                  const eligible = item.has_suggestion && item.confidence >= (queue?.bulk_approve_min_confidence ?? 0.9);
                  return (
                    <div key={item.match_id} className="flex items-center gap-2"
                      ref={active ? (el) => { el?.scrollIntoView({ block: "nearest", behavior: "smooth" }); } : undefined}>
                      {canApprove && eligible && (
                        <input
                          type="checkbox"
                          checked={bulkSelected.has(item.match_id)}
                          onChange={() => toggleBulk(item.match_id)}
                          className="shrink-0 rounded"
                          onClick={(e) => e.stopPropagation()}
                        />
                      )}
                      <div className="flex-1">
                        <ReviewList
                          items={[item]}
                          selectedId={active ? item.match_id : null}
                          onSelect={setSelectedId}
                        />
                      </div>
                    </div>
                  );
                })}
                {filteredItems.length === 0 && (
                  <div className="text-sm text-gray-500 text-center py-8">
                    No items match this filter.
                  </div>
                )}
              </div>
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
              <div className="bg-white rounded-lg border p-12 text-center" style={{ borderColor: "var(--card-border)" }}>
                <p className="text-sm text-gray-500">Select a payment to see details</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
