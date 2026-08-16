/**
 * Dokumenty v čtečce - pravidla bez Reactu a bez prohlížeče.
 *
 * Čtečka má být druhá polovina appky, ne přívěsek: dokument se pamatuje stejně
 * jako skladba, čte se odtud, kde se skončilo, a předčítání se ovládá stejnými
 * tlačítky jako hudba. Všechno, co k tomu je potřeba spočítat, bydlí tady -
 * `page.tsx` je jen obrazovka (viz `documents.test.ts`).
 */

export interface DocumentPage {
  text: string;
  label: string;
}

/** Uložený dokument. Nedrží původní soubor, jen vytažený text - ten stačí. */
export interface StoredDocument {
  id: string;
  name: string;
  pages: DocumentPage[];
  /** PDF bez textové vrstvy: přečíst nejde, ale ať to appka řekne rovnou. */
  imageOnly: boolean;
  addedAt: string;
  /** Stránka, na které uživatel naposledy skončil. */
  page: number;
  bookmarks: number[];
}

/** Kolik znaků textového souboru padne na jednu "stránku". */
export const TEXT_PAGE_SIZE = 3000;

/** Stránka PDF, ze které nešel vytáhnout žádný text. */
export const EMPTY_PAGE_TEXT = "Tato stránka neobsahuje strojově čitelný text.";

/**
 * Má stránka text, který se dá číst? Pár zbloudilých znaků z hlavičky nebo
 * čísla stránky se nepočítá - naskenovaná kniha jich má na každé straně pár
 * a tvářila by se pak jako čitelná.
 */
export function hasReadableText(text: string): boolean {
  return text.replace(/\s+/g, "").length >= 20;
}

/**
 * Obrázkový dokument: ani jedna stránka nemá text. Pozná se hned po načtení,
 * takže se rovnou řekne, co je špatně - nabízet čtení nahlas u naskenované
 * knihy znamená slíbit něco, co nikdy nepůjde.
 */
export function isImageOnly(pages: DocumentPage[]): boolean {
  return pages.length > 0 && !pages.some((page) => hasReadableText(page.text));
}

/** Text bez čitelného obsahu se v čtečce nahradí hláškou, ne prázdnem. */
export function pageText(raw: string): string {
  return hasReadableText(raw) ? raw : EMPTY_PAGE_TEXT;
}

/** Textový soubor rozsekaný na stránky po `TEXT_PAGE_SIZE` znacích. */
export function buildTextPages(raw: string, size: number = TEXT_PAGE_SIZE): DocumentPage[] {
  const pages: DocumentPage[] = [];
  for (let index = 0; index < raw.length; index += size) {
    pages.push({ text: raw.slice(index, index + size).trim(), label: `Část ${pages.length + 1}` });
  }
  return pages;
}

/**
 * Id dokumentu ze jména a velikosti souboru.
 *
 * Znovu otevřený tentýž soubor musí trefit svůj záznam, aby čtečka věděla,
 * kde se skončilo. Jméno samo nestačí - "kniha.pdf" má kdekdo - a hash celého
 * obsahu je na sto stran zbytečná práce.
 */
export function documentId(name: string, size: number): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${slug || "dokument"}-${size}`;
}

/** Stránka v mezích dokumentu - uložený index může být z kratší verze souboru. */
export function clampPage(page: number, pageCount: number): number {
  if (pageCount <= 0) return 0;
  if (!Number.isFinite(page)) return 0;
  return Math.min(Math.max(Math.round(page), 0), pageCount - 1);
}

/**
 * Text rozsekaný na kusy k předčítání.
 *
 * Řeč se nedá pozastavit uprostřed - plugin `text-to-speech` pauzu neumí
 * a zastavit se dá jen celé. Čte se proto po větách: pauza znamená dočíst
 * rozečtený kus a zapamatovat si, kolikátý to byl. Pokračování pak navazuje
 * tam, kde řeč utichla, ne na začátku stránky.
 */
export function speechChunks(text: string, maxLength = 220): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];

  const sentences = clean.match(/[^.!?]+[.!?]*\s*/g) ?? [clean];
  const out: string[] = [];
  let buffer = "";

  const flush = () => {
    const value = buffer.trim();
    if (value) out.push(value);
    buffer = "";
  };

  for (const sentence of sentences) {
    // Jedna nekonečná věta (nebo text bez teček) se rozseká natvrdo - jinak by
    // šel do rozpoznávače celý odstavec a pauza by na něj čekala minutu.
    if (sentence.length > maxLength) {
      flush();
      for (let i = 0; i < sentence.length; i += maxLength) {
        const part = sentence.slice(i, i + maxLength).trim();
        if (part) out.push(part);
      }
      continue;
    }
    if ((buffer + sentence).length > maxLength) flush();
    buffer += sentence;
  }
  flush();

  return out;
}
