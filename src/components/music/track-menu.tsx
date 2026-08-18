"use client";

import * as React from "react";
import { Heart, HeartOff, ListEnd, ListPlus, Loader2, Plus, Trash2 } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { Track } from "@/lib/library";
import type { Playlist } from "@/lib/playlists";
import { Cover } from "./track-row";

/**
 * Co všechno se dá se skladbou udělat.
 *
 * Jedno okno se třemi stavy, ne tři okna nad sebou: výběr playlistu i otázka
 * na mazání se odehrají na stejném místě, takže se nikam nemusí proklikávat
 * zpátky přes navrstvené dialogy.
 */
type MenuView = "menu" | "playlists" | "delete";

export interface TrackMenuProps {
  /** Otevřeno pro tuhle skladbu; `null` = zavřeno. */
  track: Track | null;
  liked: boolean;
  playlists: Playlist[];
  /** Soubor v telefonu jde smazat doopravdy; ručně přidaný jen odebrat z knihovny. */
  fromDevice: boolean;
  deleting: boolean;
  onClose: () => void;
  onPlayNext: () => void;
  onQueue: () => void;
  onLike: () => void;
  onAddToPlaylist: (playlistId: string) => void;
  onCreatePlaylist: (name: string) => void;
  onDelete: () => void;
}

export function TrackMenu({
  track,
  liked,
  playlists,
  fromDevice,
  deleting,
  onClose,
  onPlayNext,
  onQueue,
  onLike,
  onAddToPlaylist,
  onCreatePlaylist,
  onDelete,
}: TrackMenuProps) {
  const [view, setView] = React.useState<MenuView>("menu");
  const [newName, setNewName] = React.useState("");

  React.useEffect(() => {
    if (!track) return;
    setView("menu");
    setNewName("");
  }, [track]);

  if (!track) return null;

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={track.title}
      description={
        view === "delete"
          ? fromDevice
            ? "Soubor zmizí z telefonu, ne jen z knihovny. Vrátit to nejde."
            : "Skladba zmizí z knihovny. Soubor v telefonu zůstane."
          : `${track.artist} · ${track.album || "bez alba"} · ${track.duration}`
      }
    >
      {view === "menu" ? (
        <div className="flex flex-col gap-1">
          <MenuItem icon={ListEnd} label="Přehrát jako další" onClick={onPlayNext} />
          <MenuItem icon={ListPlus} label="Přidat do fronty" onClick={onQueue} />
          <MenuItem
            icon={liked ? HeartOff : Heart}
            label={liked ? "Odebrat z oblíbených" : "Přidat do oblíbených"}
            onClick={onLike}
          />
          <MenuItem icon={Plus} label="Přidat do playlistu" onClick={() => setView("playlists")} />
          <MenuItem
            icon={Trash2}
            label={fromDevice ? "Smazat ze zařízení" : "Odebrat z knihovny"}
            tone="destructive"
            onClick={() => setView("delete")}
          />
        </div>
      ) : null}

      {view === "playlists" ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            {playlists.length ? (
              playlists.map((playlist) => (
                <button
                  key={playlist.id}
                  type="button"
                  onClick={() => onAddToPlaylist(playlist.id)}
                  className="flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors hover:bg-accent"
                >
                  <span className="truncate">{playlist.name}</span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {playlist.trackIds.includes(track.id) ? "už tam je" : playlist.trackIds.length}
                  </span>
                </button>
              ))
            ) : (
              <p className="px-1 text-xs text-muted-foreground">Zatím žádný playlist není. Založ první.</p>
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
              className="h-10"
            />
            <button
              type="submit"
              disabled={!newName.trim()}
              className="flex h-10 shrink-0 items-center gap-1.5 rounded-lg bg-brand px-4 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              <Plus className="size-4" /> Založit
            </button>
          </form>
        </div>
      ) : null}

      {view === "delete" ? (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3 rounded-xl border px-3 py-2.5">
            <Cover artwork={track.artwork} className="size-11 rounded-lg" />
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{track.title}</span>
              <span className="block truncate text-xs text-muted-foreground">{track.artist}</span>
            </span>
          </div>
          {fromDevice ? (
            <p className="text-xs text-muted-foreground">Android se ještě jednou zeptá vlastním oknem.</p>
          ) : null}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setView("menu")}
              className="flex h-10 items-center rounded-lg border px-4 text-sm transition-colors hover:bg-accent"
            >
              Zpět
            </button>
            <button
              type="button"
              onClick={onDelete}
              disabled={deleting}
              className="flex h-10 items-center gap-2 rounded-lg bg-destructive px-4 text-sm font-semibold text-destructive-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {deleting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              {fromDevice ? "Smazat" : "Odebrat"}
            </button>
          </div>
        </div>
      ) : null}
    </Dialog>
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
        "flex h-11 items-center gap-3 rounded-lg px-3 text-left text-sm transition-colors hover:bg-accent",
        tone === "destructive" && "text-destructive",
      )}
    >
      <Icon className={cn("size-4 shrink-0", !tone && "text-muted-foreground")} />
      {label}
    </button>
  );
}
