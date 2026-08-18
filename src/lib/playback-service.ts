import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";

/**
 * Přehrávač očima systému.
 *
 * Zvuk hraje ve WebView a Android o něm sám od sebe neví nic - v notifikacích
 * ani na zamykací obrazovce se neobjeví. Tenhle most mu pošle, co hraje,
 * a přinese zpátky, co uživatel zmáčkl.
 *
 * Zároveň drží appku naživu: proces bez služby v popředí Android na pozadí
 * sestřelí a hudba uprostřed skladby ztichne.
 *
 * V prohlížeči i na starším balíku bez pluginu se všechno tiše přeskočí.
 */
export interface NowPlaying {
  title: string;
  artist: string;
  album: string;
  /** Původní `content://` adresa obalu, ne ta přeložená pro WebView. */
  artwork: string | null;
  durationMs: number;
  positionMs: number;
  playing: boolean;
}

export type PlaybackCommand =
  | { action: "play" | "pause" | "next" | "previous" | "stop" }
  | { action: "seek"; positionMs: number };

interface PlaybackPlugin {
  update(options: NowPlaying): Promise<void>;
  stop(): Promise<void>;
  requestNotifications(): Promise<void>;
  addListener(
    event: "command",
    handler: (data: { action: string; positionMs?: number }) => void,
  ): Promise<PluginListenerHandle>;
}

const Playback = registerPlugin<PlaybackPlugin>("Playback");

let notificationsAsked = false;

export async function updateNowPlaying(state: NowPlaying): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    // O notifikace se řekne až u prvního přehrání - ptát se hned při startu
    // appky by bylo na nic, uživatel ještě neví proč.
    if (!notificationsAsked) {
      notificationsAsked = true;
      await Playback.requestNotifications().catch(() => {});
    }
    await Playback.update(state);
  } catch {
    // Starší balík bez pluginu - hudba hraje, jen o ní systém neví.
  }
}

export async function clearNowPlaying(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await Playback.stop();
  } catch {
    // Služba neběží nebo plugin chybí - není co řešit.
  }
}

/** Stisky z notifikace, ze zámku i ze sluchátek. Vrací odhlášení. */
export function onPlaybackCommand(handler: (command: PlaybackCommand) => void): () => void {
  if (!Capacitor.isNativePlatform()) return () => {};
  let handle: PluginListenerHandle | null = null;
  let cancelled = false;

  void Playback.addListener("command", (data) => {
    if (data.action === "seek") {
      handler({ action: "seek", positionMs: data.positionMs ?? 0 });
      return;
    }
    if (data.action === "play" || data.action === "pause" || data.action === "next" || data.action === "previous" || data.action === "stop") {
      handler({ action: data.action });
    }
  })
    .then((registered) => {
      if (cancelled) void registered.remove();
      else handle = registered;
    })
    .catch(() => {});

  return () => {
    cancelled = true;
    void handle?.remove();
  };
}
