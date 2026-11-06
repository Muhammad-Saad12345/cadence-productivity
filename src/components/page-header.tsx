import { cn } from "@/lib/utils";

export function PageHeader({
  title, description, actions, className,
}: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("mb-6 flex flex-wrap items-end justify-between gap-3", className)}>
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ icon, title, description, action, className }: {
  icon?: React.ReactNode; title: string; description?: string; action?: React.ReactNode; className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center rounded-xl border border-dashed px-6 py-12 text-center", className)}>
      {icon && <div className="mb-3 rounded-full bg-muted p-3 text-muted-foreground [&_svg]:size-5">{icon}</div>}
      <p className="text-sm font-medium">{title}</p>
      {description && <p className="mt-1 max-w-sm text-[13px] text-muted-foreground">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
