/**
 * PDF pod čtečkou.
 *
 * Do teď se z PDF vytáhl jen text a stránka se vypsala jako odstavec. Tím
 * z dokumentu zmizelo všechno ostatní - obrázky, tabulky, sazba, rovnice -
 * a čtečka ukazovala něco jiného, než co je v souboru. Tady se proto pracuje
 * se **stránkou**: vykreslí se do plátna přesně tak, jak vypadá, a text se
 * přes ni položí jako neviditelná vrstva. Ta dělá výběr, hledání i zvýraznění
 * čtené věty.
 *
 * Klíčové je, že text vrstvy a text pro předčítání jsou **jeden a tentýž
 * řetězec**. Kus textu se pak dá spočítat na dvojici (kus vrstvy, pozice
 * v něm) a z ní vyrobit obdélník na stránce. Kdyby se text skládal dvakrát
 * jinak, zvýraznění by ukazovalo vedle.
 */
import type { PDFDocumentProxy } from "pdfjs-dist";

type PdfjsModule = typeof import("pdfjs-dist");

/** Verze pravidla, kterým se skládá text stránky - viz `textFromContent`. */
export const TEXT_LAYOUT_VERSION = 2;

let library: Promise<PdfjsModule> | null = null;

/**
 * Knihovna se natáhne jednou za běh appky.
 *
 * Worker se vozí v `public/` a odkazuje se absolutně z kořene - jediná adresa,
 * která sedí v prohlížeči i v appce (viz `scripts/copy-pdf-worker.mjs`).
 */
export function pdfjs(): Promise<PdfjsModule> {
  library ??= import("pdfjs-dist").then((lib) => {
    lib.GlobalWorkerOptions.workerSrc = `${window.location.origin}/pdf.worker.min.mjs`;
    return lib;
  });
  return library;
}

/**
 * Otevře dokument z bajtů.
 *
 * Kopie je schválně: pdf.js si buffer převezme do workeru a původní pole tím
 * osiří. Kdo si data drží (knihovna, druhé otevření), přišel by o ně.
 *
 * `onProgress` hlásí, kolik z dokumentu je rozebráno. U velké knihy to trvá
 * vteřiny a bez čísla uživatel kouká na zamlžené okno a neví, jestli se něco
 * děje, nebo se appka zasekla. Celková velikost nemusí být známá hned - do té
 * doby chodí `null` a ukazatel se hlásí jako "zatím nevím".
 */
export async function openPdf(
  bytes: Uint8Array | ArrayBuffer,
  onProgress?: (percent: number | null) => void,
): Promise<PDFDocumentProxy> {
  const lib = await pdfjs();
  const data = bytes instanceof Uint8Array ? bytes.slice() : new Uint8Array(bytes.slice(0));
  const task = lib.getDocument({
    data,
    // Náhradní písma pro PDF, které si své písmo nenese (Helvetica, Times…).
    // Bez téhle adresy vykreslování stránky uvázne - viz copy-pdf-worker.mjs.
    standardFontDataUrl: `${window.location.origin}/pdf-fonts/`,
  });
  if (onProgress) {
    task.onProgress = ({ loaded, total }: { loaded: number; total: number }) => {
      onProgress(total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : null);
    };
  }
  return task.promise;
}

/**
 * Do workeru pdf.js se chodí po jednom.
 *
 * Worker je na celý dokument jeden. Pustit do něj deset stránek naráz
 * neznamená deset stránek dřív - znamená to deset rozdělaných, z nichž ani
 * jedna není hotová, a čtenář kouká na prázdné obdélníky.
 *
 * Fronta je společná schválně. Vedle kreslení se na pozadí ještě proměřují
 * rozměry všech stránek, a kdyby si obojí lezlo do zelí, měřítko dlouhé knihy
 * by odsunulo první stránku o pěkných pár vteřin. Takhle měření mezi
 * stránkami pustí každého, kdo si zrovna řekl o vykreslení.
 */
let busy = false;
const waiting: { rank: number; start: () => void }[] = [];

/**
 * `rank` říká, kdo je na řadě dřív - menší číslo jde první.
 *
 * Stránka, na kterou se čtenář dívá, má přednost před tou vedlejší a obě před
 * měřením na pozadí. Bez toho se po skoku doprostřed knihy kreslila nejdřív
 * stránka nad tou hledanou a čtenář koukal na prázdno o vteřinu dýl, než bylo
 * nutné.
 */
