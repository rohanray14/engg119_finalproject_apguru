"use client";

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
      ],
    },
    {
      heading: "Tools",
      items: [
        { href: "/ask", label: "Ask" },
        { href: "/audit", label: "Audit log" },
      ],
    },
  ];

  return (
    <aside className="w-52 min-h-screen flex flex-col py-6 px-4 shrink-0"
      style={{ backgroundColor: "var(--sidebar-bg)" }}>
      <div className="mb-8">
        <div className="text-white font-bold text-lg">Educore</div>
        <div className="text-xs" style={{ color: "var(--sidebar-text)" }}>Finance Desk</div>
      </div>
      <nav className="flex flex-col gap-0.5">
        {sections.map((section, si) => (
          <div key={si} className={si > 0 ? "mt-4" : ""}>
            {section.heading && (
              <div className="px-3 mb-1 text-[10px] font-semibold uppercase tracking-wider"
                style={{ color: "var(--sidebar-text)", opacity: 0.6 }}>
                {section.heading}
              </div>
            )}
            {section.items.map((item) => {
              const active = item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center justify-between px-3 py-2 rounded-md text-sm transition-colors ${
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
        <div className="text-[10px] leading-relaxed" style={{ color: "var(--sidebar-text)" }}>
          <div className="font-semibold mb-1">Data sources</div>
          <div>Bank statement · synced on load</div>
          <div>PayGlocal, Stripe, Razorpay · synced on load</div>
          <div>Fee tracker · synced on load</div>
        </div>
      </div>
    </aside>
  );
}
