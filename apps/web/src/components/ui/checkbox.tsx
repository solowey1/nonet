import * as React from "react";
import { Checkbox as BaseCheckbox } from "@base-ui/react/checkbox";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface CheckboxProps
  extends Omit<React.ComponentPropsWithoutRef<typeof BaseCheckbox.Root>, "children" | "render"> {}

export const Checkbox = React.forwardRef<HTMLElement, CheckboxProps>(function Checkbox(
  { className, checked, ...props },
  ref,
) {
  return (
    <BaseCheckbox.Root
      ref={ref}
      checked={checked}
      className={cn(
        "flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-input transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-primary border-primary" : "bg-transparent",
        className,
      )}
      {...props}
    >
      <BaseCheckbox.Indicator className="flex items-center justify-center text-primary-foreground">
        <Check className="h-3.5 w-3.5" strokeWidth={3} />
      </BaseCheckbox.Indicator>
    </BaseCheckbox.Root>
  );
});
