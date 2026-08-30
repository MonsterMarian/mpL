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

/**
 * Odkud vzít soubor, když se má vykreslit stránka.
 *
 * `device` je kniha ležící v telefonu - ta se nekopíruje, čte se z místa, kde
 * je. `stored` je kopie v datech appky (soubor vybraný ručně, ten jinou adresu
 * nemá). `none` je starý záznam z doby, kdy si čtečka nechávala jen text -
 * takový dokument jde pořád číst, jen se u něj nedá ukázat stránka.
 */
export type DocumentOrigin =
  | { kind: "stored" }
  | { kind: "device"; uri: string }
  | { kind: "none" };

/** Uložený dokument: vytažený text a odkaz na soubor, ze kterého se kreslí. */
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
  /**
   * Náhled první stránky jako data URI.
   *
   * Kreslí se jednou při načtení dokumentu, ne při každém otevření knihovny:
   * vykreslit deset PDF stránek naráz je práce na vteřiny a příště by to bylo
   * to samé.
   */
  thumbnail?: string | null;
  /** Kde leží soubor, ze kterého se kreslí stránky. */
  origin?: DocumentOrigin;
  /**
   * Pravidlo, kterým vznikl text stránek (`TEXT_LAYOUT_VERSION` v `pdf.ts`).
   *
   * Zvýraznění čtené věty stojí na tom, že text stránky a textová vrstva nad
   * plátnem jsou jeden řetězec. Dokument uložený podle staršího pravidla se
   * proto při otevření přečte znovu, místo aby ukazoval vedle.
   */
  textVersion?: number;
  /** Poměr stran první stránky (šířka/výška) - drží místo té nevykreslené. */
  aspect?: number | null;
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
 * Kus textu k předčítání i s tím, kde na stránce leží.
 *
 * Pozice jsou nutné kvůli zvýrazňování: bez nich by se dalo říct jen „čte se
 * kus číslo pět", ale ne který to je na obrazovce. Ukazují do **původního**
 * textu stránky, ne do normalizovaného - do toho, co uživatel vidí.
 */
export interface SpeechSegment {
  /** Text, jak jde do hlasového modulu: bez zalomení a zdvojených mezer. */
  text: string;
  /** Index prvního znaku v původním textu stránky. */
  start: number;
  /** Index za posledním znakem. */
  end: number;
}

/** Hranice vět v původním textu. Rozsahy na sebe navazují, nic nevynechají. */
function sentenceRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let start = 0;

  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== "." && text[i] !== "!" && text[i] !== "?") continue;
    // Interpunkce i mezera za ní patří k větě, která končí - jinak by příští
    // věta začínala uprostřed bílého místa a zvýraznění by odsazovalo.
    let end = i + 1;
    while (end < text.length && (text[end] === "." || text[end] === "!" || text[end] === "?")) end += 1;
    while (end < text.length && /\s/.test(text[end])) end += 1;
    ranges.push([start, end]);
    start = end;
    i = end - 1;
  }

  if (start < text.length) ranges.push([start, text.length]);
  return ranges;
}

/**
 * Text rozsekaný na kusy k předčítání i s pozicemi na stránce.
 *
 * Řeč se nedá pozastavit uprostřed - plugin `text-to-speech` pauzu neumí
 * a zastavit se dá jen celé. Čte se proto po větách: pauza znamená dočíst
 * rozečtený kus a zapamatovat si, kolikátý to byl. Pokračování pak navazuje
 * tam, kde řeč utichla, ne na začátku stránky.
 *
 * Věty se hledají rovnou v původním textu, ne v normalizovaném. Normalizací
 * by se ztratily pozice, a s nimi možnost ukázat na stránce, kde se zrovna je
 * a odkud se má číst dál.
 */
export function speechSegments(text: string, maxLength = 220): SpeechSegment[] {
  const out: SpeechSegment[] = [];
  const normalize = (value: string) => value.replace(/\s+/g, " ").trim();

  const push = (start: number, end: number) => {
    const raw = text.slice(start, end);
    const value = normalize(raw);
    if (!value) return;
    // Bílé okraje ven z rozsahu: zvýraznění nemá sahat do mezer mezi větami.
    const lead = raw.length - raw.replace(/^\s+/, "").length;
    const trail = raw.length - raw.replace(/\s+$/, "").length;
    out.push({ text: value, start: start + lead, end: end - trail });
  };

  let bufferStart = -1;
  let bufferEnd = -1;
  let bufferLength = 0;

  const flush = () => {
    if (bufferStart >= 0) push(bufferStart, bufferEnd);
    bufferStart = -1;
    bufferEnd = -1;
    bufferLength = 0;
  };

  for (const [start, end] of sentenceRanges(text)) {
    const length = normalize(text.slice(start, end)).length;

    // Jedna nekonečná věta (nebo text bez teček) se rozseká natvrdo - jinak by
    // šel do rozpoznávače celý odstavec a pauza by na něj čekala minutu.
    if (length > maxLength) {
      flush();
      for (let i = start; i < end; i += maxLength) push(i, Math.min(end, i + maxLength));
      continue;
    }

    if (bufferLength + length > maxLength) flush();
    if (bufferStart < 0) bufferStart = start;
    bufferEnd = end;
    bufferLength += length;
  }
  flush();

  return out;
}

/** Jen texty kusů - pro hlasový modul, kterému je jedno, kde na stránce jsou. */
export function speechChunks(text: string, maxLength = 220): string[] {
  return speechSegments(text, maxLength).map((segment) => segment.text);
}