export function pdfSlot(rank = 0): Promise<() => void> {
  return new Promise((resolve) => {
    const start = () => {
      busy = true;
      let released = false;
      resolve(() => {
        if (released) return;
        released = true;
        busy = false;
        waiting.shift()?.start();
      });
    };
    if (!busy) {
      start();
      return;
    }
    const at = waiting.findIndex((item) => item.rank > rank);
    const entry = { rank, start };
    if (at < 0) waiting.push(entry);
    else waiting.splice(at, 0, entry);
  });
}

/** Kus textové vrstvy: kde leží v textu stránky. */
export interface TextSpan {
  start: number;
  end: number;
}

export interface PageText {
  text: string;
  /** Pozice kusů; index sedí na `textDivs` z `TextLayer`. */
  spans: TextSpan[];
}

/** Co pdf.js vrátí jako obsah stránky. Typ je jen tolik, kolik se tu čte. */
interface RawTextContent {
  items: ({ str?: string; hasEOL?: boolean } | Record<string, unknown>)[];
}

/**
 * Text stránky a pozice jeho kusů.
 *
 * Pravidlo je prosté: kusy se lepí za sebe bez mezery a za tím, který končí
 * řádek, je zalomení. Přesně tak vzniká i textová vrstva v DOMu (kus = `span`,
 * konec řádku = `<br>`), takže se indexy nemůžou rozejít. Položky bez `str`
 * jsou značky struktury, ne text - ty pdf.js do vrstvy nedává a nedáváme je
 * tam ani my.
 */
export function textFromContent(content: unknown): PageText {
  const items = (content as RawTextContent)?.items ?? [];
  const spans: TextSpan[] = [];
  let text = "";
  for (const item of items) {
    const raw = item as { str?: string; hasEOL?: boolean };
    if (typeof raw.str !== "string") continue;
    const start = text.length;
    text += raw.str;
    spans.push({ start, end: text.length });
    if (raw.hasEOL) text += "\n";
  }
  return { text, spans };
}

/** Osnova dokumentu (PDF „bookmarks"), srovnaná do seznamu s odsazením. */
export interface OutlineEntry {
  title: string;
  /** Stránka od nuly; `null`, když cíl nejde přeložit na stránku. */
  page: number | null;
  depth: number;
}

interface RawOutline {
  title: string;
  dest: string | unknown[] | null;
  items: RawOutline[];
}

/**
 * Obsah knihy, jak si ho nese samotné PDF.
 *
 * Cíl odkazu je buď jméno, které se musí přeložit, nebo rovnou pole, kde
 * první prvek ukazuje na stránku. Když se přeložit nedá, položka zůstane -
 * v obsahu má být vidět i kapitola, na kterou se nedá skočit.
 */
export async function readOutline(pdf: PDFDocumentProxy): Promise<OutlineEntry[]> {
  let raw: RawOutline[] | null = null;
  try {
    raw = (await pdf.getOutline()) as RawOutline[] | null;
  } catch {
    return [];
  }
  if (!raw?.length) return [];

  const out: OutlineEntry[] = [];
  const walk = async (nodes: RawOutline[], depth: number) => {
    for (const node of nodes) {
      out.push({ title: node.title?.trim() || "Bez názvu", page: await destinationPage(pdf, node.dest), depth });
      if (node.items?.length) await walk(node.items, depth + 1);
    }
  };
  try {
    await walk(raw, 0);
  } catch {
    // Rozbitá osnova není důvod nepustit čtenáře do knihy.
  }
  return out;
}

async function destinationPage(pdf: PDFDocumentProxy, dest: string | unknown[] | null): Promise<number | null> {
  try {
    const target = typeof dest === "string" ? await pdf.getDestination(dest) : dest;
    if (!Array.isArray(target) || !target.length) return null;
    const ref = target[0];
    if (typeof ref === "number") return ref;
    return await pdf.getPageIndex(ref as never);
  } catch {
    return null;
  }
}

/** Nalezené místo v dokumentu. */
export interface SearchHit {
  page: number;
  start: number;
  end: number;
  /** Věta kolem nálezu, do seznamu výsledků. */
  preview: string;
}

