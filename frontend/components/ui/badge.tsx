import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold", {
  variants: {
    variant: {
      success: "bg-accent/15 text-accent border border-accent/30",
      danger: "bg-danger/15 text-danger border border-danger/30",
      warning: "bg-warning/15 text-warning border border-warning/30",
      muted: "bg-white/8 text-slate-200 border border-white/10"
    }
  },
  defaultVariants: {
    variant: "muted"
  }
});

type BadgeProps = React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof badgeVariants>;

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge };
