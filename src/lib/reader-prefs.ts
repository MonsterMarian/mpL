/**
 * Jak má čtečka vypadat.
 *
 * Nastavení knihy se nezadává znovu u každého dokumentu - kdo čte v noci
 * načerno, čte tak všechno. Drží se proto v `localStorage` a platí pro celou
 * čtečku.
 */

/** Barvy stránky. Jména sedí na to, co nabízejí čtečky knih. */
export type ReaderTheme = "day" | "sepia" | "night" | "console";

/** Jak se listuje: plynule pod sebou, nebo po jedné stránce. */
export type ReaderFlow = "scroll" | "page";

export interface ReaderPrefs {
  theme: ReaderTheme;
  flow: ReaderFlow;
  /** Přiblížení oproti šířce obrazovky; 1 = stránka přes celou šířku. */
  zoom: number;
  /** Ořezávat prázdné okraje stránek? */
  crop: boolean;
}

export const DEFAULT_PREFS: ReaderPrefs = {
  theme: "day",
  flow: "scroll",
  zoom: 1,
  crop: false,
};

export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 4;

const KEY = "microwins:reader_prefs";

const THEMES: ReaderTheme[] = ["day", "sepia", "night", "console"];

export function loadReaderPrefs(): ReaderPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<ReaderPrefs>;
    return {
      theme: THEMES.includes(parsed.theme as ReaderTheme) ? (parsed.theme as ReaderTheme) : DEFAULT_PREFS.theme,
      flow: parsed.flow === "page" ? "page" : "scroll",
      zoom: clampZoom(typeof parsed.zoom === "number" ? parsed.zoom : DEFAULT_PREFS.zoom),
      crop: parsed.crop === true,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function saveReaderPrefs(prefs: ReaderPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // Soukromý režim - nastavení vydrží do zavření appky.
  }
}

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}
