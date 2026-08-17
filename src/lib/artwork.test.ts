import { describe, expect, it } from "vitest";
import { readPicture } from "./artwork";

/**
 * Tagy se tu skládají po bajtech schválně: obrázek v MP3 leží na místě, které
 * určuje kódování popisu a verze tagu, a právě posun o jeden bajt je chyba,
 * kterou by na obrazovce nikdo nepoznal - jen by místo obalu svítila nota.
 */

const IMAGE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x11, 0x22];

function ascii(text: string): number[] {
  return [...text].map((character) => character.charCodeAt(0));
}

function utf16(text: string): number[] {
  // BOM a za ním znaky po dvou bajtech, jak to do popisu píše ID3.
  return [0xff, 0xfe, ...[...text].flatMap((character) => [character.charCodeAt(0), 0])];
}

function big32(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function syncsafe(value: number): number[] {
  return [(value >> 21) & 0x7f, (value >> 14) & 0x7f, (value >> 7) & 0x7f, value & 0x7f];
}

/** Celý „MP3": hlavička tagu, jeden rámec a kus výplně místo zvuku. */
function id3(major: number, frameId: string, body: number[]): Blob {
  const size = major === 2 ? [(body.length >> 16) & 0xff, (body.length >> 8) & 0xff, body.length & 0xff] : big32(body.length);
  const frame = [...ascii(frameId), ...size, ...(major === 2 ? [] : [0, 0]), ...body];
  return new Blob([new Uint8Array([...ascii("ID3"), major, 0, 0, ...syncsafe(frame.length), ...frame, 0xff, 0xfb, 0x90])]);
}

function flac(mime: string, description: string, image: number[]): Blob {
  const block = [
    ...big32(3),
    ...big32(mime.length),
    ...ascii(mime),
    ...big32(description.length),
    ...ascii(description),
    ...big32(600), // šířka
    ...big32(600), // výška
    ...big32(24), // barevná hloubka
    ...big32(0), // počet barev
    ...big32(image.length),
    ...image,
  ];
  // Před obrázkem stojí povinný STREAMINFO, takže se musí přeskočit.
  const streamInfo = [0, 0, 0, 34, ...new Array(34).fill(0)];
  return new Blob([new Uint8Array([...ascii("fLaC"), ...streamInfo, 0x86, (block.length >> 16) & 0xff, (block.length >> 8) & 0xff, block.length & 0xff, ...block])]);
}

describe("readPicture", () => {
  it("najde obal v APIC s popisem v latin1", async () => {
    const body = [0x00, ...ascii("image/png"), 0x00, 0x03, ...ascii("obal"), 0x00, ...IMAGE];
    const picture = await readPicture(id3(3, "APIC", body));

    expect(picture?.mime).toBe("image/png");
    expect([...(picture?.data ?? [])]).toEqual(IMAGE);
  });

  it("najde obal i s popisem v UTF-16", async () => {
    const body = [0x01, ...ascii("image/jpeg"), 0x00, 0x03, ...utf16("obal"), 0x00, 0x00, ...IMAGE];
    const picture = await readPicture(id3(4, "APIC", body));

    expect(picture?.mime).toBe("image/jpeg");
    expect([...(picture?.data ?? [])]).toEqual(IMAGE);
  });

  it("zvládne i prázdný popis", async () => {
    const body = [0x00, ...ascii("image/png"), 0x00, 0x03, 0x00, ...IMAGE];
    const picture = await readPicture(id3(3, "APIC", body));

    expect([...(picture?.data ?? [])]).toEqual(IMAGE);
  });

  it("rozumí staršímu rámci PIC s tříznakovým formátem", async () => {
    const body = [0x00, ...ascii("PNG"), 0x03, ...ascii("obal"), 0x00, ...IMAGE];
    const picture = await readPicture(id3(2, "PIC", body));

    expect(picture?.mime).toBe("image/png");
    expect([...(picture?.data ?? [])]).toEqual(IMAGE);
  });

  it("odkaz na obrázek obalem není", async () => {
    const body = [0x00, ...ascii("-->"), 0x00, 0x03, 0x00, ...ascii("http://priklad.cz/obal.png")];

    await expect(readPicture(id3(3, "APIC", body))).resolves.toBeNull();
  });

  it("skladba bez tagu obal nemá", async () => {
    await expect(readPicture(new Blob([new Uint8Array([0xff, 0xfb, 0x90, 0x64, 0x00])]))).resolves.toBeNull();
  });

  it("tag bez obrázkového rámce obal nemá", async () => {
    await expect(readPicture(id3(3, "TIT2", [0x00, ...ascii("Název")]))).resolves.toBeNull();
  });

  it("najde obal ve FLACu za blokem STREAMINFO", async () => {
    const picture = await readPicture(flac("image/jpeg", "obal", IMAGE));

    expect(picture?.mime).toBe("image/jpeg");
    expect([...(picture?.data ?? [])]).toEqual(IMAGE);
  });
});
