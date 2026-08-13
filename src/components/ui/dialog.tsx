"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}

/** Otevřené dialogy v pořadí, jak přišly - kvůli Escape u vnořených oken. */
const dialogStack: object[] = [];

/**
 * Odlehčený dialog bez externích závislostí - stejné API jako shadcn/ui,
 * takže se dá později nahradit komponentou z 21st.dev bez zásahu do volání.
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className,
}: DialogProps) {
  const [mounted, setMounted] = React.useState(false);
  const panelRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => setMounted(true), []);

  React.useEffect(() => {
    if (!open) return;
    // Dialogy se dají vnořit (výběr ikony nad formulářem projektu). Escape smí
    // zavřít jen ten nejvýš, jinak by zmizely oba naráz.
    const token = {};
    dialogStack.push(token);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && dialogStack[dialogStack.length - 1] === token) {
        onOpenChange(false);
      }
    };
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Napřed pole formuláře, teprve pak tlačítka - jinak by fokus sebral křížek.
    const panel = panelRef.current;
    const focusTarget =
      panel?.querySelector<HTMLElement>("input:not([type='hidden']), select, textarea") ??
      panel?.querySelector<HTMLElement>("button");
    focusTarget?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      const at = dialogStack.indexOf(token);
      if (at !== -1) dialogStack.splice(at, 1);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onOpenChange]);

  if (!mounted || !open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={() => onOpenChange(false)}
        aria-hidden
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          "animate-in-up relative z-10 w-full max-w-md rounded-t-xl border bg-card p-5 shadow-lg sm:rounded-xl",
          // Dlouhý obsah (typicky Nastavení) se musí dát doscrollovat, jinak
          // konec zůstane pod okrajem obrazovky. Spodní odsazení počítá
          // s pruhem gest, aby poslední tlačítko nekončilo pod ním.
          "max-h-[88dvh] overflow-y-auto pb-[calc(2rem+var(--mw-safe-bottom))] sm:max-h-[85dvh] sm:pb-5",
          className,
        )}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-base font-semibold tracking-tight">{title}</h2>
            {description ? (
              <p className="text-sm text-muted-foreground">{description}</p>
            ) : null}
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Zavřít"
            onClick={() => onOpenChange(false)}
          >
            <X />
          </Button>
        </div>
        {children}
        {footer ? <div className="mt-5 flex justify-end gap-2">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
