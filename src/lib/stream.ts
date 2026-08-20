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
  lastCrash(): Promise<{ crash: string | null }>;
  clearCrash(): Promise<void>;
}

const Stream = registerPlugin<StreamPlugin>("Stream");

export function nativeStreamAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable("Stream");
}

/**
 * Pustí video v přehrávači aplikace. Ten si sám vybere, jestli na soubor stačí
 * systémové dekodéry, nebo je potřeba VLC. Vrací `false`, když appka neběží
 * v telefonu a nativní přehrávač tím pádem není.
 */
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
 * Poslední pád nativní části.
 *
 * Když spadne obrazovka v Javě, appka zmizí a v telefonu po ní nezůstane nic,
 * co by šlo přečíst - logcat je bez kabelu k ničemu. Tohle je ta stopa.
 */
export async function lastNativeCrash(): Promise<string | null> {
  if (!nativeStreamAvailable()) return null;
  try {
    const result = await Stream.lastCrash();
    return result?.crash ?? null;
  } catch {
    return null;
  }
}

export async function clearNativeCrash(): Promise<void> {
  if (!nativeStreamAvailable()) return;
  try {
    await Stream.clearCrash();
  } catch {
    // není co mazat
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
