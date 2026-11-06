import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap ring-1 ring-inset [&>svg]:size-3",
  {
    variants: {
      variant: {
        default: "bg-primary/10 text-primary ring-primary/20",
        outline: "text-muted-foreground ring-border",
        secondary: "bg-secondary text-secondary-foreground ring-transparent",
        custom: "",
      },
    },
    defaultVariants: { variant: "outline" },
  },
);

function Badge({ className, variant, ...props }: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}
export { Badge, badgeVariants };