/** Kolik znaků kolem nálezu se ukáže v seznamu výsledků. */
const PREVIEW_PAD = 40;

/**
 * Najde všechny výskyty v už vytaženém textu stránek.
 *
 * Hledá se bez ohledu na velikost písmen a na diakritiku - „príliš" najde
 * „příliš". Češtinu bez háčků píše kdekdo a čtečka, která to neumí, je
 * k hledání v české knize k ničemu.
 */
export function searchPages(pages: string[], query: string, limit = 400): SearchHit[] {
  const needle = foldText(query.trim());
  if (needle.length < 2) return [];

  const hits: SearchHit[] = [];
  for (let page = 0; page < pages.length; page += 1) {
    const text = pages[page] ?? "";
    const hay = foldText(text);
    let at = hay.indexOf(needle);
    while (at >= 0) {
      hits.push({
        page,
        start: at,
        end: at + needle.length,
        preview: preview(text, at, at + needle.length),
      });
      if (hits.length >= limit) return hits;
      at = hay.indexOf(needle, at + needle.length);
    }
  }
  return hits;
}

/**
 * Text bez diakritiky a velkých písmen, **znak za znak**.
 *
 * Délka se nesmí změnit: pozice nálezu se přenáší zpátky do původního textu
 * a o znak posunuté zvýraznění je vidět. Proto se skládané znaky rozloží
 * a rovnou se zahodí všechno, co samo o sobě nezabírá místo.
 */
function foldText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

function preview(text: string, start: number, end: number): string {
  const from = Math.max(0, start - PREVIEW_PAD);
  const to = Math.min(text.length, end + PREVIEW_PAD);
  const head = from > 0 ? "…" : "";
  const tail = to < text.length ? "…" : "";
  return `${head}${text.slice(from, to).replace(/\s+/g, " ").trim()}${tail}`;
}

/**
 * Ořez prázdných okrajů.
 *
 * Skripta a naskenované knihy mají kolem sazby palec bílé plochy. Na telefonu
 * je to půlka obrazovky a písmo pak vyjde na pár bodů. Okraj se hledá
 * v samotném obrázku stránky - v PDF o něm nikde nic není napsané.
 *
 * Vrací poměry (0-1) od levého horního rohu, ne pixely: stránka se překresluje
 * v různém přiblížení a poměr platí pořád.
 */
export interface CropBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export const NO_CROP: CropBox = { left: 0, top: 0, right: 1, bottom: 1 };

/** Světlejší než tohle (0-255) se bere jako papír, ne jako tisk. */
const INK_LIMIT = 232;

/** Kolik prostoru kolem sazby zůstane, v poměru k rozměru stránky. */
const CROP_PAD = 0.012;

/** Míň než tohle už není okraj, ale ořez do textu - takový se zahodí. */
const MIN_CROP_SIDE = 0.35;

export function detectCrop(canvas: HTMLCanvasElement): CropBox {
  try {
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return NO_CROP;

    // Hledá se v hrubém rastru: na okraj stačí a projít každý pixel velké
    // stránky by trvalo dýl než ji vykreslit.
    const step = Math.max(1, Math.round(Math.max(canvas.width, canvas.height) / 400));
    const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height);

    let left = width;
    let top = height;
    let right = 0;
    let bottom = 0;

    for (let y = 0; y < height; y += step) {
      for (let x = 0; x < width; x += step) {
        const at = (y * width + x) * 4;
        const alpha = data[at + 3];
        if (alpha < 16) continue;
        // Šeď stačí, barvu tady nikdo nerozlišuje.
        const shade = (data[at] * 3 + data[at + 1] * 6 + data[at + 2]) / 10;
        if (shade > INK_LIMIT) continue;
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }

    if (right <= left || bottom <= top) return NO_CROP;

    const box: CropBox = {
      left: Math.max(0, left / width - CROP_PAD),
      top: Math.max(0, top / height - CROP_PAD),
      right: Math.min(1, right / width + CROP_PAD),
      bottom: Math.min(1, bottom / height + CROP_PAD),
    };
    if (box.right - box.left < MIN_CROP_SIDE || box.bottom - box.top < MIN_CROP_SIDE) return NO_CROP;
    return box;
  } catch {
    // Plátno z cizího zdroje by čtení pixelů zakázalo. Bez ořezu se čte taky.
    return NO_CROP;
  }
}
