/**
 * Knihovna dokumentů na disku.
 *
 * Do teď žil otevřený dokument jen v paměti stránky: zavřít appku znamenalo
 * hledat soubor znovu. Hudba se takhle nechová a čtečka se má chovat stejně.
 *
 * Tady je jen seznam - text stránek, postup ve čtení a odkaz na soubor.
 * Samotné PDF leží zvlášť (`document-file.ts`): tenhle seznam se přepisuje
 * při každém obrácení stránky a kniha o padesáti megabajtech v něm nemá co
 * dělat.
 *
 * Dvě úložiště podle prostředí: v telefonu soubor přes Capacitor Filesystem,
 * v prohlížeči IndexedDB. `localStorage` odpadá - kniha o pěti stech stranách
 * je pár megabajtů a pětimegová kvóta by praskla.
 */
import { Capacitor } from "@capacitor/core";
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import { clampPage, type DocumentOrigin, type StoredDocument } from "./documents";

const FILE = "documents.json";
const DB_NAME = "player-documents";
const DB_STORE = "library";
const DB_KEY = "documents";

function isNative(): boolean {
  return Capacitor.isNativePlatform();
}

// --- IndexedDB (prohlížeč) ---------------------------------------------------

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(DB_STORE)) {
        request.result.createObjectStore(DB_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readWeb(): Promise<StoredDocument[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(DB_STORE, "readonly").objectStore(DB_STORE).get(DB_KEY);
    request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result : []);
    request.onerror = () => reject(request.error);
  });
}

async function writeWeb(documents: StoredDocument[]): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readwrite");
    tx.objectStore(DB_STORE).put(documents, DB_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// --- Filesystem (telefon) ----------------------------------------------------

async function readNative(): Promise<StoredDocument[]> {
  try {
    const res = await Filesystem.readFile({
      path: FILE,
      directory: Directory.Data,
      encoding: Encoding.UTF8,
    });
    const parsed: unknown = JSON.parse(String(res.data));
    return Array.isArray(parsed) ? (parsed as StoredDocument[]) : [];
  } catch {
    // Soubor ještě není - první spuštění po instalaci.
    return [];
  }
}

async function writeNative(documents: StoredDocument[]): Promise<void> {
  await Filesystem.writeFile({
    path: FILE,
    directory: Directory.Data,
    encoding: Encoding.UTF8,
    data: JSON.stringify(documents),
  });
}

// --- rozhraní ----------------------------------------------------------------

/** Poškozený nebo cizí záznam se zahodí, ať knihovna nespadne na jedné položce. */
function sane(raw: unknown): StoredDocument | null {
  if (typeof raw !== "object" || raw === null) return null;
  const doc = raw as Partial<StoredDocument>;
  if (typeof doc.id !== "string" || typeof doc.name !== "string") return null;
  if (!Array.isArray(doc.pages) || doc.pages.length === 0) return null;
  return {
    id: doc.id,
    name: doc.name,
    pages: doc.pages,
    imageOnly: doc.imageOnly === true,
    addedAt: typeof doc.addedAt === "string" ? doc.addedAt : new Date().toISOString(),
    page: clampPage(typeof doc.page === "number" ? doc.page : 0, doc.pages.length),
    bookmarks: Array.isArray(doc.bookmarks)
      ? doc.bookmarks.filter((b): b is number => typeof b === "number")
      : [],
    thumbnail: typeof doc.thumbnail === "string" ? doc.thumbnail : null,
    origin: origin(doc.origin),
    textVersion: typeof doc.textVersion === "number" ? doc.textVersion : 1,
    aspect: typeof doc.aspect === "number" && doc.aspect > 0 ? doc.aspect : null,
  };
}

/** Odkaz na soubor. Záznam z doby před vykreslováním stránek žádný nemá. */
function origin(raw: unknown): DocumentOrigin {
  if (typeof raw !== "object" || raw === null) return { kind: "none" };
  const value = raw as DocumentOrigin;
  if (value.kind === "stored") return { kind: "stored" };
  if (value.kind === "device" && typeof value.uri === "string") return { kind: "device", uri: value.uri };
  return { kind: "none" };
}

async function readAll(): Promise<StoredDocument[]> {
  try {
    const raw = isNative() ? await readNative() : await readWeb();
    return raw.map(sane).filter((d): d is StoredDocument => d !== null);
  } catch {
    return [];
  }
}

/**
 * Seznam se z disku čte jednou za běh appky a dál žije v paměti.
 *
 * Dřív se každá změna (i postup ve čtení) seznam znovu přečetla a celý
 * přepsala. V telefonu to u čtyř knih stálo vteřinu a půl - a dvě takové
 * změny přes sebe se přepisovaly: pomalejší zápis postupu dokázal smazat
 * knihu, kterou jiný zápis zrovna uložil.
 */
let cache: Promise<StoredDocument[]> | null = null;
let writing: Promise<void> = Promise.resolve();
let queued = false;

function load(): Promise<StoredDocument[]> {
  cache ??= readAll();
  return cache;
}

/** Zapisuje vždycky jen jeden; změny, které přijdou mezitím, se svezou dalším zápisem. */
function persist(): Promise<void> {
  if (queued) return writing;
  queued = true;
  writing = writing.then(async () => {
    queued = false;
    const documents = await load();
    try {
      if (isNative()) await writeNative(documents);
      else await writeWeb(documents);
    } catch (error) {
      // Plný disk nebo soukromý režim: dokument dočte aspoň tenhle běh appky.
      // Zapsat se to musí - potichu ztracená kniha vypadá jako chyba appky
      // a nikde se nedá zjistit, že za to může úložiště.
      console.error("Knihovnu dokumentů se nepodařilo uložit", error);
    }
  });
  return writing;
}

function update(change: (documents: StoredDocument[]) => StoredDocument[]): Promise<void> {
  cache = load().then(change);
  return persist();
}

export function listDocuments(): Promise<StoredDocument[]> {
  return load();
}

/** Uloží dokument; existující záznam se stejným id přepíše (a jde nahoru). */
export function saveDocument(document: StoredDocument): Promise<void> {
  return update((documents) => [document, ...documents.filter((d) => d.id !== document.id)]);
}

export function removeDocument(id: string): Promise<void> {
  return update((documents) => documents.filter((d) => d.id !== id));
}

/** Zapíše jen postup ve čtení. Volá se při obracení stránek, takže nezměněný seznam se nepřepisuje. */
export async function saveProgress(id: string, page: number, bookmarks: number[]): Promise<void> {
  const found = (await load()).find((d) => d.id === id);
  if (!found) return;
  const next = clampPage(page, found.pages.length);
  if (found.page === next && found.bookmarks.join() === bookmarks.join()) return;
  await update((documents) => documents.map((d) => (d.id === id ? { ...d, page: next, bookmarks } : d)));
}
