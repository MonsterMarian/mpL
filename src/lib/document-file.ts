/**
 * Samotný soubor dokumentu.
 *
 * Knihovna si vedle textu drží i PDF - bez něj se stránka nedá vykreslit tak,
 * jak vypadá, a čtečka by zase uměla jen holý text. `documents.json` na to
 * ale není: je to jeden malý seznam, který se přepisuje při každém obrácení
 * stránky, a kniha o padesáti megabajtech v něm nemá co dělat. Každý soubor
 * proto leží zvlášť, pojmenovaný podle id dokumentu.
 *
 * Co leží v telefonu, se **nekopíruje**. Kniha ve složce Stažené je už
 * uložená; druhá kopie v datech appky by jen sežrala místo. U takového
 * dokumentu se drží jen adresa a čte se přímo z ní.
 */
import { Capacitor } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";

const FOLDER = "documents";
const DB_NAME = "player-document-files";
const DB_STORE = "files";

/**
 * Kam až se soubor kopíruje k sobě.
 *
 * Přenos do nativní části jde přes base64, takže si appka velkou knihu na
 * chvíli drží v paměti dvakrát a ještě o třetinu nafouklou. U pár megabajtů
 * je to neznatelné, u sto megabajtů to appku položí.
 */
export const MAX_STORED_BYTES = 48 * 1024 * 1024;

function isNative(): boolean {
  return Capacitor.isNativePlatform();
}

function path(id: string): string {
  return `${FOLDER}/${id.replace(/[^a-z0-9._-]/gi, "_")}.bin`;
}

// --- převody -----------------------------------------------------------------

/**
 * Base64 po kusech.
 *
 * `String.fromCharCode(...bytes)` na celém poli přeteče zásobník už u pár
 * megabajtů - argumenty funkce mají svůj strop a kniha ho spolehlivě překročí.
 */
function toBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = "";
  for (let at = 0; at < bytes.length; at += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(at, at + CHUNK));
  }
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let at = 0; at < binary.length; at += 1) bytes[at] = binary.charCodeAt(at);
  return bytes;
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

async function webWrite(id: string, bytes: Uint8Array): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readwrite");
    tx.objectStore(DB_STORE).put(bytes, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function webRead(id: string): Promise<Uint8Array | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(DB_STORE, "readonly").objectStore(DB_STORE).get(id);
    request.onsuccess = () => {
      const value: unknown = request.result;
      if (value instanceof Uint8Array) resolve(value);
      else if (value instanceof ArrayBuffer) resolve(new Uint8Array(value));
      else resolve(null);
    };
    request.onerror = () => reject(request.error);
  });
}

async function webRemove(id: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readwrite");
    tx.objectStore(DB_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// --- rozhraní ----------------------------------------------------------------

/** Uloží soubor k dokumentu. `false` znamená, že se to nepovedlo. */
export async function saveDocumentFile(id: string, bytes: Uint8Array): Promise<boolean> {
  if (bytes.byteLength > MAX_STORED_BYTES) return false;
  try {
    if (isNative()) {
      await Filesystem.mkdir({ path: FOLDER, directory: Directory.Data, recursive: true }).catch(() => {});
      await Filesystem.writeFile({ path: path(id), directory: Directory.Data, data: toBase64(bytes) });
    } else {
      await webWrite(id, bytes);
    }
    return true;
  } catch {
    // Plný disk nebo soukromý režim. Text dokumentu zůstává, jen se nebude
    // dát vykreslit stránka - a čtečka to pozná podle chybějícího souboru.
    return false;
  }
}

export async function readDocumentFile(id: string): Promise<Uint8Array | null> {
  try {
    if (!isNative()) return await webRead(id);
    const result = await Filesystem.readFile({ path: path(id), directory: Directory.Data });
    return typeof result.data === "string" ? fromBase64(result.data) : null;
  } catch {
    return null;
  }
}

export async function removeDocumentFile(id: string): Promise<void> {
  try {
    if (isNative()) await Filesystem.deleteFile({ path: path(id), directory: Directory.Data });
    else await webRemove(id);
  } catch {
    // Soubor tam nebyl - u dokumentu čteného z telefonu je to normální stav.
  }
}

/**
 * Přečte soubor ležící v telefonu.
 *
 * Adresa z MediaStore přežije restart, takže se knihy nemusí kopírovat. Když
 * uživatel soubor mezitím smazal nebo přesunul, vrátí se `null` a čtečka to
 * řekne - tvářit se, že dokument je v pořádku, by bylo horší.
 */
export async function readFileByUri(uri: string): Promise<Uint8Array | null> {
  try {
    const response = await fetch(Capacitor.isNativePlatform() ? Capacitor.convertFileSrc(uri) : uri);
    if (!response.ok) return null;
    return new Uint8Array(await response.arrayBuffer());
  } catch {
    return null;
  }
}
