import { Suspense } from "react";
import { AppShell } from "@/components/app-shell";
import { Skeleton } from "@/components/ui/skeleton";

function PageSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-4 w-72" />
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Skeleton className="h-24" /><Skeleton className="h-24" /><Skeleton className="h-24" />
      </div>
      <Skeleton className="h-64" />
    </div>
  );
}

// Every page here is personal, time-dependent data: render it per request on the client,
// inside a static, instantly-served shell (sidebar, navigation).
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell>
      <Suspense fallback={<PageSkeleton />}>{children}</Suspense>
    </AppShell>
  );
}
