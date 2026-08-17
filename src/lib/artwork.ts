/**
 * Obal skladby z jejího vlastního souboru.
 *
 * Prohlížeč o vloženém obrázku nic neví - ten je schovaný v ID3 tagu (MP3)
 * nebo v obrázkovém bloku (FLAC), takže se musí přečíst ručně z prvních
 * kilobajtů souboru. Čte se jen hlavička, ne celá skladba: tag stojí na
 * začátku a stahovat kvůli obrázku deset megabajtů zvuku nemá smysl.
 *
 * Návratem je `blob:` adresa pro <img>, nebo `null`, když skladba obal nemá.
 * Volající ji musí po dohrání uklidit přes `URL.revokeObjectURL`.
 */

export interface Picture {
  mime: string;
  data: Uint8Array<ArrayBuffer>;
}

/** Strop na velikost tagu, aby jedna nafouklá skladba nezdržela celou knihovnu. */
const MAX_TAG_BYTES = 4 * 1024 * 1024;

export async function readEmbeddedArtwork(file: Blob): Promise<string | null> {
  const picture = await readPicture(file);
  if (!picture) return null;
  return URL.createObjectURL(new Blob([picture.data], { type: picture.mime }));
}

/** Samotné vytažení obrázku, bez adresy pro prohlížeč - odtud se to testuje. */
export async function readPicture(file: Blob): Promise<Picture | null> {
  try {
    const picture = (await readId3Picture(file)) ?? (await readFlacPicture(file));
    return picture && picture.data.length ? picture : null;
  } catch {
    // Poškozený nebo neznámý tag není chyba - skladba prostě obal nemá.
    return null;
  }
}

// --- ID3v2 (MP3) -----------------------------------------------------------

async function readId3Picture(file: Blob): Promise<Picture | null> {
  const head = new Uint8Array(await file.slice(0, 10).arrayBuffer());
  if (head.length < 10 || latin1(head, 0, 3) !== "ID3") return null;

  const major = head[3];
  const tagSize = syncsafe(head, 6);
  if (tagSize <= 0) return null;

  const bytes = new Uint8Array(await file.slice(10, 10 + Math.min(tagSize, MAX_TAG_BYTES)).arrayBuffer());

  let at = 0;
  // Rozšířená hlavička stojí před rámci a svou délku hlásí prvními čtyřmi bajty.
  if (head[5] & 0x40) at += major >= 4 ? syncsafe(bytes, 0) : uint32(bytes, 0) + 4;

  // v2.2 má kratší identifikátory rámců i hlavičku než v2.3 a v2.4.
  const idLength = major === 2 ? 3 : 4;
  const headerLength = major === 2 ? 6 : 10;

  while (at + headerLength <= bytes.length) {
    const id = latin1(bytes, at, idLength);
    // Za posledním rámcem je jen výplň nulami - tam parsování končí.
    if (!/^[A-Z0-9]+$/.test(id)) return null;

    const frameSize =
      major === 2
        ? (bytes[at + 3] << 16) | (bytes[at + 4] << 8) | bytes[at + 5]
        : major >= 4
          ? syncsafe(bytes, at + 4)
          : uint32(bytes, at + 4);

    const body = at + headerLength;
    if (frameSize <= 0 || body + frameSize > bytes.length) return null;

    if (id === "APIC" || id === "PIC") {
      const frame = bytes.subarray(body, body + frameSize);
      const picture = id === "PIC" ? readShortPicture(frame) : readApic(frame);
      if (picture) return picture;
    }

    at = body + frameSize;
  }

  return null;
}

/** APIC (v2.3/v2.4): kódování, MIME, typ obrázku, popis, data. */
function readApic(frame: Uint8Array<ArrayBuffer>): Picture | null {
  if (frame.length < 4) return null;
  const encoding = frame[0];
  const mimeEnd = frame.indexOf(0, 1);
  if (mimeEnd === -1) return null;

  const mime = normalizeMime(latin1(frame, 1, mimeEnd - 1));
  if (!mime) return null;

  const at = skipDescription(frame, mimeEnd + 2, encoding);
  if (at >= frame.length) return null;
  return { mime, data: frame.slice(at) };
}

