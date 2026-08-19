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

/**
 * `source` odděluje stisk v notifikaci (vždycky uživatel) od `onPause`, které
 * na systémové session umí vyvolat i sám systém.
 */
export type PlaybackSource = "session" | "notification";

export type PlaybackCommand =
  | { action: "play" | "pause" | "next" | "previous" | "stop"; source: PlaybackSource }
  | { action: "seek"; positionMs: number; source: PlaybackSource };

interface PlaybackPlugin {
  update(options: NowPlaying): Promise<void>;
  stop(): Promise<void>;
  requestNotifications(): Promise<void>;
  /** Dodává Capacitor sám podle deklarovaných oprávnění pluginu. */
  checkPermissions(): Promise<{ notifications: "granted" | "denied" | "prompt" | "prompt-with-rationale" }>;
  addListener(
    event: "command",
    handler: (data: { action: string; positionMs?: number; source?: string }) => void,
  ): Promise<PluginListenerHandle>;
}

const Playback = registerPlugin<PlaybackPlugin>("Playback");

let notificationsAsked = false;

/**
 * Co z ovládání v systému je vůbec k mání.
 *
 * Nativní část se do telefonu dostane jen s novým APK - živá aktualizace veze
 * pouze web. Bez tohohle by se to poznalo jedině tak, že „to nefunguje":
 * volání do neexistujícího pluginu tiše spadne a nikde se nic neukáže.
 */
export interface PlaybackSupport {
  /** Běžíme v telefonu, ne v prohlížeči. */
  native: boolean;
  /** APK zná plugin Playback. */
  plugin: boolean;
  notifications: "granted" | "denied" | "prompt" | "unknown";
}

export async function playbackSupport(): Promise<PlaybackSupport> {
  const native = Capacitor.isNativePlatform();
  if (!native) return { native: false, plugin: false, notifications: "unknown" };

  const plugin = Capacitor.isPluginAvailable("Playback");
  if (!plugin) return { native: true, plugin: false, notifications: "unknown" };

  try {
    const state = await Playback.checkPermissions();
    return {
      native: true,
      plugin: true,
      notifications: state.notifications === "prompt-with-rationale" ? "prompt" : state.notifications,
    };
  } catch {
    return { native: true, plugin: true, notifications: "unknown" };
  }
}

/** Řekne si o notifikace na vyžádání - z Nastavení, ne mimochodem při přehrání. */
export async function askForNotifications(): Promise<void> {
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable("Playback")) return;
  try {
    notificationsAsked = true;
    await Playback.requestNotifications();
  } catch {
    // Starší balík bez pluginu - není o co si říct.
  }
}

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
    const source: PlaybackSource = data.source === "notification" ? "notification" : "session";
    if (data.action === "seek") {
      handler({ action: "seek", positionMs: data.positionMs ?? 0, source });
      return;
    }
    if (data.action === "play" || data.action === "pause" || data.action === "next" || data.action === "previous" || data.action === "stop") {
      handler({ action: data.action, source });
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
