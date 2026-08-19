/**
 * Knihovna a fronta - všechno, co jde spočítat bez Reactu.
 *
 * Pravidlo z NOTES: v `lib/` žádný React, v komponentách žádná logika. Díky
 * tomu jde chování fronty (co hraje dál, co dělá náhodné pořadí, kam se
 * zařadí "přehrát jako další") otestovat bez jediného renderu.
 */

export interface Track {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: string;
  durationSeconds: number;
  src: string;
  /**
   * Původní `content://` adresa souboru. WebView si adresu překládá na svoji,
   * ale nativní přehrávač otevírá soubor přímo a potřebuje tu nepřeloženou.
   */
  uri?: string | null;
  /** Obal skladby, když nějaký má. Jinak `null` a nastoupí značka appky. */
  artwork: string | null;
  /**
   * Původní `content://` adresa obalu. WebView si adresu překládá na svoji,
   * ale notifikace a zámek čtou soubor přímo, takže potřebují tu nepřeloženou.
   */
  artworkSource?: string | null;
  /** Kdy skladba přibyla do zařízení - podle toho řadí „Naposledy přidané". */
  addedAt: number;
  source: "device" | "local";
}

/** Kolikrát a kdy naposledy skladba hrála. Drží se na disku, přežije restart. */
export interface PlayStat {
  count: number;
  at: number;
}

export type PlayStats = Record<string, PlayStat>;

export type LibraryFilter = "all" | "liked" | "local";
export type RepeatMode = "off" | "all" | "one";
export type SortKey = "added" | "recent" | "played" | "title" | "titleDesc" | "artist" | "duration";

export const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "recent", label: "Naposledy hrané" },
  { key: "played", label: "Nejposlouchanější" },
  { key: "added", label: "Naposledy přidané" },
  { key: "title", label: "Název A–Z" },
  { key: "titleDesc", label: "Název Z–A" },
  { key: "artist", label: "Interpret A–Z" },
  { key: "duration", label: "Nejdelší" },
];

export function isSortKey(value: unknown): value is SortKey {
  return SORT_OPTIONS.some((option) => option.key === value);
}

