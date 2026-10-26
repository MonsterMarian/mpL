import { describe, expect, it, vi } from "vitest";
import type { StoredDocument } from "./documents";

const disk = new Map<string, string>();
const reads = vi.fn();

vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => true } }));
vi.mock("@capacitor/filesystem", () => ({
  Directory: { Data: "DATA" },
  Encoding: { UTF8: "utf8" },
  Filesystem: {
    readFile: async ({ path }: { path: string }) => {
      reads();
      await new Promise((resolve) => setTimeout(resolve, 5));
      if (!disk.has(path)) throw new Error("není");
      return { data: disk.get(path) };
    },
    // Zápis trvá - jako v telefonu, kde se změny dřív přes sebe přepisovaly.
    writeFile: async ({ path, data }: { path: string; data: string }) => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      disk.set(path, data);
    },
  },
}));

const book = (id: string): StoredDocument => ({
  id,
  name: `${id}.pdf`,
  pages: [{ text: "a", label: "Strana 1" }, { text: "b", label: "Strana 2" }],
  imageOnly: false,
  addedAt: "2026-10-26T00:00:00.000Z",
  page: 0,
  bookmarks: [],
  thumbnail: null,
  origin: { kind: "stored" },
  textVersion: 2,
  aspect: null,
});

describe("document-store", () => {
  it("souběžné změny se nepřepíšou a disk se čte jednou", async () => {
    disk.set("documents.json", JSON.stringify([book("stara")]));
    const store = await import("./document-store");

    await Promise.all([store.saveProgress("stara", 1, [1]), store.saveDocument(book("nova"))]);
    await store.saveProgress("stara", 1, [1]);

    const saved = JSON.parse(disk.get("documents.json")!) as StoredDocument[];
    expect(saved.map((d) => d.id).sort()).toEqual(["nova", "stara"]);
    expect(saved.find((d) => d.id === "stara")?.page).toBe(1);
    expect(reads).toHaveBeenCalledTimes(1);
  });
});
