"use client";

import * as React from "react";
import {
  ChevronDown,
  Heart,
  ListMusic,
  MoreVertical,
  Pause,
  Play,
  Repeat,
  Repeat1,
  RotateCcw,
  RotateCw,
  Shuffle,
  SkipBack,
  SkipForward,
  Timer,
  TimerReset,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatTime, type RepeatMode, type Track } from "@/lib/library";
import { Cover } from "./track-row";

/**
 * Jedna skladba přes celou obrazovku.
 *
 * Sem se člověk dostane klepnutím na to, co zrovna hraje - ať už na řádek
 * v seznamu, nebo na lištu dole. Je to jediné místo, kde je obal velký,
 * a jediné, kde jsou pohromadě všechny ovladače: v liště dole se schválně
 * mačká jen přehrát a další.
 */
export interface NowPlayingProps {
  open: boolean;
  track: Track;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  liked: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  /** Co ve frontě teprve čeká - historie se schválně nezobrazuje. */
  upcoming: Track[];
  sleepActive: boolean;
  sleepLabel: string | null;
  onClose: () => void;
  onToggle: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onSeek: (seconds: number) => void;
  onSkip: (seconds: number) => void;
  onLike: () => void;
  onShuffle: () => void;
  onRepeat: () => void;
  onMenu: () => void;
  onSleep: () => void;
  onPlayFromQueue: (trackId: string) => void;
  onRemoveFromQueue: (trackId: string) => void;
}

const REPEAT_LABEL: Record<RepeatMode, string> = {
  off: "Opakování vypnuté",
  all: "Opakovat frontu",
  one: "Opakovat skladbu",
};

