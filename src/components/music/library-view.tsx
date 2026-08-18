"use client";

import * as React from "react";
import {
  ArrowDownUp,
  Check,
  ChevronLeft,
  Disc3,
  Heart,
  Loader2,
  ListMusic,
  Mic2,
  Music2,
  Pencil,
  Play,
  Plus,
  Search,
  Shuffle,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  SORT_OPTIONS,
  formatTotal,
  groupByAlbum,
  groupByArtist,
  trackCountLabel,
  type Collection,
  type LibraryFilter,
  type PlayStats,
  type SortKey,
  type Track,
} from "@/lib/library";
import type { Playlist } from "@/lib/playlists";
import { Cover, TrackRow } from "./track-row";

/**
 * Knihovna hudby.
 *
 * Čtyři pohledy na tatáž data: seznam skladeb, alba, interpreti a vlastní
 * playlisty. Do alba, interpreta i playlistu se vchází - nerozbaluje se to na
 * místě, protože seznam pak přestane být seznamem.
 */
export type LibraryTab = "tracks" | "albums" | "artists" | "playlists";

export interface Browse {
  kind: LibraryTab;
  key: string;
}

const TABS: { id: LibraryTab; label: string; icon: typeof Music2 }[] = [
  { id: "tracks", label: "Skladby", icon: Music2 },
  { id: "albums", label: "Alba", icon: Disc3 },
  { id: "artists", label: "Interpreti", icon: Mic2 },
  { id: "playlists", label: "Playlisty", icon: ListMusic },
];

const FILTERS: { id: LibraryFilter; label: string }[] = [
  { id: "all", label: "Vše" },
  { id: "liked", label: "Oblíbené" },
  { id: "local", label: "Moje soubory" },
];

export interface LibraryViewProps {
  tracks: Track[];
  /** Seznam po hledání, filtru a řazení - zároveň fronta, když se z něj pustí. */
  visibleTracks: Track[];
  liked: ReadonlySet<string>;
  playStats: PlayStats;
  currentTrackId: string | null;
  isPlaying: boolean;
  query: string;
  onQueryChange: (value: string) => void;
  sortKey: SortKey;
  onSortChange: (key: SortKey) => void;
  filter: LibraryFilter;
  onFilterChange: (filter: LibraryFilter) => void;
  tab: LibraryTab;
  onTabChange: (tab: LibraryTab) => void;
  browse: Browse | null;
  onBrowseChange: (browse: Browse | null) => void;
  playlists: Playlist[];
  mediaPermission: "unknown" | "granted" | "denied" | "unavailable";
  isLoadingMedia: boolean;
  onRequestMediaAccess: () => void;
  onUpload: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onPressTrack: (trackId: string, queueIds: string[]) => void;
  onToggleTrack: () => void;
  onMenu: (track: Track) => void;
  onPlayCollection: (trackIds: string[], shuffle: boolean) => void;
  onCreatePlaylist: (name: string) => void;
  onRenamePlaylist: (id: string, name: string) => void;
  onDeletePlaylist: (id: string) => void;
  onRemoveFromPlaylist: (playlistId: string, trackId: string) => void;
}

