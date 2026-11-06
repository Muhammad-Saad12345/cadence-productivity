"use client";
import * as React from "react";
import { Command as CommandPrimitive } from "cmdk";
import { SearchIcon } from "lucide-react";
import { cn } from "@/lib/utils";

function Command({ className, ...props }: React.ComponentProps<typeof CommandPrimitive>) {
  return <CommandPrimitive className={cn("flex h-full w-full flex-col overflow-hidden rounded-xl bg-popover text-popover-foreground", className)} {...props} />;
}
function CommandInput({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Input>) {
  return (
    <div className="flex h-12 items-center gap-2 border-b px-4">
      <SearchIcon className="size-4 shrink-0 opacity-50" />
      <CommandPrimitive.Input className={cn("flex h-10 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:opacity-50", className)} {...props} />
    </div>
  );
}
function CommandList({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.List>) {
  return <CommandPrimitive.List className={cn("max-h-[min(60dvh,420px)] scroll-py-1 overflow-x-hidden overflow-y-auto p-1", className)} {...props} />;
}
const CommandEmpty = (props: React.ComponentProps<typeof CommandPrimitive.Empty>) => (
  <CommandPrimitive.Empty className="py-8 text-center text-sm text-muted-foreground" {...props} />
);
function CommandGroup({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Group>) {
  return <CommandPrimitive.Group className={cn("overflow-hidden p-1 text-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground", className)} {...props} />;
}
function CommandItem({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Item>) {
  return <CommandPrimitive.Item className={cn("relative flex cursor-default items-center gap-2 rounded-md px-2 py-2 text-sm outline-none select-none data-[selected=true]:bg-accent data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg:not([class*='text-'])]:text-muted-foreground", className)} {...props} />;
}
export { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem };
