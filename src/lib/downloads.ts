/**
 * Stahování z přímých odkazů.
 *
 * Čistá logika kolem addonu: co se dá stáhnout, jak se bude soubor jmenovat
 * a co appka stáhla naposledy. Samotné stahování obstará systém.
 */
import { Capacitor } from "@capacitor/core";
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";

export interface DownloadRecord {
  url: string;
  fileName: string;
  at: number;
  /** Hudba, nebo video - podle toho se stahuje znovu. Starší záznamy ho nemají. */
  kind?: "audio" | "video";
  /** Stahování selhalo - v historii má tlačítko „Stáhnout znovu“. */
  failed?: boolean;
  /** Náhled z YouTube. Zůstane v historii, i když skladbu někdo smaže. */
  artwork?: string;
}

const STORAGE_KEY = "microwins:downloads";
const LIMIT = 20;
/**
 * Kopie historie ve sdílených Dokumentech telefonu. Data appky (a s nimi
 * localStorage) smaže odinstalace, tenhle soubor ne.
 */
const BACKUP_FILE = "P_layer/stahovani.json";

function parseDownloads(raw: string | null): DownloadRecord[] {
  try {
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

export function loadDownloads(): DownloadRecord[] {
  try {
    return parseDownloads(localStorage.getItem(STORAGE_KEY));
  } catch {
    return [];
  }
}

function saveDownloads(list: DownloadRecord[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // soukromý režim - seznam vydrží do zavření appky
  }
  if (!Capacitor.isNativePlatform()) return;
  Filesystem.writeFile({
    path: BACKUP_FILE,
    directory: Directory.Documents,
    encoding: Encoding.UTF8,
    data: JSON.stringify(list),
    recursive: true,
  }).catch((error) => console.warn("Zálohu historie stahování se nepodařilo zapsat", error));
}

/** Dva seznamy v jeden: stejný odkaz jednou, novější záznam vyhrává. */
export function mergeDownloads(a: DownloadRecord[], b: DownloadRecord[]): DownloadRecord[] {
  const byUrl = new Map<string, DownloadRecord>();
  for (const record of [...a, ...b]) {
    const known = byUrl.get(record.url);
    if (!known || record.at > known.at) byUrl.set(record.url, record);
  }
  return [...byUrl.values()].sort((x, y) => y.at - x.at).slice(0, LIMIT);
}

/**
 * Historie po startu appky - spojená se zálohou v Dokumentech.
 *
 * Po přeinstalaci je localStorage prázdné a seznam se vrátí ze zálohy. Po
 * aktualizaci appky, která zálohu ještě nedělala, se záloha naopak založí.
 */
export async function restoreDownloads(): Promise<DownloadRecord[]> {
  if (!Capacitor.isNativePlatform()) return loadDownloads();
  let backup: DownloadRecord[] = [];
  try {
    const file = await Filesystem.readFile({ path: BACKUP_FILE, directory: Directory.Documents, encoding: Encoding.UTF8 });
    backup = parseDownloads(String(file.data));
  } catch {
    // záloha ještě není - nebo ji appka po přeinstalaci bez „přístupu ke všem souborům" nepřečte
  }
  const merged = mergeDownloads(loadDownloads(), backup);
  saveDownloads(merged);
  return merged;
}

/**
 * Zapíše stahování do historie. Stejný odkaz je v ní jednou - povedené
 * opakování tak nahradí řádek, kde stahování selhalo.
 */
export function addDownload(record: DownloadRecord): DownloadRecord[] {
  const next = [record, ...loadDownloads().filter((item) => item.url !== record.url)].slice(0, LIMIT);
  saveDownloads(next);
  return next;
}

/** „Vymazat seznam" - jediná cesta, jak historii smazat, i se zálohou. */
export function clearDownloads(): DownloadRecord[] {
  saveDownloads([]);
  return [];
}

/**
 * Očistí zadaný text nebo odkaz.
 *
 * Podporuje:
 * - Odkazy obalené dalším textem (např. při sdílení z aplikace YouTube: "Podívej se na: https://youtu.be/...")
 * - Adresy bez protokolu (např. "youtube.com/watch?v=..." nebo "youtu.be/...")
 * - Oříznutí bílých znaků
 */
export function cleanDownloadUrl(input: string): string {
  let text = input.trim();
  if (!text) return "";
  const match = text.match(/https?:\/\/[^\s]+/i);
  if (match) {
    text = match[0];
  } else if (/^(?:(?:www|m|music)\.)?(?:youtube\.com|youtu\.be|open\.spotify\.com)/i.test(text)) {
    text = `https://${text}`;
  }

  // Normalizace YouTube videa:
  // Vytáhne 11znakový identifikátor videa z watch?v=, youtu.be/, shorts/, embed/, live/...
  // a zbaví se parametrů playlistu (&list=, &index=, &start_radio=) i sledovacích (?si=, &feature=),
  // které NewPipeExtractor odmítá zpracovat.
  const ytVideoMatch = text.match(
    /(?:(?:www|m|music)\.)?(?:youtube\.com\/(?:watch\?.*?v=|shorts\/|embed\/|v\/|live\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i
  );
  if (ytVideoMatch) {
    return `https://www.youtube.com/watch?v=${ytVideoMatch[1]}`;
  }

  return text;
}

/** Odkaz, za kterým je stránka - adresu souboru z něj musí najít nativní vrstva. */
export function needsResolving(url: string): boolean {
  try {
    const clean = cleanDownloadUrl(url);
    const host = new URL(clean).hostname.toLowerCase();
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
  const clean = cleanDownloadUrl(url);
  try {
    new URL(clean);
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
  const suffix = extension.replace(/[^a-z0-9]/gi, "").toLowerCase() || "mp3";
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

/**
 * Skladba z knihovny, kterou záznam stáhl - nebo nic, když ji někdo smazal.
 *
 * Jméno souboru vzniklo z „interpret - název" a tytéž dvě věci se zapsaly do
 * tagů, takže jde složit zpátky. Bez interpreta (přímý odkaz) zbyde jen název.
 */
export function downloadedTrack<T extends { title: string; artist: string }>(
  record: DownloadRecord,
  tracks: T[],
): T | undefined {
  const base = (name: string) => name.replace(/\.[a-z0-9]{2,4}$/i, "").toLowerCase();
  const wanted = base(record.fileName);
  return tracks.find(
    (track) =>
      base(safeFileName(`${track.artist} - ${track.title}`, "mp3")) === wanted ||
      base(safeFileName(track.title, "mp3")) === wanted,
  );
}
