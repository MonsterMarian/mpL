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

/**
 * Zdroje, ze kterých addon stahovat nebude.
 *
 * Spotify má obsah chráněný technickou ochranou a její obcházení je nelegální.
 * YouTube stahování zakazuje ve svých podmínkách a k vytažení souboru je
 * potřeba obcházet jeho přehrávač - to je práce pro samostatný nástroj, ne pro
 * přehrávač hudby. Adresa se proto odmítne rovnou a s vysvětlením, místo aby
 * stahování tiše selhalo na nesrozumitelné chybě.
 */
export function unsupportedSource(url: string): { title: string; description: string } | null {
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return { title: "Tohle není adresa", description: "Odkaz musí začínat http:// nebo https://." };
  }

  if (host.includes("spotify.")) {
    return {
      title: "Ze Spotify to nejde",
      description: "Obsah je chráněný a obcházení té ochrany je nelegální. Použij přímý odkaz na soubor.",
    };
  }
  if (host.includes("youtube.") || host.includes("youtu.be") || host.includes("music.youtube")) {
    return {
      title: "Z YouTube to nejde",
      description: "Stahování zakazují jeho podmínky. Použij přímý odkaz na soubor.",
    };
  }
  return null;
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
