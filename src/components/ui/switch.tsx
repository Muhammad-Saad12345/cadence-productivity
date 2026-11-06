"use client";
import * as React from "react";
import { Switch as P } from "radix-ui";
import { cn } from "@/lib/utils";

function Switch({ className, ...props }: React.ComponentProps<typeof P.Root>) {
  return (
    <P.Root
      className={cn(
        "peer inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent shadow-xs transition-all outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input dark:data-[state=unchecked]:bg-input/80",
        className,
      )}
      {...props}
    >
      <P.Thumb className="pointer-events-none block size-4 rounded-full bg-background shadow-sm ring-0 transition-transform data-[state=checked]:translate-x-[calc(100%-1px)] data-[state=unchecked]:translate-x-0.5" />
    </P.Root>
  );
}
export { Switch };
