"use client";
import * as React from "react";
import { DropdownMenu as P } from "radix-ui";
import { CheckIcon, ChevronRightIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const DropdownMenu = P.Root;
const DropdownMenuTrigger = P.Trigger;
const DropdownMenuGroup = P.Group;
const DropdownMenuSub = P.Sub;

const item =
  "relative flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none select-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground";
const content =
  "z-50 min-w-[11rem] overflow-hidden rounded-xl border bg-popover p-1 text-popover-foreground shadow-lg data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95";

function DropdownMenuContent({ className, sideOffset = 4, ...props }: React.ComponentProps<typeof P.Content>) {
  return (
    <P.Portal>
      <P.Content sideOffset={sideOffset} className={cn(content, className)} {...props} />
    </P.Portal>
  );
}
function DropdownMenuItem({ className, variant, ...props }: React.ComponentProps<typeof P.Item> & { variant?: "destructive" }) {
  return <P.Item className={cn(item, variant === "destructive" && "text-destructive focus:bg-destructive/10 focus:text-destructive [&_svg]:!text-destructive", className)} {...props} />;
}
function DropdownMenuCheckboxItem({ className, children, ...props }: React.ComponentProps<typeof P.CheckboxItem>) {
  return (
    <P.CheckboxItem className={cn(item, "pl-8", className)} {...props}>
      <span className="absolute left-2 flex size-3.5 items-center justify-center">
        <P.ItemIndicator><CheckIcon className="size-4" /></P.ItemIndicator>
      </span>
      {children}
    </P.CheckboxItem>
  );
}
function DropdownMenuLabel({ className, ...props }: React.ComponentProps<typeof P.Label>) {
  return <P.Label className={cn("px-2 py-1.5 text-xs font-medium text-muted-foreground", className)} {...props} />;
}
function DropdownMenuSeparator({ className, ...props }: React.ComponentProps<typeof P.Separator>) {
  return <P.Separator className={cn("-mx-1 my-1 h-px bg-border", className)} {...props} />;
}
function DropdownMenuSubTrigger({ className, children, ...props }: React.ComponentProps<typeof P.SubTrigger>) {
  return (
    <P.SubTrigger className={cn(item, "data-[state=open]:bg-accent", className)} {...props}>
      {children}
      <ChevronRightIcon className="ml-auto size-4" />
    </P.SubTrigger>
  );
}
function DropdownMenuSubContent({ className, ...props }: React.ComponentProps<typeof P.SubContent>) {
  return (
    <P.Portal>
      <P.SubContent className={cn(content, className)} {...props} />
    </P.Portal>
  );
}
export {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuCheckboxItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent,
};
