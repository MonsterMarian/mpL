"use client";

import * as React from "react";
import { CheckSquare, Heart, HeartOff, ListEnd, ListPlus, Loader2, Plus, Trash2 } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatTotal, trackCountLabel, type Track } from "@/lib/library";
import type { Playlist } from "@/lib/playlists";

/**
 * Co všechno se dá se skladbou udělat.
 *
 * Jeden panel se dvěma stavy, ne dvě okna nad sebou: výběr playlistu se
 * odehraje na stejném místě, takže se nikam nemusí proklikávat zpátky přes
 * navrstvené dialogy.
 *
 * Mazání se tu znovu neptá. Soubor z telefonu potvrzuje Android vlastním
 * oknem a odebrání z knihovny jde vrátit tlačítkem v hlášce - druhá otázka
 * „opravdu?" by byla jen klepnutí navíc.
 *
 * Bere jednu skladbu i celý výběr - z pohledu nabídky je to totéž, jen se jinak
 * jmenuje a jinak počítá.
 */
export type MenuView = "menu" | "playlists";

export interface TrackMenuProps {
  /** Skladby, kterých se nabídka týká. Prázdné pole = zavřeno. */
  tracks: Track[];
  liked: boolean;
  playlists: Playlist[];
  /** Aspoň jedna skladba je soubor v telefonu, takže jde doopravdy smazat. */
  fromDevice: boolean;
  deleting: boolean;
  /** Nabídnout „vybrat víc" - u hromadné akce už to nedává smysl. */
  canSelect: boolean;
  /** Čím panel začne - z lišty výběru se jde rovnou na playlisty. */
  initialView?: MenuView;
  onClose: () => void;
  onPlayNext: () => void;
  onQueue: () => void;
  onLike: () => void;
  onSelect: () => void;
  onAddToPlaylist: (playlistId: string) => void;
  onCreatePlaylist: (name: string) => void;
  onDelete: () => void;
}

export function TrackMenu({
  tracks,
  liked,
  playlists,
  fromDevice,
  deleting,
  canSelect,
  initialView = "menu",
  onClose,
  onPlayNext,
  onQueue,
  onLike,
  onSelect,
  onAddToPlaylist,
  onCreatePlaylist,
  onDelete,
}: TrackMenuProps) {
  const [view, setView] = React.useState<MenuView>("menu");
  const [newName, setNewName] = React.useState("");
  const open = tracks.length > 0;
  /** Poslední obsah zůstane vykreslený, dokud panel dojíždí dolů. */
  const shown = React.useRef<Track[]>(tracks);
  if (open) shown.current = tracks;
  const items = open ? tracks : shown.current;

  React.useEffect(() => {
    if (!open) return;
    setView(initialView);
    setNewName("");
  }, [open, tracks, initialView]);

  if (!items.length) return null;

  const single = items.length === 1 ? items[0] : null;
  const seconds = items.reduce((total, track) => total + track.durationSeconds, 0);
  const title = single ? single.title : trackCountLabel(items.length);
  const description = single
    ? `${single.artist} · ${single.album || "bez alba"} · ${single.duration}`
    : formatTotal(seconds) ?? "";

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title={title}
      description={view === "playlists" ? "Vyber playlist, nebo založ nový." : description}
    >
      {view === "menu" ? (
        <div className="flex flex-col gap-1 pb-1">
          <MenuItem icon={ListEnd} label="Přehrát jako další" onClick={onPlayNext} />
          <MenuItem icon={ListPlus} label="Přidat do fronty" onClick={onQueue} />
          <MenuItem
            icon={liked ? HeartOff : Heart}
            label={liked ? "Odebrat z oblíbených" : "Přidat do oblíbených"}
            onClick={onLike}
          />
          <MenuItem icon={Plus} label="Přidat do playlistu" onClick={() => setView("playlists")} />
          {canSelect ? <MenuItem icon={CheckSquare} label="Vybrat víc skladeb" onClick={onSelect} /> : null}
          <MenuItem
            icon={Trash2}
            label={fromDevice ? "Smazat ze zařízení" : "Odebrat z knihovny"}
            tone="destructive"
            busy={deleting}
            onClick={onDelete}
          />
        </div>
      ) : null}

      {view === "playlists" ? (
        <div className="flex flex-col gap-3 pb-1">
          <div className="flex flex-col gap-1">
            {playlists.length ? (
              playlists.map((playlist) => {
                const inside = items.every((track) => playlist.trackIds.includes(track.id));
                return (
                  <button
                    key={playlist.id}
                    type="button"
                    onClick={() => onAddToPlaylist(playlist.id)}
                    className="flex h-11 items-center justify-between gap-3 rounded-xl px-3 text-left text-sm transition-colors hover:bg-accent"
                  >
                    <span className="truncate">{playlist.name}</span>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {inside ? "už tam je" : playlist.trackIds.length}
                    </span>
                  </button>
                );
              })
            ) : (
              <p className="px-1 pb-1 text-xs text-muted-foreground">Zatím žádný playlist není. Založ první.</p>
            )}
          </div>
          <form
            className="flex gap-2 border-t border-white/[0.07] pt-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (!newName.trim()) return;
              onCreatePlaylist(newName);
            }}
          >
            <Input
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="Nový playlist"
              maxLength={60}
              className="h-11 rounded-xl"
            />
            <button
              type="submit"
              disabled={!newName.trim()}
              className="flex h-11 shrink-0 items-center gap-1.5 rounded-xl bg-brand px-4 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              <Plus className="size-4" /> Založit
            </button>
          </form>
        </div>
      ) : null}
    </Sheet>
  );
}

function MenuItem({
  icon: Icon,
  label,
  onClick,
  tone,
  busy = false,
}: {
  icon: typeof Heart;
  label: string;
  onClick: () => void;
  tone?: "destructive";
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={cn(
        "flex h-12 items-center gap-3 rounded-xl px-3 text-left text-sm transition-colors hover:bg-accent active:bg-accent",
        tone === "destructive" && "text-destructive",
      )}
    >
      {busy ? (
        <Loader2 className="size-4 shrink-0 animate-spin" />
      ) : (
        <Icon className={cn("size-4 shrink-0", !tone && "text-muted-foreground")} />
      )}
      {label}
    </button>
  );
}
