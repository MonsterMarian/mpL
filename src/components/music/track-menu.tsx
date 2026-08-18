"use client";

import * as React from "react";
import { CheckSquare, Heart, HeartOff, ListEnd, ListPlus, Loader2, Plus, Trash2 } from "lucide-react";
import { Sheet } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatTotal, trackCountLabel, type Track } from "@/lib/library";
import type { Playlist } from "@/lib/playlists";
import { Cover } from "./track-row";

/**
 * Co všechno se dá se skladbou udělat.
 *
 * Jeden panel se třemi stavy, ne tři okna nad sebou: výběr playlistu i otázka
 * na mazání se odehrají na stejném místě, takže se nikam nemusí proklikávat
 * zpátky přes navrstvené dialogy.
 *
 * Bere jednu skladbu i celý výběr - z pohledu nabídky je to totéž, jen se jinak
 * jmenuje a jinak počítá.
 */
type MenuView = "menu" | "playlists" | "delete";

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
    setView("menu");
    setNewName("");
  }, [open, tracks]);

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
      title={view === "delete" ? (fromDevice ? "Smazat ze zařízení?" : "Odebrat z knihovny?") : title}
      description={
        view === "delete"
          ? fromDevice
            ? "Soubor zmizí z telefonu, ne jen z knihovny. Vrátit to nejde."
            : "Skladba zmizí z knihovny. Soubor v telefonu zůstane."
          : view === "playlists"
            ? "Vyber playlist, nebo založ nový."
            : description
      }
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
            onClick={() => setView("delete")}
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

      {view === "delete" ? (
        <div className="flex flex-col gap-4 pb-1">
          <div className="flex items-center gap-3 rounded-xl border px-3 py-2.5">
            <Cover artwork={items[0].artwork} className="size-11 rounded-lg" />
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{title}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {single ? single.artist : formatTotal(seconds) ?? ""}
              </span>
            </span>
          </div>
          {fromDevice ? (
            <p className="text-xs text-muted-foreground">Android se ještě jednou zeptá vlastním oknem.</p>
          ) : null}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setView("menu")}
              className="flex h-11 flex-1 items-center justify-center rounded-xl border text-sm transition-colors hover:bg-accent"
            >
              Zpět
            </button>
            <button
              type="button"
              onClick={onDelete}
              disabled={deleting}
              className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-destructive text-sm font-semibold text-destructive-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {deleting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              {fromDevice ? "Smazat" : "Odebrat"}
            </button>
          </div>
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
}: {
  icon: typeof Heart;
  label: string;
  onClick: () => void;
  tone?: "destructive";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-12 items-center gap-3 rounded-xl px-3 text-left text-sm transition-colors hover:bg-accent active:bg-accent",
        tone === "destructive" && "text-destructive",
      )}
    >
      <Icon className={cn("size-4 shrink-0", !tone && "text-muted-foreground")} />
      {label}
    </button>
  );
}
