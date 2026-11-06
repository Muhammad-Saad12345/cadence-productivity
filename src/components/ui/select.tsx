"use client";
import * as React from "react";
import { Select as P } from "radix-ui";
import { CheckIcon, ChevronDownIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const Select = P.Root;
const SelectValue = P.Value;
const SelectGroup = P.Group;

function SelectTrigger({ className, children, size = "default", ...props }: React.ComponentProps<typeof P.Trigger> & { size?: "sm" | "default" }) {
  return (
    <P.Trigger
      className={cn(
        "flex w-full items-center justify-between gap-2 rounded-lg border bg-background px-3 text-sm whitespace-nowrap shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 data-[placeholder]:text-muted-foreground *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-2 [&_svg]:shrink-0",
        size === "sm" ? "h-8" : "h-9",
        className,
      )}
      {...props}
    >
      {children}
      <P.Icon asChild><ChevronDownIcon className="size-4 opacity-50" /></P.Icon>
    </P.Trigger>
  );
}
function SelectContent({ className, children, position = "popper", ...props }: React.ComponentProps<typeof P.Content>) {
  return (
    <P.Portal>
      <P.Content
        position={position}
        className={cn(
          "relative z-50 max-h-(--radix-select-content-available-height) min-w-[8rem] overflow-x-hidden overflow-y-auto rounded-xl border bg-popover text-popover-foreground shadow-lg data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
          position === "popper" && "w-full min-w-[var(--radix-select-trigger-width)] data-[side=bottom]:translate-y-1",
          className,
        )}
        {...props}
      >
        <P.Viewport className="p-1">{children}</P.Viewport>
      </P.Content>
    </P.Portal>
  );
}
function SelectItem({ className, children, ...props }: React.ComponentProps<typeof P.Item>) {
  return (
    <P.Item
      className={cn(
        "relative flex w-full cursor-default items-center gap-2 rounded-md py-1.5 pr-8 pl-2 text-sm outline-none select-none focus:bg-accent data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    >
      <span className="absolute right-2 flex size-3.5 items-center justify-center">
        <P.ItemIndicator><CheckIcon className="size-4" /></P.ItemIndicator>
      </span>
      <P.ItemText>{children}</P.ItemText>
    </P.Item>
  );
}
export { Select, SelectGroup, SelectValue, SelectTrigger, SelectContent, SelectItem };