/** PIC (v2.2): místo MIME jen tříznakový formát typu „JPG". */
function readShortPicture(frame: Uint8Array<ArrayBuffer>): Picture | null {
  if (frame.length < 6) return null;
  const encoding = frame[0];
  const mime = normalizeMime(latin1(frame, 1, 3));
  if (!mime) return null;

  const at = skipDescription(frame, 5, encoding);
  if (at >= frame.length) return null;
  return { mime, data: frame.slice(at) };
}

/**
 * Popis obrázku má proměnnou délku a končí nulou - u UTF-16 dvojicí nul
 * na sudé pozici. Data obrázku začínají hned za ním.
 */
function skipDescription(frame: Uint8Array, at: number, encoding: number): number {
  if (encoding === 1 || encoding === 2) {
    let cursor = at;
    while (cursor + 1 < frame.length && !(frame[cursor] === 0 && frame[cursor + 1] === 0)) cursor += 2;
    return cursor + 2;
  }
  let cursor = at;
  while (cursor < frame.length && frame[cursor] !== 0) cursor += 1;
  return cursor + 1;
}

// --- FLAC ------------------------------------------------------------------

async function readFlacPicture(file: Blob): Promise<Picture | null> {
  const magic = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  if (latin1(magic, 0, 4) !== "fLaC") return null;

  let at = 4;
  // Bloků metadat je v praxi pár; strop drží čtení konečné i u divného souboru.
  for (let block = 0; block < 64; block += 1) {
    const header = new Uint8Array(await file.slice(at, at + 4).arrayBuffer());
    if (header.length < 4) return null;

    const isLast = (header[0] & 0x80) !== 0;
    const type = header[0] & 0x7f;
    const length = (header[1] << 16) | (header[2] << 8) | header[3];

    if (type === 6 && length > 0 && length <= MAX_TAG_BYTES) {
      return readFlacPictureBlock(new Uint8Array(await file.slice(at + 4, at + 4 + length).arrayBuffer()));
    }
    if (isLast) return null;
    at += 4 + length;
  }

  return null;
}

function readFlacPictureBlock(block: Uint8Array<ArrayBuffer>): Picture | null {
  let at = 4;
  const mimeLength = uint32(block, at);
  at += 4;
  const mime = normalizeMime(latin1(block, at, mimeLength));
  at += mimeLength;
  const descriptionLength = uint32(block, at);
  at += 4;
  // Popis a za ním rozměry, barevná hloubka a počet barev - čtyři čísla po 4 B.
  at += descriptionLength + 16;
  const dataLength = uint32(block, at);
  at += 4;

  if (!mime || at + dataLength > block.length) return null;
  return { mime, data: block.slice(at, at + dataLength) };
}

// --- pomocné ---------------------------------------------------------------

function latin1(bytes: Uint8Array, at: number, length: number): string {
  if (length <= 0 || at + length > bytes.length) return "";
  return String.fromCharCode(...bytes.subarray(at, at + length));
}

function syncsafe(bytes: Uint8Array, at: number): number {
  return ((bytes[at] & 0x7f) << 21) | ((bytes[at + 1] & 0x7f) << 14) | ((bytes[at + 2] & 0x7f) << 7) | (bytes[at + 3] & 0x7f);
}

function uint32(bytes: Uint8Array, at: number): number {
  return ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
}

/** `-->` znamená odkaz místo obrázku, starší tagy píšou jen „JPG" / „PNG". */
function normalizeMime(raw: string): string | null {
  const value = raw.trim().toLowerCase();
  if (!value || value === "-->") return null;
  if (value.includes("/")) return value;
  if (value.startsWith("png")) return "image/png";
  if (value.startsWith("jpg") || value.startsWith("jpeg")) return "image/jpeg";
  return `image/${value}`;
}
