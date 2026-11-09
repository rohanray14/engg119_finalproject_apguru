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

  // Read ?id= from URL (e.g. linked from Payments page)
  useEffect(() => {
    const idParam = searchParams.get("id");
    if (idParam && selectedId === null) {
      setSelectedId(Number(idParam));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Auto-select first item when queue loads
  const items = queue?.items ?? [];
  const activeId = selectedId ?? items[0]?.match_id ?? null;

  const { data: detail, mutate: mutateDetail } = useSWR<ReviewDetailType>(
    activeId ? `/review/${activeId}` : null,
    fetcher
  );

  const handleDecision = useCallback(() => {
    mutateQueue();
    mutateDetail();
    setSelectedId(null);
  }, [mutateQueue, mutateDetail]);

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
        <p className="text-sm text-gray-500 mt-1">
          Payments the matching agent wasn&apos;t sure about.
          {queue && ` ${queue.auto_matched_count} others were matched automatically.`}
        </p>
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
          <div className="lg:col-span-4 max-h-[calc(100vh-200px)] overflow-y-auto">
            <div className="space-y-0">
              {items.map((item) => {
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
            </div>
          </div>

          {/* Right: detail */}
          <div className="lg:col-span-8">
            {detail ? (
              <ReviewDetailComponent
                detail={detail}
                canApprove={canApprove}
                onDecision={handleDecision}
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
