"use client";
import * as React from "react";
import { Checkbox as P } from "radix-ui";
import { CheckIcon } from "lucide-react";
import { cn } from "@/lib/utils";

function Checkbox({ className, ...props }: React.ComponentProps<typeof P.Root>) {
  return (
    <P.Root
      className={cn(
        "peer size-4 shrink-0 rounded-[5px] border border-input shadow-xs transition outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground",
        className,
      )}
      {...props}
    >
      <P.Indicator className="flex items-center justify-center text-current">
        <CheckIcon className="size-3.5" strokeWidth={3} />
      </P.Indicator>
    </P.Root>
  );
}
export { Checkbox };
