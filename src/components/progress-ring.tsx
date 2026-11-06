import { cn } from "@/lib/utils";

export function ProgressRing({ value, size = 44, stroke = 4, className, label }: { value: number; size?: number; stroke?: number; className?: string; label?: React.ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className={cn("relative inline-flex shrink-0 items-center justify-center", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-muted" />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c - (v / 100) * c}
          className={cn("transition-[stroke-dashoffset] duration-700 ease-out", v >= 100 ? "stroke-emerald-500" : "stroke-primary")}
        />
      </svg>
      <span className="absolute text-[11px] font-semibold tabular">{label ?? `${Math.round(v)}%`}</span>
    </div>
  );
}
