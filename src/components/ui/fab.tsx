"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Plovoucí tlačítko pro hlavní akci obrazovky. Sedí nad spodní lištou -
 * odsazení počítá s její výškou i s pruhem gest, aby ho na telefonu
 * s gestovou navigací nepřekryl systém.
 *
 * Na širokém okně spodní lišta není, takže může klesnout níž.
 */
export function Fab({
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        "mw-fab-in fixed z-30 inline-flex items-center gap-2 rounded-md",
        "bottom-[calc(5rem+var(--mw-safe-bottom))] right-[calc(1.25rem+var(--mw-safe-right))]",
        "sm:bottom-6 sm:right-6",
        "h-11 px-4 text-sm font-medium",
        "bg-foreground text-background shadow-lg shadow-black/25",
        "transition-transform active:scale-95 hover:brightness-90",
        "[&_svg]:size-5 [&_svg]:shrink-0",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
