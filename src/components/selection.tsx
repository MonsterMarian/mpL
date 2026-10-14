"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { Check, CheckCheck, Loader2, X, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Výběr víc věcí naráz - stejný v hudbě, ve videu i v dokumentech.
 *
 * Podržení prstu věc vybere a dole se hned ukáže, co se s výběrem dá dělat.
 * Další klepnutí přidávají a ubírají. Dřív se akce schovávaly za tři tečky
 * v horní liště a každá hromadná akce znamenala klepnutí navíc.
 */

/** Kolik je vybráno. „Vybráno" sedí na skladby, filmy i knihy zároveň. */
function countLabel(count: number): string {
  return count ? `Vybráno: ${count}` : "Nic není vybrané";
}

/**
 * Horní lišta výběru: zrušit, kolik je vybráno, vybrat vše.
 *
 * Lepí se pod hlavičku appky, aby při scrolování dlouhé knihovny neutekla -
 * jinak by se z výběru nedalo ven bez scrolování na začátek.
 */
export function SelectionHeader({
  count,
  allSelected,
  onSelectAll,
  onEnd,
}: {
  count: number;
  allSelected: boolean;
  onSelectAll: () => void;
  onEnd: () => void;
}) {
  return (
    <div className="animate-in-up sticky top-16 z-30 -mx-4 mb-4 flex items-center gap-2 border-b border-white/[0.08] bg-background/95 px-4 py-2.5 backdrop-blur">
      <button
        type="button"
        onClick={onEnd}
        aria-label="Zrušit výběr"
        className="-ml-2 rounded-lg p-2 text-muted-foreground transition-colors hover:text-foreground"
      >
        <X className="size-5" />
      </button>
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{countLabel(count)}</span>
      <button
        type="button"
        onClick={onSelectAll}
        className={cn(
          "flex h-9 items-center gap-1.5 rounded-full border px-3 text-xs transition-colors hover:bg-accent",
          allSelected && "border-brand/40 text-brand",
        )}
      >
        <CheckCheck className="size-3.5" /> Vše
      </button>
    </div>
  );
}

export interface SelectionAction {
  key: string;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  tone?: "destructive";
  /** Akce právě běží (mazání čeká na systémové okno). */
  busy?: boolean;
}

/**
 * Akce s výběrem, ukotvené dole přes lištu přehrávače i přepínač sekcí.
 *
 * Přes portál do `body`: sekce se vysouvají animací přes `transform` a ten
 * by `fixed` připíchl k sekci místo k obrazovce.
 */
export function SelectionActions({ count, actions }: { count: number; actions: SelectionAction[] }) {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return createPortal(
    <div className="mw-safe-x mw-safe-bottom animate-in-up fixed inset-x-0 bottom-0 z-50 border-t border-white/[0.09] bg-background">
      <div className="mx-auto flex w-full max-w-4xl items-stretch justify-around gap-1 px-2 py-2">
        {actions.map((action) => (
          <button
            key={action.key}
            type="button"
            onClick={action.onClick}
            disabled={!count || action.busy}
            className={cn(
              "flex min-w-0 flex-1 flex-col items-center gap-1 rounded-xl px-1 py-2 text-[11px] font-medium transition-colors hover:bg-white/[0.05] active:bg-white/[0.08] disabled:opacity-40",
              action.tone === "destructive" ? "text-destructive" : "text-foreground",
            )}
          >
            {action.busy ? <Loader2 className="size-5 animate-spin" /> : <action.icon className="size-5" />}
            <span className="w-full truncate text-center">{action.label}</span>
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
}

/**
 * Značka „vybráno" přes náhled - stejná jako u skladeb, ať výběr vypadá
 * všude stejně.
 */
export function SelectedMark({ selected, className }: { selected: boolean; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute inset-0 flex items-center justify-center rounded-[inherit] transition-colors",
        selected ? "bg-brand/60 text-black" : "bg-black/35 text-white/60",
        className,
      )}
    >
      <span
        className={cn(
          "flex size-7 items-center justify-center rounded-full border-2",
          selected ? "border-black bg-black/15" : "border-white/70",
        )}
      >
        {selected ? <Check className="size-4" strokeWidth={3} /> : null}
      </span>
    </span>
  );
}
