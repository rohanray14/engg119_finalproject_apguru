"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import useSWR from "swr";
import { apiFetch } from "@/lib/api";
import type { ReviewQueue } from "@/lib/types";

interface NavItem {
  href: string;
  label: string;
  badge?: number;
}

interface NavSection {
  heading?: string;
  items: NavItem[];
  defaultOpen?: boolean;
}

function fetcher<T>(path: string) { return apiFetch<T>(path); }

export default function Sidebar() {
  const pathname = usePathname();
  const { data: queue } = useSWR<ReviewQueue>("/review", fetcher, {
    refreshInterval: 30000,
  });

  const reviewCount = queue?.items.length ?? 0;

  const sections: NavSection[] = [
    {
      items: [
        { href: "/", label: "Today" },
      ],
    },
    {
      heading: "Money in",
      defaultOpen: true,
      items: [
        { href: "/payments", label: "Payments" },
        { href: "/review", label: "Match review", badge: reviewCount },
        { href: "/students", label: "Students" },
      ],
    },
    {
      heading: "Money out",
      items: [
        { href: "/money-out", label: "Expenses" },
        { href: "/commissions", label: "Commissions" },
      ],
    },
    {
      heading: "Operations",
      items: [
        { href: "/reminders", label: "Reminders" },
        { href: "/risk", label: "Risk" },
        { href: "/insights", label: "Insights" },
        { href: "/audit", label: "Audit log" },
      ],
    },
  ];

  const [manualOverrides, setManualOverrides] = useState<Record<string, boolean>>({});
  const prevPathname = useRef(pathname);

  useEffect(() => {
    if (prevPathname.current !== pathname) {
      setManualOverrides({});
      prevPathname.current = pathname;
    }
  }, [pathname]);

  const open: Record<string, boolean> = {};
  sections.forEach((s) => {
    if (!s.heading) return;
    if (s.heading in manualOverrides) {
      open[s.heading] = manualOverrides[s.heading];
      return;
    }
    const hasActive = s.items.some((item) =>
      item.href === "/" ? pathname === "/" : pathname.startsWith(item.href)
    );
    open[s.heading] = hasActive || (s.defaultOpen ?? false);
  });

  function toggle(heading: string) {
    setManualOverrides((prev) => ({ ...prev, [heading]: !open[heading] }));
  }

  return (
    <aside className="w-56 min-h-screen flex flex-col py-6 px-4 shrink-0"
      style={{ backgroundColor: "var(--sidebar-bg)", borderRight: "1px solid var(--border-subtle)" }}>
      <div className="mb-8">
        <div className="font-bold text-lg" style={{ color: "var(--text)" }}>Educore</div>
        <div className="text-xs" style={{ color: "var(--text-tertiary)" }}>Finance Desk</div>
      </div>
      <nav className="flex flex-col gap-0.5">
        {sections.map((section, si) => (
          <div key={si} className={si > 0 ? "mt-3" : ""}>
            {section.heading ? (
              <button
                onClick={() => toggle(section.heading!)}
                className="w-full flex items-center justify-between px-3 mb-1 group"
              >
                <span className="text-[11px] font-semibold uppercase tracking-wider"
                  style={{ color: "var(--text-tertiary)" }}>
                  {section.heading}
                </span>
                <svg
                  className="w-3 h-3 transition-transform"
                  style={{ color: "var(--text-tertiary)", opacity: 0.5, transform: open[section.heading] ? "rotate(180deg)" : "rotate(0deg)" }}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            ) : null}
            {(!section.heading || open[section.heading!]) && section.items.map((item) => {
              const active = item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center justify-between py-2 rounded-md text-sm transition-colors ${section.heading ? "px-5" : "px-3"}`}
                  style={{
                    backgroundColor: active ? "var(--sidebar-active-bg)" : undefined,
                    color: active ? "var(--accent)" : "var(--sidebar-text)",
                    fontWeight: active ? 500 : 400,
                  }}
                >
                  {item.label}
                  {item.badge != null && item.badge > 0 && (
                    <span className="ml-2 px-2 py-0.5 text-[11px] font-medium rounded-full"
                      style={{ backgroundColor: "var(--accent)", color: "var(--bg)" }}>
                      {item.badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="mt-auto pt-8">
        <div className="text-xs leading-relaxed" style={{ color: "var(--text-tertiary)" }}>
          <div className="font-semibold mb-1.5 text-[10px] uppercase tracking-wider opacity-70">Data sources</div>
          <div>Bank statement</div>
          <div>PayGlocal, Stripe, Razorpay</div>
          <div>Fee tracker</div>
          <div className="mt-1 opacity-50 text-[10px]">All synced on load</div>
        </div>
      </div>
    </aside>
  );
}
