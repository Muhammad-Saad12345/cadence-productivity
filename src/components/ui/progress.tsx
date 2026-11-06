"use client";
import * as React from "react";
import { Progress as P } from "radix-ui";
import { cn } from "@/lib/utils";

function Progress({ className, value, indicatorClassName, ...props }: React.ComponentProps<typeof P.Root> & { indicatorClassName?: string }) {
  const v = Math.max(0, Math.min(100, value ?? 0));
  return (
    <P.Root className={cn("relative h-1.5 w-full overflow-hidden rounded-full bg-muted", className)} value={v} {...props}>
      <P.Indicator
        className={cn("h-full w-full flex-1 rounded-full bg-primary transition-transform duration-500 ease-out", indicatorClassName)}
        style={{ transform: `translateX(-${100 - v}%)` }}
      />
    </P.Root>
  );
}
export { Progress };
