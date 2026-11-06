"use client";
import * as React from "react";
import { Tabs as P } from "radix-ui";
import { cn } from "@/lib/utils";

const Tabs = ({ className, ...props }: React.ComponentProps<typeof P.Root>) => (
  <P.Root className={cn("flex flex-col gap-4", className)} {...props} />
);
const TabsList = ({ className, ...props }: React.ComponentProps<typeof P.List>) => (
  <P.List className={cn("inline-flex h-9 w-fit items-center rounded-lg bg-muted p-1 text-muted-foreground", className)} {...props} />
);
const TabsTrigger = ({ className, ...props }: React.ComponentProps<typeof P.Trigger>) => (
  <P.Trigger
    className={cn(
      "inline-flex h-full items-center justify-center gap-1.5 rounded-md px-3 text-[13px] font-medium whitespace-nowrap transition outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm [&_svg]:size-4",
      className,
    )}
    {...props}
  />
);
const TabsContent = ({ className, ...props }: React.ComponentProps<typeof P.Content>) => (
  <P.Content className={cn("outline-none", className)} {...props} />
);
export { Tabs, TabsList, TabsTrigger, TabsContent };
