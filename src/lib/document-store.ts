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

export async function listDocuments(): Promise<StoredDocument[]> {
  try {
    const raw = isNative() ? await readNative() : await readWeb();
    return raw.map(sane).filter((d): d is StoredDocument => d !== null);
  } catch {
    return [];
  }
}

/** Uloží dokument; existující záznam se stejným id přepíše (a jde nahoru). */
export async function saveDocument(document: StoredDocument): Promise<void> {
  try {
    const rest = (await listDocuments()).filter((d) => d.id !== document.id);
    const next = [document, ...rest];
    if (isNative()) await writeNative(next);
    else await writeWeb(next);
  } catch (error) {
    // Plný disk nebo soukromý režim: dokument dočte aspoň tenhle běh appky.
    // Zapsat se to musí - potichu ztracená kniha vypadá jako chyba appky
    // a nikde se nedá zjistit, že za to může úložiště.
    console.error("Dokument se nepodařilo uložit do knihovny", error);
  }
}

export async function removeDocument(id: string): Promise<void> {
  try {
    const next = (await listDocuments()).filter((d) => d.id !== id);
    if (isNative()) await writeNative(next);
    else await writeWeb(next);
  } catch {
    // viz `saveDocument`
  }
}

/**
 * Zapíše jen postup ve čtení. Volá se při každém obrácení stránky, takže
 * dokument, který se nezměnil, se nepřepisuje celý - jen se mu upraví číslo.
 */
export async function saveProgress(
  id: string,
  page: number,
  bookmarks: number[],
): Promise<void> {
  try {
    const documents = await listDocuments();
    const found = documents.find((d) => d.id === id);
    if (!found) return;
    const next = documents.map((d) =>
      d.id === id ? { ...d, page: clampPage(page, d.pages.length), bookmarks } : d,
    );
    if (isNative()) await writeNative(next);
    else await writeWeb(next);
  } catch {
    // viz `saveDocument`
  }
}
