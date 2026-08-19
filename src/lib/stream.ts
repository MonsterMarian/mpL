import { Capacitor, registerPlugin } from "@capacitor/core";

/**
 * Nativní přehrávač videa a hledání adres streamů.
 *
 * Obojí umí jen nativní vrstva: WebView přehraje pouze webové kodeky a adresu
 * souboru za odkazem na YouTube z JavaScriptu nezjistíš.
 */
export interface ResolvedStream {
  url: string;
  title: string;
  author: string;
  durationSeconds: number;
  extension: string;
}

interface StreamPlugin {
  playVideo(options: { uri: string; title?: string }): Promise<void>;
  resolve(options: { url: string; kind: "audio" | "video" }): Promise<ResolvedStream>;
}

const Stream = registerPlugin<StreamPlugin>("Stream");

export function nativeStreamAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable("Stream");
}

/** Otevře video v ExoPlayeru. Vrací `false`, když nativní přehrávač není. */
export async function playVideoNatively(uri: string, title?: string): Promise<boolean> {
  if (!nativeStreamAvailable()) return false;
  try {
    await Stream.playVideo({ uri, title });
    return true;
  } catch {
    return false;
  }
}

/**
 * Najde adresu souboru za odkazem.
 *
 * `kind: "audio"` vrátí zvukovou stopu (m4a), `"video"` obraz i zvuk v jednom
 * souboru. Odkaz na Spotify se nerozebírá - přečte se z něj jen veřejný název
 * a podle něj se skladba najde na YouTube.
 */
export async function resolveStream(url: string, kind: "audio" | "video"): Promise<ResolvedStream> {
  if (!nativeStreamAvailable()) {
    throw new Error("Rozbor odkazu umí jen appka v telefonu.");
  }
  return Stream.resolve({ url, kind });
}
