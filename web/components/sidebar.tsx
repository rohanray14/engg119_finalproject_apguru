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
        { href: "/commissions", label: "Commissions" },
        { href: "/money-out", label: "Expenses" },
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

  // Track which sections the user has manually toggled
  const [manualOverrides, setManualOverrides] = useState<Record<string, boolean>>({});
  const prevPathname = useRef(pathname);

  // When the pathname changes (navigation), clear manual overrides so the
  // correct section opens automatically for the new page.
  useEffect(() => {
    if (prevPathname.current !== pathname) {
      setManualOverrides({});
      prevPathname.current = pathname;
    }
  }, [pathname]);

  // Derive open state: a section is open if it contains the active page,
  // has defaultOpen, or the user manually toggled it.
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
    <aside className="w-52 min-h-screen flex flex-col py-6 px-4 shrink-0"
      style={{ backgroundColor: "var(--sidebar-bg)" }}>
      <div className="mb-8">
        <div className="text-white font-bold text-lg">Educore</div>
        <div className="text-xs" style={{ color: "var(--sidebar-text)" }}>Finance Desk</div>
      </div>
      <nav className="flex flex-col gap-0.5">
        {sections.map((section, si) => (
          <div key={si} className={si > 0 ? "mt-3" : ""}>
            {section.heading ? (
              <button
                onClick={() => toggle(section.heading!)}
                className="w-full flex items-center justify-between px-3 mb-1 group"
              >
                <span className="text-xs font-bold uppercase tracking-wider"
                  style={{ color: "var(--sidebar-text)" }}>
                  {section.heading}
                </span>
                <svg
                  className="w-3 h-3 transition-transform"
                  style={{ color: "var(--sidebar-text)", opacity: 0.5, transform: open[section.heading] ? "rotate(180deg)" : "rotate(0deg)" }}
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
                  className={`flex items-center justify-between py-2 rounded-md text-sm transition-colors ${section.heading ? "px-5" : "px-3"} ${
                    active
                      ? "text-white font-medium"
                      : "hover:text-white"
                  }`}
                  style={{
                    backgroundColor: active ? "var(--sidebar-active-bg)" : undefined,
                    color: active ? "var(--sidebar-active)" : "var(--sidebar-text)",
                  }}
                >
                  {item.label}
                  {item.badge != null && item.badge > 0 && (
                    <span className="ml-2 px-2 py-0.5 text-xs font-medium text-white rounded-full"
                      style={{ backgroundColor: "var(--badge-teal)" }}>
                      {item.badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Data sources footer */}
      <div className="mt-auto pt-8">
        <div className="text-xs leading-relaxed" style={{ color: "var(--sidebar-text)" }}>
          <div className="font-semibold mb-1.5 text-[11px] uppercase tracking-wider opacity-70">Data sources</div>
          <div>Bank statement</div>
          <div>PayGlocal, Stripe, Razorpay</div>
          <div>Fee tracker</div>
          <div className="mt-1 opacity-50 text-[10px]">All synced on load</div>
        </div>
      </div>
    </aside>
  );
}
