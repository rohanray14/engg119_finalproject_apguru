interface StatCardProps {
  label: string;
  value: string;
  sub?: string;
  subColor?: "default" | "danger";
}

export default function StatCard({ label, value, sub, subColor = "default" }: StatCardProps) {
  return (
    <div className="rounded-lg border p-5" style={{ backgroundColor: "var(--surface)", borderColor: "var(--card-border)" }}>
      <div className="text-sm mb-1" style={{ color: "var(--text-secondary)" }}>{label}</div>
      <div className="text-2xl font-bold" style={{ color: "var(--text)" }}>{value}</div>
      {sub && (
        <div className="text-xs mt-1" style={{ color: subColor === "danger" ? "var(--danger)" : "var(--text-secondary)" }}>
          {sub}
        </div>
      )}
    </div>
  );
}
