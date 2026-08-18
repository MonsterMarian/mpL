"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

/**
 * Panel vyjetý od spodní hrany.
 *
 * Nabídka u skladby patří k prstu, ne na druhý konec displeje: dialog shora
 * se otevíral daleko od tlačítka, kterým se vyvolal, a působilo to jako by
 * appka skočila někam jinam. Panel vyjede odtamtud, kam se sahá, a spadne
 * zpátky stejnou cestou.
 *
 * Nastavení zůstává dialogem přes celou obrazovku - tam se čte a nastavuje,
 * tady se jedním klepnutím rozhoduje.
 */
export interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}

export function Sheet({ open, onOpenChange, title, description, children, className }: SheetProps) {
  const [mounted, setMounted] = React.useState(false);
  /** Zavírání se přehraje celé, teprve pak panel zmizí ze stromu. */
  const [closing, setClosing] = React.useState(false);
  const visible = open || closing;

  React.useEffect(() => setMounted(true), []);

  React.useEffect(() => {
    if (open) {
      setClosing(false);
      return;
    }
    if (!mounted) return;
    setClosing(true);
    const timer = window.setTimeout(() => setClosing(false), 200);
    return () => window.clearTimeout(timer);
  }, [open, mounted]);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onOpenChange]);

  if (!mounted || !visible) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div
        className={cn("absolute inset-0 bg-black/55", open ? "mw-fade-in" : "mw-fade-out")}
        onClick={() => onOpenChange(false)}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : undefined}
        className={cn(
          "relative z-10 max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-t-3xl border-t border-white/10 bg-popover text-popover-foreground",
          "px-4 pb-[calc(1.25rem+var(--mw-safe-bottom))] pt-2 shadow-2xl shadow-black/60 sm:mb-6 sm:rounded-3xl sm:border",
          open ? "mw-sheet-in" : "mw-sheet-out",
          className,
        )}
      >
        {/* Úchyt: říká, že panel patří ke spodní hraně a dá se odsud shodit. */}
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/20" aria-hidden />
        {title ? (
          <div className="mb-3 px-1">
            <h2 className="truncate text-base font-semibold tracking-tight">{title}</h2>
            {description ? <p className="mt-0.5 truncate text-xs text-muted-foreground">{description}</p> : null}
          </div>
        ) : null}
        {children}
      </div>
    </div>,
    document.body,
  );
}
