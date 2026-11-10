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

/** Normalize city names to a canonical display form */
const CITY_MAP: Record<string, string> = {
  Bengaluru: "Bangalore", Bangalore: "Bangalore", Blore: "Bangalore",
  Bombay: "Mumbai", Mumbai: "Mumbai",
  Calcutta: "Kolkata", Kolkata: "Kolkata",
  Madras: "Chennai", Chennai: "Chennai",
  DXB: "Dubai", Dubai: "Dubai", dubai: "Dubai",
};

export function displayCity(raw: string | null | undefined): string {
  if (!raw) return "";
  return CITY_MAP[raw] ?? raw;
}

/** Normalize country names to a canonical display form */
const COUNTRY_MAP: Record<string, string> = {
  IN: "India", India: "India",
  US: "USA", USA: "USA", "United States": "USA",
  UK: "UK", "United Kingdom": "UK",
  UAE: "UAE", "United Arab Emirates": "UAE", "U.A.E": "UAE",
  SG: "Singapore", Singapore: "Singapore",
};

export function displayCountry(raw: string | null | undefined): string {
  if (!raw) return "";
  return COUNTRY_MAP[raw] ?? raw;
}

/** Format city + country into a display string */
export function displayLocation(city: string | null | undefined, country: string | null | undefined): string {
  return [displayCity(city), displayCountry(country)].filter(Boolean).join(", ") || "—";
}
