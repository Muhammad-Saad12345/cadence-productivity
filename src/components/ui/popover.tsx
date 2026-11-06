"use client";
import * as React from "react";
import { Popover as P } from "radix-ui";
import { cn } from "@/lib/utils";

const Popover = P.Root;
const PopoverTrigger = P.Trigger;
function PopoverContent({ className, align = "center", sideOffset = 6, ...props }: React.ComponentProps<typeof P.Content>) {
  return (
    <P.Portal>
      <P.Content
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "z-50 w-72 rounded-xl border bg-popover p-4 text-popover-foreground shadow-lg outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
          className,
        )}
        {...props}
      />
    </P.Portal>
  );
}
export { Popover, PopoverTrigger, PopoverContent };
