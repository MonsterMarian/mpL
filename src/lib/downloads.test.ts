import { describe, expect, it } from "vitest";
import { cleanDownloadUrl, guessFileName, needsResolving, safeFileName, unsupportedSource } from "./downloads";

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
