"use client";

import * as React from "react";
import { Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatTime, type RepeatMode, type Track } from "@/lib/library";
import { Cover, Equalizer } from "./track-row";

/**
 * Lišta u spodní hrany.
 *
 * Drží se celé šířky displeje - plovoucí karta s okraji vypadala jako okno nad
 * appkou, ne jako její součást. Ovladač hlasitosti tu není schválně: hlasitost
 * si telefon řídí vlastními tlačítky a ztlumení v appce jen mate.
 *
 * Klepnutí na obal nebo název otevře skladbu přes celou obrazovku, tlačítka
 * zůstávají na svém místě - jinak by se ovládání s otevíráním detailu pralo.
 */
export interface PlayerDockProps {
  track: Track;
  hasTrack: boolean;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  shuffle: boolean;
  repeat: RepeatMode;
  onOpen: () => void;
  onToggle: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onSeek: (seconds: number) => void;
  onShuffle: () => void;
  onRepeat: () => void;
}

export function PlayerDock({
  track,
  hasTrack,
  isPlaying,
  currentTime,
  duration,
  shuffle,
  repeat,
  onOpen,
  onToggle,
  onNext,
  onPrevious,
  onSeek,
  onShuffle,
  onRepeat,
}: PlayerDockProps) {
  const progress = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;

  return (
    <div className="player-dock relative border-t border-white/[0.09]">
      {/* Vlásek postupu nad lištou - jediná zpětná vazba, když se detail nedívá. */}
      <div className="absolute inset-x-0 top-0 h-0.5 overflow-hidden">
        <div className="h-full bg-brand transition-[width]" style={{ width: `${progress}%` }} />
      </div>

      <div className="mx-auto flex w-full max-w-4xl items-center gap-3 px-4 py-2.5">
        <button
          type="button"
          onClick={hasTrack ? onOpen : undefined}
          disabled={!hasTrack}
          className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:cursor-default"
          aria-label={hasTrack ? `Otevřít ${track.title}` : undefined}
        >
          <Cover artwork={track.artwork} className="size-11 rounded-xl" />
          <span className="min-w-0">
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate text-sm font-medium">{track.title}</span>
              {hasTrack ? <Equalizer playing={isPlaying} /> : null}
            </span>
            <span className="block truncate text-xs text-muted-foreground">{track.artist}</span>
          </span>
        </button>

        <div className="hidden flex-1 items-center gap-2 sm:flex">
          <span className="w-9 text-right text-[10px] tabular-nums text-muted-foreground">{formatTime(currentTime)}</span>
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
          <span className="w-9 text-[10px] tabular-nums text-muted-foreground">{formatTime(duration)}</span>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onShuffle}
            aria-label="Náhodné pořadí"
            aria-pressed={shuffle}
            className={cn("hidden p-2 transition-colors sm:block", shuffle ? "text-brand" : "text-muted-foreground hover:text-foreground")}
          >
            <Shuffle className="size-4" />
          </button>
          <button
            type="button"
            onClick={onPrevious}
            aria-label="Předchozí"
            className="hidden p-2 text-muted-foreground transition-colors hover:text-foreground sm:block"
          >
            <SkipBack className="size-4 fill-current" />
          </button>
          <button
            type="button"
            onClick={onToggle}
            aria-label={isPlaying ? "Pozastavit" : "Přehrát"}
            className="flex size-10 items-center justify-center rounded-full bg-foreground text-background transition-transform hover:scale-105"
          >
            {isPlaying ? <Pause className="size-4 fill-current" /> : <Play className="ml-0.5 size-4 fill-current" />}
          </button>
          <button
            type="button"
            onClick={onNext}
            aria-label="Další"
            className="p-2 text-muted-foreground transition-colors hover:text-foreground"
          >
            <SkipForward className="size-5 fill-current" />
          </button>
          <button
            type="button"
            onClick={onRepeat}
            aria-label="Opakování"
            className={cn("hidden p-2 transition-colors sm:block", repeat !== "off" ? "text-brand" : "text-muted-foreground hover:text-foreground")}
          >
            {repeat === "one" ? <Repeat1 className="size-4" /> : <Repeat className="size-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