export function NowPlaying({
  open,
  track,
  isPlaying,
  currentTime,
  duration,
  liked,
  shuffle,
  repeat,
  upcoming,
  sleepActive,
  sleepLabel,
  onClose,
  onToggle,
  onNext,
  onPrevious,
  onSeek,
  onSkip,
  onLike,
  onShuffle,
  onRepeat,
  onMenu,
  onSleep,
  onPlayFromQueue,
  onRemoveFromQueue,
}: NowPlayingProps) {
  const [queueOpen, setQueueOpen] = React.useState(false);

  // Zavřená obrazovka nemá držet otevřenou frontu - po návratu se čeká obal.
  React.useEffect(() => {
    if (!open) setQueueOpen(false);
  }, [open]);

  if (!open) return null;

  const progress = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;

  return (
    <div className="animate-in-up fixed inset-0 z-50 flex flex-col overflow-y-auto bg-background text-foreground">
      <div className="mw-safe-x mx-auto flex w-full max-w-lg flex-1 flex-col px-5 pb-[calc(1.5rem+var(--mw-safe-bottom))] pt-[calc(0.75rem+var(--mw-safe-top))]">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            aria-label="Zpět na knihovnu"
            className="-ml-2 rounded-full p-2 text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronDown className="size-6" />
          </button>
          <span className="truncate px-2 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
            {track.album || "Přehrává se"}
          </span>
          <button
            type="button"
            onClick={onMenu}
            aria-label="Možnosti skladby"
            className="-mr-2 rounded-full p-2 text-muted-foreground transition-colors hover:text-foreground"
          >
            <MoreVertical className="size-5" />
          </button>
        </div>

        {queueOpen ? (
          <div className="animate-in-up mt-6 flex-1">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Na řadě</h2>
              <span className="text-xs text-muted-foreground">{upcoming.length}</span>
            </div>
            {upcoming.length ? (
              <div className="-mx-2">
                {upcoming.map((item) => (
                  <div key={item.id} className="group flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-white/[0.04]">
                    <button type="button" onClick={() => onPlayFromQueue(item.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                      <Cover artwork={item.artwork} className="size-10 rounded-lg" />
                      <span className="min-w-0">
                        <span className="block truncate text-sm">{item.title}</span>
                        <span className="block truncate text-xs text-muted-foreground">{item.artist}</span>
                      </span>
                    </button>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{item.duration}</span>
                    <button
                      type="button"
                      onClick={() => onRemoveFromQueue(item.id)}
                      aria-label={`Vyhodit ${item.title} z fronty`}
                      className="shrink-0 rounded-lg p-1.5 text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="rounded-2xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-muted-foreground">
                Fronta je prázdná. Až tahle skladba dohraje, přehrávač ztichne.
              </p>
            )}
          </div>
        ) : (
          <div className="mt-6 flex flex-1 flex-col justify-center">
            <Cover artwork={track.artwork} className="aspect-square w-full rounded-3xl shadow-2xl shadow-black/50" />
          </div>
        )}

        <div className="mt-7 flex items-end gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-2xl font-semibold tracking-[-0.03em]">{track.title}</h1>
            <p className="mt-1 truncate text-sm text-muted-foreground">{track.artist}</p>
          </div>
          <button
            type="button"
            onClick={onLike}
            aria-label={liked ? "Odebrat z oblíbených" : "Přidat do oblíbených"}
            className={cn(
              "shrink-0 rounded-full p-2 transition-colors",
              liked ? "text-brand" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Heart className={cn("size-6", liked && "fill-current")} />
          </button>
        </div>

        <div className="mt-5">
          <input
            type="range"
            min="0"
            max={duration || 0}
            step="0.1"
            value={Math.min(currentTime, duration || 0)}
            onChange={(event) => onSeek(Number(event.target.value))}
            className="player-range"
            aria-label="Pozice ve skladbě"
            style={{ "--range-progress": `${progress}%` } as React.CSSProperties}
          />
          <div className="mt-1 flex justify-between text-[11px] tabular-nums text-muted-foreground">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>

        <div className="mt-5 flex items-center justify-between">
          <button
            type="button"
            onClick={onShuffle}
            aria-label="Náhodné pořadí"
            aria-pressed={shuffle}
            className={cn("rounded-full p-2 transition-colors", shuffle ? "text-brand" : "text-muted-foreground hover:text-foreground")}
          >
            <Shuffle className="size-5" />
          </button>
          <button type="button" onClick={onPrevious} aria-label="Předchozí" className="rounded-full p-2 transition-colors hover:text-brand">
            <SkipBack className="size-7 fill-current" />
          </button>
          <button
            type="button"
            onClick={onToggle}
            aria-label={isPlaying ? "Pozastavit" : "Přehrát"}
            className="flex size-16 items-center justify-center rounded-full bg-brand text-black transition-transform hover:scale-105"
          >
            {isPlaying ? <Pause className="size-7 fill-current" /> : <Play className="ml-1 size-7 fill-current" />}
          </button>
          <button type="button" onClick={onNext} aria-label="Další" className="rounded-full p-2 transition-colors hover:text-brand">
            <SkipForward className="size-7 fill-current" />
          </button>
          <button
            type="button"
            onClick={onRepeat}
            aria-label={REPEAT_LABEL[repeat]}
            title={REPEAT_LABEL[repeat]}
            className={cn("rounded-full p-2 transition-colors", repeat !== "off" ? "text-brand" : "text-muted-foreground hover:text-foreground")}
          >
            {repeat === "one" ? <Repeat1 className="size-5" /> : <Repeat className="size-5" />}
          </button>
        </div>

        <div className="mt-6 flex items-center justify-between border-t border-white/[0.07] pt-3">
          <button
            type="button"
            onClick={() => onSkip(-10)}
            aria-label="O deset vteřin zpět"
            className="flex items-center gap-1 rounded-lg p-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <RotateCcw className="size-4" /> 10 s
          </button>
          <button
            type="button"
            onClick={onSleep}
            aria-label="Časovač spánku"
            className={cn(
              "flex items-center gap-1.5 rounded-lg p-2 text-xs transition-colors",
              sleepActive ? "text-brand" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {sleepActive ? <TimerReset className="size-4" /> : <Timer className="size-4" />}
            {sleepLabel ?? "Časovač"}
          </button>
          <button
            type="button"
            onClick={() => setQueueOpen((value) => !value)}
            aria-pressed={queueOpen}
            className={cn(
              "flex items-center gap-1.5 rounded-lg p-2 text-xs transition-colors",
              queueOpen ? "text-brand" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <ListMusic className="size-4" /> Fronta
            {upcoming.length ? <span className="tabular-nums opacity-70">{upcoming.length}</span> : null}
          </button>
          <button
            type="button"
            onClick={() => onSkip(10)}
            aria-label="O deset vteřin vpřed"
            className="flex items-center gap-1 rounded-lg p-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            10 s <RotateCw className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
