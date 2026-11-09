/**
 * Format paise as currency with Indian grouping.
 * e.g. 14200000 INR -> "₹1,42,000"  or  40000 USD -> "$400"
 */
export function formatMoney(paise: number, currency: string): string {
  const amount = paise / 100;
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

/**
 * Compact money: ₹1.42 Cr, ₹6.8 L, ₹41,300
 */
export function formatMoneyCompact(paise: number, currency: string): string {
  const amount = paise / 100;
  if (currency === "INR") {
    if (amount >= 1_00_00_000) {
      return `₹${(amount / 1_00_00_000).toFixed(2)} Cr`;
    }
    if (amount >= 1_00_000) {
      return `₹${(amount / 1_00_000).toFixed(1)} L`;
    }
  }
  return formatMoney(paise, currency);
}

/** ISO date -> DD/MM/YYYY */
export function formatDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso + (iso.includes("T") ? "" : "T00:00:00"));
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** ISO date -> "5 November" style */
export function formatDateLong(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso + (iso.includes("T") ? "" : "T00:00:00"));
  const day = d.toLocaleDateString("en-GB", { weekday: "long" });
  const rest = d.toLocaleDateString("en-GB", { day: "numeric", month: "long" });
  return `${day}, ${rest}`;
}

/** Confidence as percentage string */
export function formatConfidence(c: number): string {
  return `${Math.round(c * 100)}%`;
}