export function LibraryView(props: LibraryViewProps) {
  const {
    tracks,
    visibleTracks,
    liked,
    playStats,
    currentTrackId,
    isPlaying,
    query,
    onQueryChange,
    sortKey,
    onSortChange,
    filter,
    onFilterChange,
    tab,
    onTabChange,
    browse,
    onBrowseChange,
    playlists,
    mediaPermission,
    isLoadingMedia,
    onRequestMediaAccess,
    onUpload,
    onPressTrack,
    onToggleTrack,
    onMenu,
    onPlayCollection,
    onCreatePlaylist,
  } = props;

  const albums = React.useMemo(() => groupByAlbum(tracks), [tracks]);
  const artists = React.useMemo(() => groupByArtist(tracks), [tracks]);
  const librarySeconds = tracks.reduce((total, track) => total + track.durationSeconds, 0);

  const row = (track: Track, queueIds: string[], extra?: React.ReactNode) => (
    <TrackRow
      key={track.id}
      track={track}
      active={track.id === currentTrackId}
      playing={isPlaying}
      liked={liked.has(track.id)}
      plays={playStats[track.id]?.count ?? 0}
      onPress={() => onPressTrack(track.id, queueIds)}
      onToggle={onToggleTrack}
      onMenu={() => onMenu(track)}
      extra={extra}
    />
  );

  if (browse) {
    return (
      <CollectionDetail
        {...props}
        albums={albums}
        artists={artists}
        browse={browse}
        renderRow={row}
        onBack={() => onBrowseChange(null)}
      />
    );
  }

  return (
    <section className="animate-in-up">
      <div className="mb-5">
        <h1 className="text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">Knihovna</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {trackCountLabel(tracks.length)}
          {formatTotal(librarySeconds) ? ` · ${formatTotal(librarySeconds)}` : ""}
        </p>
      </div>

      <div className="scroll-quiet -mx-4 mb-4 flex gap-1 overflow-x-auto px-4">
        {TABS.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onTabChange(item.id)}
              className={cn(
                "flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-xs font-medium transition-colors",
                tab === item.id ? "bg-brand text-black" : "bg-white/[0.05] text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-3.5" />
              {item.label}
            </button>
          );
        })}
      </div>

      {tab === "tracks" ? (
        <>
          <div className="mb-3 flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => onQueryChange(event.target.value)}
                placeholder="Hledat"
                className="h-9 rounded-full border-white/10 bg-white/[0.04] pl-9 text-xs"
              />
            </div>
            <SortMenu value={sortKey} onChange={onSortChange} />
          </div>

          <div className="mb-4 flex gap-1 rounded-full bg-white/[0.04] p-1">
            {FILTERS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onFilterChange(item.id)}
                className={cn(
                  "flex-1 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                  filter === item.id ? "bg-white/10 text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {item.label}
              </button>
            ))}
          </div>

          {visibleTracks.length ? (
            <div className="-mx-2">
              {visibleTracks.map((track) => row(track, visibleTracks.map((t) => t.id)))}
            </div>
          ) : (
            <EmptyLibrary
              hasTracks={tracks.length > 0}
              mediaPermission={mediaPermission}
              isLoadingMedia={isLoadingMedia}
              onRequestMediaAccess={onRequestMediaAccess}
              onUpload={onUpload}
            />
          )}
        </>
      ) : null}

      {tab === "albums" ? (
        <CollectionGrid
          items={albums}
          empty="Alba se objeví, jakmile bude v knihovně hudba."
          onOpen={(key) => onBrowseChange({ kind: "albums", key })}
        />
      ) : null}

      {tab === "artists" ? (
        <CollectionList
          items={artists}
          empty="Interpreti se objeví, jakmile bude v knihovně hudba."
          onOpen={(key) => onBrowseChange({ kind: "artists", key })}
        />
      ) : null}

      {tab === "playlists" ? (
        <Playlists
          playlists={playlists}
          tracks={tracks}
          onOpen={(id) => onBrowseChange({ kind: "playlists", key: id })}
          onCreate={onCreatePlaylist}
          onPlay={(trackIds) => onPlayCollection(trackIds, false)}
        />
      ) : null}
    </section>
  );
}

