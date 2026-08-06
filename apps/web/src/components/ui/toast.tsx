import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Bottom-anchored toast region (§19 round 9). Hand-authored in the same
 * shadcn idiom as the rest of `components/ui` — no extra runtime dependency,
 * and it can respect this app's safe-area custom properties, which a stock
 * toaster wouldn't know about.
 *
 * z-[800]: above the full-page screens (z-[600]), the game-over overlay
 * (z-[500]) and Dialog (z-[700]), because a toast is an announcement layer
 * that should never end up behind whatever raised it.
 *
 * `pointer-events-none` on the viewport with `pointer-events-auto` on each
 * toast keeps the area around the toasts tappable — otherwise an invisible
 * full-width strip would swallow taps meant for the board or the buttons
 * underneath.
 */
export function ToastViewport({ className, style, ...props }: React.ComponentPropsWithoutRef<"div">) {
  return (
    <div
      className={cn("pointer-events-none fixed inset-x-0 bottom-0 z-[800] flex flex-col items-center px-4", className)}
      style={{ paddingBottom: "calc(14px + var(--nonet-safe-bottom))", ...style }}
      {...props}
    />
  );
}

export const Toast = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<"div">>(function Toast(
  { className, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        "pointer-events-auto w-full rounded-xl border border-border bg-card px-3.5 py-2.5 text-left text-card-foreground shadow-lg outline-none",
        className,
      )}
      {...props}
    />
  );
});

export function ToastTitle({ className, ...props }: React.ComponentPropsWithoutRef<"div">) {
  return <div className={cn("text-sm font-semibold leading-tight", className)} {...props} />;
}

export function ToastDescription({ className, ...props }: React.ComponentPropsWithoutRef<"div">) {
  return <div className={cn("text-xs leading-tight text-muted-foreground", className)} {...props} />;
}
