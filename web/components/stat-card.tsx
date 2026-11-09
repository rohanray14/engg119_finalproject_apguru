interface StatCardProps {
  label: string;
  value: string;
  sub?: string;
  subColor?: "default" | "danger";
}

export default function StatCard({ label, value, sub, subColor = "default" }: StatCardProps) {
  return (
    <div className="bg-white rounded-lg border p-5" style={{ borderColor: "var(--card-border)" }}>
      <div className="text-sm text-gray-500 mb-1">{label}</div>
      <div className="text-2xl font-bold text-gray-900">{value}</div>
      {sub && (
        <div className={`text-xs mt-1 ${
          subColor === "danger" ? "text-red-600" : "text-gray-500"
        }`}>
          {sub}
        </div>
      )}
    </div>
  );
}