/** Řazení visí u tlačítka, ne v dialogu - přepíná se často a okno by bylo moc. */
function SortMenu({ value, onChange }: { value: SortKey; onChange: (key: SortKey) => void }) {
  const [open, setOpen] = React.useState(false);
  const holder = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!holder.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const active = SORT_OPTIONS.find((option) => option.key === value) ?? SORT_OPTIONS[0];

  return (
    <div ref={holder} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Řazení: ${active.label}`}
        title={`Řazení: ${active.label}`}
        className="flex h-9 items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowDownUp className="size-3.5 shrink-0" />
        <span className="hidden whitespace-nowrap sm:inline">{active.label}</span>
      </button>
      {open ? (
        <div role="listbox" className="animate-in-up absolute right-0 z-50 mt-2 w-52 overflow-hidden rounded-xl border bg-popover p-1 shadow-xl">
          {SORT_OPTIONS.map((option) => (
            <button
              key={option.key}
              type="button"
              role="option"
              aria-selected={option.key === value}
              onClick={() => {
                onChange(option.key);
                setOpen(false);
              }}
              className={cn(
                "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-white/[0.06]",
                option.key === value ? "text-brand" : "text-muted-foreground",
              )}
            >
              <Check className={cn("size-3.5 shrink-0", option.key === value ? "opacity-100" : "opacity-0")} />
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function CollectionGrid({
  items,
  empty,
  onOpen,
}: {
  items: Collection[];
  empty: string;
  onOpen: (key: string) => void;
}) {
  if (!items.length) return <EmptyNote text={empty} />;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {items.map((item) => (
        <button key={item.key} type="button" onClick={() => onOpen(item.key)} className="group text-left">
          <Cover artwork={item.artwork} className="aspect-square w-full rounded-2xl transition-transform group-hover:scale-[1.02]" />
          <span className="mt-2 block truncate text-sm font-medium">{item.title}</span>
          <span className="block truncate text-xs text-muted-foreground">{item.subtitle}</span>
        </button>
      ))}
    </div>
  );
}

function CollectionList({
  items,
  empty,
  onOpen,
}: {
  items: Collection[];
  empty: string;
  onOpen: (key: string) => void;
}) {
  if (!items.length) return <EmptyNote text={empty} />;
  return (
    <div className="-mx-2">
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          onClick={() => onOpen(item.key)}
          className="flex w-full min-w-0 items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-white/[0.04]"
        >
          <Cover artwork={item.artwork} className="size-12 rounded-full" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{item.title}</span>
            <span className="block truncate text-xs text-muted-foreground">{item.subtitle}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

function Playlists({
  playlists,
  tracks,
  onOpen,
  onCreate,
  onPlay,
}: {
  playlists: Playlist[];
  tracks: Track[];
  onOpen: (id: string) => void;
  onCreate: (name: string) => void;
  onPlay: (trackIds: string[]) => void;
}) {
  const [name, setName] = React.useState("");

  return (
    <div className="flex flex-col gap-4">
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim()) return;
          onCreate(name);
          setName("");
        }}
      >
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Název nového playlistu"
          maxLength={60}
          className="h-10 rounded-xl border-white/10 bg-white/[0.04] text-sm"
        />
        <button
          type="submit"
          disabled={!name.trim()}
          className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-brand px-4 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          <Plus className="size-4" /> Založit
        </button>
      </form>

      {playlists.length ? (
        <div className="-mx-2">
          {playlists.map((playlist) => {
            const known = playlist.trackIds.filter((id) => tracks.some((track) => track.id === id));
            const artwork = tracks.find((track) => known.includes(track.id) && track.artwork)?.artwork ?? null;
            return (
              <div key={playlist.id} className="group flex min-w-0 items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-white/[0.04]">
                <button type="button" onClick={() => onOpen(playlist.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                  <Cover artwork={artwork} className="size-12 rounded-xl" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{playlist.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{trackCountLabel(known.length)}</span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => onPlay(known)}
                  disabled={!known.length}
                  aria-label={`Přehrát ${playlist.name}`}
                  className="shrink-0 rounded-full p-2 text-muted-foreground transition-colors hover:text-brand disabled:opacity-30"
                >
                  <Play className="size-4 fill-current" />
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyNote text="Playlist je vlastní pořadí skladeb - třeba na běhání nebo na usínání." />
      )}
    </div>
  );
}

/** Album, interpret nebo playlist zevnitř. Cesta ven je nahoře, ne systémovým gestem. */
function CollectionDetail({
  albums,
  artists,
  browse,
  tracks,
  playlists,
  renderRow,
  onBack,
  onPlayCollection,
  onRenamePlaylist,
  onDeletePlaylist,
  onRemoveFromPlaylist,
}: LibraryViewProps & {
  albums: Collection[];
  artists: Collection[];
  browse: Browse;
  renderRow: (track: Track, queueIds: string[], extra?: React.ReactNode) => React.ReactNode;
  onBack: () => void;
}) {
  const playlist = browse.kind === "playlists" ? playlists.find((item) => item.id === browse.key) ?? null : null;
  const collection =
    browse.kind === "albums"
      ? albums.find((item) => item.key === browse.key) ?? null
      : browse.kind === "artists"
        ? artists.find((item) => item.key === browse.key) ?? null
        : null;

  const byId = React.useMemo(() => new Map(tracks.map((track) => [track.id, track])), [tracks]);
  const items: Track[] = playlist
    ? playlist.trackIds.map((id) => byId.get(id)).filter((track): track is Track => Boolean(track))
    : (collection?.trackIds ?? []).map((id) => byId.get(id)).filter((track): track is Track => Boolean(track));

  const [renaming, setRenaming] = React.useState(false);
  const [name, setName] = React.useState(playlist?.name ?? "");

  const title = playlist?.name ?? collection?.title ?? "Nenalezeno";
  const subtitle = playlist ? trackCountLabel(items.length) : collection?.subtitle ?? "";
  const artwork = playlist ? items.find((track) => track.artwork)?.artwork ?? null : collection?.artwork ?? null;
  const queueIds = items.map((track) => track.id);

  return (
    <section className="animate-in-up">
      <button
        type="button"
        onClick={onBack}
        className="-ml-2 mb-4 flex items-center gap-1 rounded-lg px-2 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronLeft className="size-4" /> Zpět
      </button>

      <div className="flex items-end gap-4">
        <Cover artwork={artwork} className={cn("size-28 shrink-0 shadow-xl shadow-black/40", browse.kind === "artists" ? "rounded-full" : "rounded-2xl")} />
        <div className="min-w-0 flex-1">
          {renaming && playlist ? (
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                onRenamePlaylist(playlist.id, name);
                setRenaming(false);
              }}
            >
              <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={60} className="h-9 text-sm" />
              <button type="submit" className="h-9 shrink-0 rounded-lg bg-brand px-3 text-xs font-semibold text-black">
                Uložit
              </button>
            </form>
          ) : (
            <h1 className="truncate text-2xl font-semibold tracking-[-0.03em]">{title}</h1>
          )}
          <p className="mt-1 truncate text-sm text-muted-foreground">{subtitle}</p>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onPlayCollection(queueIds, false)}
          disabled={!items.length}
          className="flex h-11 items-center gap-2 rounded-full bg-brand px-5 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          <Play className="size-4 fill-current" /> Přehrát
        </button>
        <button
          type="button"
          onClick={() => onPlayCollection(queueIds, true)}
          disabled={!items.length}
          className="flex h-11 items-center gap-2 rounded-full border px-5 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-40"
        >
          <Shuffle className="size-4" /> Náhodně
        </button>
        {playlist ? (
          <>
            <button
              type="button"
              onClick={() => {
                setName(playlist.name);
                setRenaming((value) => !value);
              }}
              aria-label="Přejmenovat playlist"
              className="flex size-11 items-center justify-center rounded-full border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <Pencil className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => {
                onDeletePlaylist(playlist.id);
                onBack();
              }}
              aria-label="Smazat playlist"
              className="flex size-11 items-center justify-center rounded-full border text-destructive transition-colors hover:bg-accent"
            >
              <Trash2 className="size-4" />
            </button>
          </>
        ) : null}
      </div>

      <div className="-mx-2 mt-5">
        {items.length ? (
          items.map((track) =>
            renderRow(
              track,
              queueIds,
              playlist ? (
                <button
                  type="button"
                  onClick={() => onRemoveFromPlaylist(playlist.id, track.id)}
                  aria-label={`Odebrat ${track.title} z playlistu`}
                  className="shrink-0 rounded-lg p-2 text-muted-foreground transition-colors hover:text-foreground"
                >
                  <X className="size-4" />
                </button>
              ) : undefined,
            ),
          )
        ) : (
          <div className="px-2">
            <EmptyNote text={playlist ? "Playlist je prázdný. Skladby se přidávají z nabídky u skladby." : "Tady nic není."} />
          </div>
        )}
      </div>
    </section>
  );
}

function EmptyNote({ text }: { text: string }) {
  return (
    <p className="rounded-2xl border border-dashed border-white/10 px-6 py-10 text-center text-sm text-muted-foreground">
      {text}
    </p>
  );
}

function EmptyLibrary({
  hasTracks,
  mediaPermission,
  isLoadingMedia,
  onRequestMediaAccess,
  onUpload,
}: {
  hasTracks: boolean;
  mediaPermission: "unknown" | "granted" | "denied" | "unavailable";
  isLoadingMedia: boolean;
  onRequestMediaAccess: () => void;
  onUpload: (event: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 px-6 text-center">
      <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-white/[0.05] text-muted-foreground">
        {/* eslint-disable-next-line @next/next/no-img-element -- statická značka z public/ */}
        {hasTracks ? <Heart className="size-5" /> : <img src="/logo-brand.png" alt="" className="size-8" />}
      </div>
      <p className="font-medium">
        {hasTracks
          ? "Tady je zatím ticho."
          : mediaPermission === "denied"
            ? "Přístup k hudbě je vypnutý"
            : "Zatím tu nejsou žádné skladby"}
      </p>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        {hasTracks
          ? "Zkus změnit filtr nebo hledaný text."
          : mediaPermission === "denied"
            ? "Android ho zamítl. Otevři nastavení aplikace a povol Hudbu a audio."
            : mediaPermission === "unavailable"
              ? "V prohlížeči hudbu v telefonu nevidím - vyber soubory ručně."
              : "Přehrávač načte hudbu z telefonu, včetně složky Stažené."}
      </p>
      {/*
        Prázdno je jediné místo, odkud se dá hudba přidat - tlačítka nad
        seznamem zmizela, protože v plné knihovně jen zabírala řádek. Výběr
        souboru zůstává i tam, kde knihovna něco má: prázdný filtr „Moje
        soubory" je přesně chvíle, kdy si někdo chce soubor přidat ručně.
      */}
      <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
        {!hasTracks && mediaPermission !== "unavailable" ? (
          <button
            type="button"
            onClick={onRequestMediaAccess}
            disabled={isLoadingMedia}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-brand px-3 text-xs font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {isLoadingMedia ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {mediaPermission === "denied" ? "Otevřít nastavení" : "Povolit přístup"}
          </button>
        ) : null}
        <label className="flex h-9 cursor-pointer items-center gap-2 rounded-lg border px-3 text-xs font-medium hover:bg-accent">
          <Upload className="size-3.5" /> Vybrat soubory
          <input type="file" accept="audio/*" multiple onChange={onUpload} className="hidden" />
        </label>
      </div>
    </div>
  );
}
