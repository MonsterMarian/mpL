import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";

/**
 * Přehrávání v nativní službě.
 *
 * Dokud hudba hrála ve stránce, byla svázaná s oknem appky: stačilo appku
 * odsunout nebo zavřít a ztichla, protože WebView zmizel i s ní. Nativní
 * služba hraje dál - a je to zároveň jediné místo, ze kterého se dá obsloužit
 * notifikace a zamykací obrazovka.
 *
 * Webová vrstva tady jen říká, co se má hrát, a poslouchá, co se děje.
 * V prohlížeči (a ve starém APK bez pluginu) se všechno tiše přeskočí
 * a přehrává značka `<audio>` ve stránce jako dřív.
 */
export interface NativeTrackRequest {
  /** Původní `content://` adresa, ne ta přeložená pro WebView. */
  uri: string;
  title: string;
  artist: string;
  album: string;
  artwork: string | null;
  positionMs: number;
  playWhenReady: boolean;
}

export interface PlaybackStateEvent {
  playing: boolean;
  positionMs: number;
  durationMs: number;
}

/**
 * `source` odděluje stisk v notifikaci (vždycky uživatel) od `onPause`, které
 * na systémové session umí vyvolat i sám systém.
 */
export type PlaybackSource = "session" | "notification";

export type PlaybackCommand =
  | { action: "play" | "pause" | "next" | "previous" | "stop"; source: PlaybackSource }
  | { action: "seek"; positionMs: number; source: PlaybackSource };

export interface NativeSnapshot {
  running: boolean;
  uri?: string;
  playing?: boolean;
  positionMs?: number;
  durationMs?: number;
}

interface PlaybackPlugin {
  load(options: NativeTrackRequest): Promise<void>;
  current(): Promise<NativeSnapshot>;
  play(): Promise<void>;
  pause(): Promise<void>;
  seek(options: { positionMs: number }): Promise<void>;
  stop(): Promise<void>;
  requestNotifications(): Promise<void>;
  /** Dodává Capacitor sám podle deklarovaných oprávnění pluginu. */
  checkPermissions(): Promise<{ notifications: "granted" | "denied" | "prompt" | "prompt-with-rationale" }>;
  addListener(event: "state", handler: (data: PlaybackStateEvent) => void): Promise<PluginListenerHandle>;
  addListener(event: "completed", handler: () => void): Promise<PluginListenerHandle>;
  addListener(event: "failed", handler: (data: { message?: string }) => void): Promise<PluginListenerHandle>;
  addListener(
    event: "command",
    handler: (data: { action: string; positionMs?: number; source?: string }) => void,
  ): Promise<PluginListenerHandle>;
}

const Playback = registerPlugin<PlaybackPlugin>("Playback");

/** Umí tahle instalace přehrávat nativně? Starý balík ani prohlížeč ne. */
export function nativePlaybackAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable("Playback");
}

let notificationsAsked = false;

export async function playNative(request: NativeTrackRequest): Promise<void> {
  if (!nativePlaybackAvailable()) return;
  try {
    // O notifikace se řekne až u prvního přehrání - ptát se hned při startu
    // appky by bylo na nic, uživatel ještě neví proč.
    if (!notificationsAsked) {
      notificationsAsked = true;
      await Playback.requestNotifications().catch(() => {});
    }
    await Playback.load(request);
  } catch {
    // Bez služby zbývá přehrávání ve stránce.
  }
}

export async function resumeNative(): Promise<void> {
  if (!nativePlaybackAvailable()) return;
  try {
    await Playback.play();
  } catch {
    // viz výše
  }
}

export async function pauseNative(): Promise<void> {
  if (!nativePlaybackAvailable()) return;
  try {
    await Playback.pause();
  } catch {
    // viz výše
  }
}

export async function seekNative(positionMs: number): Promise<void> {
  if (!nativePlaybackAvailable()) return;
  try {
    await Playback.seek({ positionMs: Math.max(0, Math.round(positionMs)) });
  } catch {
    // viz výše
  }
}

export async function stopNative(): Promise<void> {
  if (!nativePlaybackAvailable()) return;
  try {
    await Playback.stop();
  } catch {
    // viz výše
  }
}

export interface NativePlaybackHandlers {
  onState: (state: PlaybackStateEvent) => void;
  onCompleted: () => void;
  onFailed: (message: string) => void;
  onCommand: (command: PlaybackCommand) => void;
}

/** Přihlásí se ke všemu, co služba hlásí. Vrací odhlášení. */
export function listenToNativePlayback(handlers: NativePlaybackHandlers): () => void {
  if (!nativePlaybackAvailable()) return () => {};
  const handles: PluginListenerHandle[] = [];
  let cancelled = false;

  const keep = (promise: Promise<PluginListenerHandle>) => {
    void promise
      .then((handle) => {
        if (cancelled) void handle.remove();
        else handles.push(handle);
      })
      .catch(() => {});
  };

  keep(Playback.addListener("state", handlers.onState));
  keep(Playback.addListener("completed", handlers.onCompleted));
  keep(Playback.addListener("failed", (data) => handlers.onFailed(data?.message ?? "Přehrávač selhal.")));
  keep(
    Playback.addListener("command", (data) => {
      const source: PlaybackSource = data.source === "notification" ? "notification" : "session";
      if (data.action === "seek") {
        handlers.onCommand({ action: "seek", positionMs: data.positionMs ?? 0, source });
        return;
      }
      if (
        data.action === "play" ||
        data.action === "pause" ||
        data.action === "next" ||
        data.action === "previous" ||
        data.action === "stop"
      ) {
        handlers.onCommand({ action: data.action, source });
      }
    }),
  );

  return () => {
    cancelled = true;
    for (const handle of handles) void handle.remove();
  };
}

/**
 * Co služba zrovna hraje.
 *
 * Appka se podle toho po otevření srovná: hudba mohla hrát celou dobu, co byla
 * zavřená, a nemá se jí přerazit ani tvářit, že nehraje nic.
 */
export async function currentNativePlayback(): Promise<NativeSnapshot | null> {
  if (!nativePlaybackAvailable()) return null;
  try {
    return await Playback.current();
  } catch {
    return null;
  }
}

/** Co z ovládání v systému je vůbec k mání - pro diagnostiku v Nastavení. */
export interface PlaybackSupport {
  native: boolean;
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
  if (!nativePlaybackAvailable()) return;
  try {
    notificationsAsked = true;
    await Playback.requestNotifications();
  } catch {
    // Starší balík bez pluginu - není o co si říct.
  }
}