export function formatTime(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "0:00";
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

/** Souhrn délky celé knihovny - v hlavičce dává smysl v hodinách, ne v sekundách. */
export function formatTotal(seconds: number): string | null {
  if (seconds <= 0) return null;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  if (!hours) return `${minutes} min`;
  return minutes ? `${hours} h ${minutes} min` : `${hours} h`;
}

export function plural(count: number, one: string, few: string, many: string): string {
  if (count === 1) return one;
  if (count >= 2 && count <= 4) return few;
  return many;
}

export function trackCountLabel(count: number): string {
  return `${count} ${plural(count, "skladba", "skladby", "skladeb")}`;
}

// --- výběr a řazení ---------------------------------------------------------

export function filterTracks(
  tracks: Track[],
  query: string,
  filter: LibraryFilter,
  liked: ReadonlySet<string>,
): Track[] {
  const needle = query.trim().toLowerCase();
  return tracks.filter((track) => {
    const matchesQuery =
      !needle || `${track.title} ${track.artist} ${track.album}`.toLowerCase().includes(needle);
    const matchesFilter =
      filter === "all" || (filter === "liked" ? liked.has(track.id) : track.source === "local");
    return matchesQuery && matchesFilter;
  });
}

const byTitle = (a: Track, b: Track) => a.title.localeCompare(b.title, "cs");

/** Druhé kritérium je vždycky název, ať se seznam při shodě neházel sem tam. */
export function sortTracks(tracks: Track[], key: SortKey, playStats: PlayStats): Track[] {
  return [...tracks].sort((a, b) => {
    switch (key) {
      case "recent":
        return (playStats[b.id]?.at ?? 0) - (playStats[a.id]?.at ?? 0) || byTitle(a, b);
      case "played":
        return (playStats[b.id]?.count ?? 0) - (playStats[a.id]?.count ?? 0) || byTitle(a, b);
      case "added":
        return b.addedAt - a.addedAt || byTitle(a, b);
      case "titleDesc":
        return byTitle(b, a);
      case "artist":
        return a.artist.localeCompare(b.artist, "cs") || byTitle(a, b);
      case "duration":
        return b.durationSeconds - a.durationSeconds || byTitle(a, b);
      default:
        return byTitle(a, b);
    }
  });
}

// --- alba a interpreti ------------------------------------------------------

export interface Collection {
  /** Klíč do adresy uvnitř appky - jméno alba nebo interpreta. */
  key: string;
  title: string;
  subtitle: string;
  trackIds: string[];
  seconds: number;
  /** Obal prvního kusu, který nějaký má - album bez obalu dostane značku appky. */
  artwork: string | null;
}

function collect(
  tracks: Track[],
  keyOf: (track: Track) => string,
  subtitleOf: (group: Track[]) => string,
): Collection[] {
  const groups = new Map<string, Track[]>();
  for (const track of tracks) {
    const key = keyOf(track);
    const group = groups.get(key);
    if (group) group.push(track);
    else groups.set(key, [track]);
  }

  return [...groups.entries()]
    .map(([key, group]) => ({
      key,
      title: key,
      subtitle: subtitleOf(group),
      trackIds: group.map((track) => track.id),
      seconds: group.reduce((total, track) => total + track.durationSeconds, 0),
      artwork: group.find((track) => track.artwork)?.artwork ?? null,
    }))
    .sort((a, b) => a.title.localeCompare(b.title, "cs"));
}

export function groupByAlbum(tracks: Track[]): Collection[] {
  return collect(tracks, (track) => track.album || "Bez alba", (group) => {
    const artists = new Set(group.map((track) => track.artist));
    return artists.size === 1 ? [...artists][0] : "Různí interpreti";
  });
}

export function groupByArtist(tracks: Track[]): Collection[] {
  return collect(tracks, (track) => track.artist || "Neznámý interpret", (group) =>
    trackCountLabel(group.length),
  );
}

// --- fronta -----------------------------------------------------------------

/**
 * Fronta přehrávání.
 *
 * `ids` je pořadí, ve kterém se doopravdy hraje; `base` je to samé pořadí bez
 * zamíchání. Bez `base` by vypnutí náhodného pořadí nemělo kam se vrátit
 * a seznam by zůstal rozházený napořád.
 */
export interface Queue {
  ids: string[];
  base: string[];
}

export const EMPTY_QUEUE: Queue = { ids: [], base: [] };

function shuffled(ids: string[], firstId?: string): string[] {
  const rest = ids.filter((id) => id !== firstId);
  for (let index = rest.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [rest[index], rest[swap]] = [rest[swap], rest[index]];
  }
  return firstId && ids.includes(firstId) ? [firstId, ...rest] : rest;
}

/** Nová fronta z toho, na co uživatel klikl - seznam, album, playlist. */
export function buildQueue(ids: string[], startId: string, shuffle: boolean): Queue {
  const base = [...ids];
  return { base, ids: shuffle ? shuffled(base, startId) : base };
}

/** Přepnutí náhodného pořadí. Rozehraná skladba zůstává první, ať nepřeskočí. */
export function reshuffleQueue(queue: Queue, currentId: string | null, shuffle: boolean): Queue {
  if (!shuffle) return { ...queue, ids: [...queue.base] };
  return { ...queue, ids: shuffled(queue.base, currentId ?? undefined) };
}

/**
 * Co hraje dál. `wrap` odděluje dvě různé věci: doběhnutou skladbu (tam
 * rozhoduje opakování) a stisk tlačítka vpřed (to se na konci vždycky vrátí
 * na začátek - jinak by tlačítko na poslední skladbě nedělalo nic).
 */
export function nextTrackId(queue: Queue, currentId: string | null, wrap: boolean): string | null {
  if (!queue.ids.length) return null;
  const index = currentId ? queue.ids.indexOf(currentId) : -1;
  if (index === -1) return queue.ids[0];
  if (index === queue.ids.length - 1) return wrap ? queue.ids[0] : null;
  return queue.ids[index + 1];
}

export function previousTrackId(queue: Queue, currentId: string | null): string | null {
  if (!queue.ids.length) return null;
  const index = currentId ? queue.ids.indexOf(currentId) : -1;
  if (index <= 0) return queue.ids[queue.ids.length - 1];
  return queue.ids[index - 1];
}

/** „Přehrát jako další" - hned za rozehranou skladbu, ne na konec fronty. */
export function insertNext(queue: Queue, trackIds: string[], currentId: string | null): Queue {
  const clean = (ids: string[]) => ids.filter((id) => !trackIds.includes(id) || id === currentId);
  const ids = clean(queue.ids);
  const at = currentId ? ids.indexOf(currentId) : -1;
  const toAdd = trackIds.filter((id) => id !== currentId);
  ids.splice(at + 1, 0, ...toAdd);
  return { base: ids, ids };
}

export function appendToQueue(queue: Queue, trackIds: string[], currentId: string | null): Queue {
  const ids = queue.ids.filter((id) => !trackIds.includes(id) || id === currentId);
  const toAdd = trackIds.filter((id) => id !== currentId);
  const next = [...ids, ...toAdd];
  return { base: next, ids: next };
}

/** Skladba pryč z fronty - ať už ji uživatel vyhodil, nebo smazal ze zařízení. */
export function dropFromQueue(queue: Queue, trackId: string): Queue {
  return {
    ids: queue.ids.filter((id) => id !== trackId),
    base: queue.base.filter((id) => id !== trackId),
  };
}

/** Co ve frontě teprve čeká. Historie se nezobrazuje - dopředu se dívá líp. */
export function upcomingIds(queue: Queue, currentId: string | null): string[] {
  const index = currentId ? queue.ids.indexOf(currentId) : -1;
  return queue.ids.slice(index + 1);
}
