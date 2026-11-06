"use client";
import * as React from "react";
import { Tooltip as P } from "radix-ui";
import { cn } from "@/lib/utils";

const TooltipProvider = P.Provider;
function Tooltip({ children, content, side = "top" }: { children: React.ReactNode; content: React.ReactNode; side?: "top" | "right" | "bottom" | "left" }) {
  return (
    <P.Root>
      <P.Trigger asChild>{children}</P.Trigger>
      <P.Portal>
        <P.Content side={side} sideOffset={6} className={cn("z-50 rounded-md bg-foreground px-2 py-1 text-xs text-background shadow-md animate-in fade-in-0 zoom-in-95")}>
          {content}
        </P.Content>
      </P.Portal>
    </P.Root>
  );
}
export { Tooltip, TooltipProvider };
