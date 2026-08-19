/**
 * Stahování z přímých odkazů.
 *
 * Čistá logika kolem addonu: co se dá stáhnout, jak se bude soubor jmenovat
 * a co appka stáhla naposledy. Samotné stahování obstará systém.
 */

export interface DownloadRecord {
  url: string;
  fileName: string;
  at: number;
}

const STORAGE_KEY = "microwins:downloads";
const LIMIT = 20;

export function loadDownloads(): DownloadRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is DownloadRecord =>
        Boolean(item) && typeof item === "object" && typeof (item as DownloadRecord).fileName === "string",
    );
  } catch {
    return [];
  }
}

export function addDownload(record: DownloadRecord): DownloadRecord[] {
  const next = [record, ...loadDownloads().filter((item) => item.url !== record.url)].slice(0, LIMIT);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // soukromý režim - seznam vydrží do zavření appky
  }
  return next;
}

export function clearDownloads(): DownloadRecord[] {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // není kam mazat
  }
  return [];
}

/** Odkaz, za kterým je stránka - adresu souboru z něj musí najít nativní vrstva. */
export function needsResolving(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return (
      host.includes("youtube.") ||
      host.includes("youtu.be") ||
      host.includes("spotify.")
    );
  } catch {
    return false;
  }
}

/**
 * Zdroje, ze kterých addon stahovat nebude.
 *
 * Zbyla jediná: co není adresa, není odkaz. Zbytek už umí nativní vrstva -
 * ze stránky YouTube vytáhne adresu streamu, u Spotify přečte jen veřejný
 * název skladby a tu pak najde na YouTube.
 */
export function unsupportedSource(url: string): { title: string; description: string } | null {
  try {
    new URL(url);
  } catch {
    return { title: "Tohle není adresa", description: "Odkaz musí začínat http:// nebo https://." };
  }
  return null;
}

/**
 * Jméno souboru z názvu skladby.
 *
 * Android si na některé znaky v názvu potrpí, takže jdou pryč, a délka se
 * uřízne - dlouhé názvy z YouTube by jinak přetekly.
 */
export function safeFileName(title: string, extension: string): string {
  const clean = title
    // Lomítko odděluje složky, tak se z něj stane pomlčka; ostatní zakázané
    // znaky prostě zmizí - „AC-DC - -Thunderstruck-" nechce číst nikdo.
    .replace(/[\\/]+/g, "-")
    .replace(/["*?:<>|]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 110)
    .replace(/^[-\s]+|[-\s]+$/g, "");
  const suffix = extension.replace(/[^a-z0-9]/gi, "").toLowerCase() || "m4a";
  return `${clean || "stazeny-soubor"}.${suffix}`;
}

/** Jméno souboru z adresy. Bez něj by se všechno jmenovalo „stazeny-soubor". */
export function guessFileName(url: string): string {
  try {
    const path = new URL(url).pathname;
    const last = decodeURIComponent(path.split("/").filter(Boolean).pop() ?? "");
    if (!last) return "stazeny-soubor.mp3";
    // Znaky, které v názvu souboru na Androidu nemají co dělat.
    const safe = last.replace(/[\\/:*?"<>|]+/g, "-").slice(0, 120);
    return /\.[a-z0-9]{2,4}$/i.test(safe) ? safe : `${safe}.mp3`;
  } catch {
    return "stazeny-soubor.mp3";
  }
}
