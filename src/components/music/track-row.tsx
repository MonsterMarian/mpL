"use client";

import * as React from "react";
import { Check, Heart, MoreVertical, Pause, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Track } from "@/lib/library";
import { BRAND_MARK } from "@/lib/brand";

/**
 * Obal skladby. Když ho skladba má, je vidět on. Když ne, nastoupí značka appky.
 *
 * Značka je data URI z `lib/brand.ts`, ne soubor: PNG se v balíku živé
 * aktualizace rozbije a v telefonu z něj zbyla ikona nenačteného obrázku
 * u každé skladby. Žlutá varianta schválně - šedá je na černém pozadí
 * neviditelná a v seznamu po ní zůstávala díra.
 */
export function Cover({ artwork, className }: { artwork: string | null; className?: string }) {
  const [state, setState] = React.useState<"loading" | "ready" | "broken">(artwork ? "loading" : "broken");

  // Obal alba nemusí jít načíst (soubor zmizel, prázdný záznam v MediaStore).
  // Nová adresa dostane novou šanci, jinak by značka zůstala i tam, kde obal je.
  React.useEffect(() => setState(artwork ? "loading" : "broken"), [artwork]);

  return (
    <span className={cn("relative block shrink-0 overflow-hidden bg-white/[0.06]", className)} aria-hidden="true">
      {/*
        Značka se ukáže, teprve když je jisté, že obal nebude. Dokud se načítá,
        drží místo tichá plocha - jinak při otevření appky přes celý seznam
        blikla značka a hned ji přepsaly obaly.
      */}
      {state === "broken" ? (
        // eslint-disable-next-line @next/next/no-img-element -- značka je data URI
        <img src={BRAND_MARK} alt="" className="absolute inset-0 m-auto size-[58%] opacity-75" />
      ) : null}
      {artwork ? (
        // eslint-disable-next-line @next/next/no-img-element -- blob:/content: adresy, optimalizace Next.js tu nemá co dělat
        <img
          src={artwork}
          alt=""
          // Obal alba z MediaStore je plnotučný obrázek, klidně 1500 px. Načíst
          // jich naráz tisíc (seznam skladeb, mřížka alb) položí WebView na
          // paměti - proto se dekóduje jen to, co je zrovna na obrazovce.
          loading="lazy"
          decoding="async"
          onLoad={() => setState("ready")}
          onError={() => setState("broken")}
          className={cn(
            "absolute inset-0 size-full object-cover transition-opacity duration-200",
            state === "ready" ? "opacity-100" : "opacity-0",
          )}
        />
      ) : null}
    </span>
  );
}

/**
 * Značka „tohle zrovna hraje".
 *
 * Pruhy rostou ode dna nahoru - když se škálovaly od středu, ubývaly na obě
 * strany naráz a v seznamu to vypadalo jako chyba vykreslení, ne jako zvuk.
 */
export function Equalizer({ playing }: { playing: boolean }) {
  return (
    <span className={cn("equalizer", playing && "equalizer-playing")} aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

export interface TrackRowProps {
  track: Track;
  /** Tahle skladba je v přehrávači - ať už hraje, nebo stojí. */
  active: boolean;
  playing: boolean;
  liked: boolean;
  plays?: number;
  /** Klik na řádek: cizí skladbu pustí, tu rozehranou otevře na celou obrazovku. */
  onPress: () => void;
  /** Klik na obal rozehrané skladby - pauza a zpátky. */
  onToggle: () => void;
  onMenu: () => void;
  /** Tlačítko navíc před nabídkou - třeba „odebrat z playlistu". */
  extra?: React.ReactNode;
  /** Režim výběru: klepnutí místo přehrávání zaškrtává. */
  selecting?: boolean;
  selected?: boolean;
  /** Podržení prstu - odsud se do výběru vchází. */
  onLongPress?: () => void;
}

export function TrackRow({
  track,
  active,
  playing,
  liked,
  plays = 0,
  onPress,
  onToggle,
  onMenu,
  extra,
  selecting = false,
  selected = false,
  onLongPress,
}: TrackRowProps) {
  // Podržení prstu hlásí prohlížeč jako `contextmenu` - vlastní měření času by
  // se pralo se scrolováním a s dvojklikem.
  const holdToSelect = (event: React.MouseEvent) => {
    if (!onLongPress) return;
    event.preventDefault();
    onLongPress();
  };

  return (
    <div
      onContextMenu={holdToSelect}
      className={cn(
        "group flex min-w-0 items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-white/[0.04]",
        active && !selecting && "bg-white/[0.04]",
        selected && "bg-brand/10",
      )}
    >
      <button
        type="button"
        onClick={selecting ? onPress : active ? onToggle : onPress}
        className="relative shrink-0"
        aria-label={
          selecting
            ? `${selected ? "Odebrat z výběru" : "Vybrat"} ${track.title}`
            : active && playing
              ? `Pozastavit ${track.title}`
              : `Přehrát ${track.title}`
        }
        aria-pressed={selecting ? selected : undefined}
      >
        <Cover artwork={track.artwork} className="size-12 rounded-xl" />
        <span
          className={cn(
            "absolute inset-0 flex items-center justify-center rounded-xl transition-opacity",
            selecting
              ? selected
                ? "bg-brand/85 text-black opacity-100"
                : "bg-black/45 text-white/70 opacity-100"
              : active
                ? "bg-black/50 text-white opacity-100"
                : "bg-black/50 text-white opacity-0 group-hover:opacity-100",
          )}
        >
          {selecting ? (
            <Check className={cn("size-5", !selected && "opacity-40")} />
          ) : active && playing ? (
            <Pause className="size-4 fill-current" />
          ) : (
            <Play className="size-4 fill-current" />
          )}
        </span>
      </button>

      <button type="button" onClick={onPress} className="min-w-0 flex-1 text-left">
        <span className="flex min-w-0 items-center gap-2">
          <span className={cn("truncate text-sm font-medium", active && "text-brand")}>{track.title}</span>
          {active ? <Equalizer playing={playing} /> : null}
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          {liked ? <Heart className="size-3 shrink-0 fill-current text-brand" /> : null}
          <span className="truncate">
            {track.artist}
            {plays > 0 ? <span className="tabular-nums"> · {plays}×</span> : null}
          </span>
        </span>
      </button>

      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{track.duration}</span>
      {/* Ve výběru mizí všechno, co dělá něco jiného než zaškrtnutí. */}
      {selecting ? null : extra}
      {selecting ? null : (
        <button
          type="button"
          onClick={onMenu}
          aria-label={`Možnosti skladby ${track.title}`}
          className="-mr-1 shrink-0 rounded-lg p-2 text-muted-foreground transition-colors hover:text-foreground"
        >
          <MoreVertical className="size-4" />
        </button>
      )}
    </div>
  );
}
