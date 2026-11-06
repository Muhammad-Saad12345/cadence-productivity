import { Badge } from "@/components/ui/badge";
import { goalStatusMeta, priorityMeta, statusMeta } from "@/lib/constants";
import type { GoalStatus, Priority, TaskStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

export function StatusBadge({ status, className }: { status: TaskStatus; className?: string }) {
  const m = statusMeta(status);
  return <Badge variant="custom" className={cn(m.badge, className)}>{m.label}</Badge>;
}
export function GoalStatusBadge({ status, className }: { status: GoalStatus; className?: string }) {
  const m = goalStatusMeta(status);
  return <Badge variant="custom" className={cn(m.badge, className)}>{m.label}</Badge>;
}
export function PriorityDot({ priority, className }: { priority: Priority; className?: string }) {
  const m = priorityMeta(priority);
  return <span title={`${m.label} priority`} className={cn("inline-block size-2 shrink-0 rounded-full", m.dot, className)} />;
}
export function PriorityLabel({ priority }: { priority: Priority }) {
  const m = priorityMeta(priority);
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium", m.text)}>
      <PriorityDot priority={priority} />
      {m.label}
    </span>
  );
}
