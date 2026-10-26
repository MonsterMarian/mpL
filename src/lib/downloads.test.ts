import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addDownload,
  cleanDownloadUrl,
  downloadedTrack,
  guessFileName,
  needsResolving,
  safeFileName,
  unsupportedSource,
} from "./downloads";

describe("downloads helper", () => {
  it("cleans standard YouTube watch URL", () => {
    const input = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
    expect(cleanDownloadUrl(input)).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  });

  it("cleans YouTube short URL youtu.be", () => {
    const input = "https://youtu.be/dQw4w9WgXcQ";
    expect(cleanDownloadUrl(input)).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  });

  it("cleans YouTube URL surrounded by shared text and tracking params", () => {
    const input = "Kouknij na tohle: https://youtu.be/dQw4w9WgXcQ?si=abcdef12345&feature=shared!";
    expect(cleanDownloadUrl(input)).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  });

  it("cleans YouTube Shorts and YouTube Music links", () => {
    expect(cleanDownloadUrl("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(cleanDownloadUrl("https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=123")).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  });

  it("correctly identifies links needing resolving", () => {
    expect(needsResolving("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(true);
    expect(needsResolving("https://youtu.be/dQw4w9WgXcQ")).toBe(true);
    expect(needsResolving("https://open.spotify.com/track/123456")).toBe(true);
    expect(needsResolving("https://example.com/song.mp3")).toBe(false);
  });

  it("validates unsupported non-HTTP sources", () => {
    expect(unsupportedSource("not-a-url")).not.toBeNull();
    expect(unsupportedSource("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBeNull();
  });

  it("creates safe filenames for Android file system", () => {
    expect(safeFileName("Karel Gott / Lady Carneval: Live (1968)", "m4a")).toBe("Karel Gott - Lady Carneval Live (1968).m4a");
    expect(safeFileName("  AC/DC - Thunderstruck!*?:<>|  ", "mp3")).toBe("AC-DC - Thunderstruck!.mp3");
  });

  it("guesses filename from direct URL", () => {
    expect(guessFileName("https://example.com/music/sample.mp3")).toBe("sample.mp3");
    expect(guessFileName("https://example.com/stream/file")).toBe("file.mp3");
  });
});

describe("historie stahování", () => {
  const store = new Map<string, string>();
  afterEach(() => {
    store.clear();
    vi.unstubAllGlobals();
  });
  const stubStorage = () =>
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
    });

  /* Selhané stahování zůstane v historii s tlačítkem „Stáhnout znovu“ -
     povedené opakování ho nahradí, nevzniknou dva řádky. */
  it("povedené opakování nahradí řádek, kde stahování selhalo", () => {
    stubStorage();
    addDownload({ url: "https://youtu.be/a", fileName: "A.m4a", at: 1, kind: "audio", failed: true });
    const next = addDownload({ url: "https://youtu.be/a", fileName: "A.m4a", at: 2, kind: "audio" });
    expect(next).toEqual([{ url: "https://youtu.be/a", fileName: "A.m4a", at: 2, kind: "audio" }]);
  });
});

describe("stažená skladba v knihovně", () => {
  const record = { url: "https://youtu.be/a", fileName: "AC-DC - Thunderstruck.m4a", at: 1, kind: "audio" as const };

  it("najde skladbu podle interpreta a názvu, ze kterých vzniklo jméno souboru", () => {
    const track = { title: "Thunderstruck", artist: "AC/DC" };
    expect(downloadedTrack(record, [{ title: "Jiná", artist: "AC/DC" }, track])).toBe(track);
  });

  it("smazanou skladbu nenajde", () => {
    expect(downloadedTrack(record, [{ title: "Highway to Hell", artist: "AC/DC" }])).toBeUndefined();
  });

  it("u přímého odkazu bez interpreta stačí název", () => {
    const direct = { url: "https://example.com/sample.mp3", fileName: "sample.mp3", at: 1 };
    expect(downloadedTrack(direct, [{ title: "sample", artist: "<unknown>" }])).toBeDefined();
  });
});
