/**
 * Playlisty.
 *
 * Vlastní pořadí skladeb, které nemá v telefonu žádnou oporu - MediaStore zná
 * alba a interprety, ale „ranní jízda do práce" si musí appka pamatovat sama.
 * Drží se jen id skladeb; kdyby soubor ze zařízení zmizel, playlist se o něj
 * jen zkrátí a nikde nic nespadne.
 */

export interface Playlist {
  id: string;
  name: string;
  trackIds: string[];
  createdAt: number;
}

const STORAGE_KEY = "microwins:playlists";

export function loadPlaylists(): Playlist[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isPlaylist);
  } catch {
    // Rozbitý seznam se zahodí - poslech kvůli němu stát nebude.
    return [];
  }
}

export function savePlaylists(playlists: Playlist[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(playlists));
  } catch {
    // soukromý režim - playlisty vydrží do zavření appky
  }
}

function isPlaylist(value: unknown): value is Playlist {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<Playlist>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    Array.isArray(candidate.trackIds)
  );
}

export function createPlaylist(playlists: Playlist[], name: string, trackIds: string[] = []): Playlist[] {
  const playlist: Playlist = {
    id: `pl-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: name.trim() || "Nový playlist",
    trackIds: [...new Set(trackIds)],
    createdAt: Date.now(),
  };
  return [playlist, ...playlists];
}

export function renamePlaylist(playlists: Playlist[], id: string, name: string): Playlist[] {
  return playlists.map((playlist) =>
    playlist.id === id ? { ...playlist, name: name.trim() || playlist.name } : playlist,
  );
}

export function deletePlaylist(playlists: Playlist[], id: string): Playlist[] {
  return playlists.filter((playlist) => playlist.id !== id);
}

/** Skladba se v playlistu neopakuje - podruhé přidaná jen zůstane, kde byla. */
export function addToPlaylist(playlists: Playlist[], id: string, trackIds: string[]): Playlist[] {
  return playlists.map((playlist) =>
    playlist.id === id
      ? { ...playlist, trackIds: [...playlist.trackIds, ...trackIds.filter((t) => !playlist.trackIds.includes(t))] }
      : playlist,
  );
}

export function removeFromPlaylist(playlists: Playlist[], id: string, trackId: string): Playlist[] {
  return playlists.map((playlist) =>
    playlist.id === id
      ? { ...playlist, trackIds: playlist.trackIds.filter((t) => t !== trackId) }
      : playlist,
  );
}

/** Smazaná skladba nemá zůstat v žádném playlistu jako mrtvé id. */
export function forgetTrack(playlists: Playlist[], trackId: string): Playlist[] {
  return playlists.map((playlist) => ({
    ...playlist,
    trackIds: playlist.trackIds.filter((t) => t !== trackId),
  }));
}
