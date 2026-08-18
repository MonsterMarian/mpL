import { describe, expect, it } from "vitest";
import {
  appendToQueue,
  buildQueue,
  dropFromQueue,
  filterTracks,
  formatTotal,
  groupByAlbum,
  groupByArtist,
  insertNext,
  nextTrackId,
  previousTrackId,
  reshuffleQueue,
  sortTracks,
  trackCountLabel,
  upcomingIds,
  type PlayStats,
  type Track,
} from "./library";

const track = (id: string, extra: Partial<Track> = {}): Track => ({
  id,
  title: id,
  artist: "Interpret",
  album: "Album",
  duration: "3:00",
  durationSeconds: 180,
  src: `file://${id}.mp3`,
  artwork: null,
  addedAt: 0,
  source: "device",
  ...extra,
});

const queueOf = (...ids: string[]) => ({ ids, base: ids });

describe("výběr skladeb", () => {
  const tracks = [
    track("a", { title: "Ráno", artist: "Kapela", album: "První" }),
    track("b", { title: "Večer", artist: "Jiná kapela", album: "Druhé", source: "local" }),
  ];

  it("hledá napříč názvem, interpretem i albem", () => {
    expect(filterTracks(tracks, "jiná", "all", new Set()).map((t) => t.id)).toEqual(["b"]);
    expect(filterTracks(tracks, "první", "all", new Set()).map((t) => t.id)).toEqual(["a"]);
  });

  it("filtr oblíbených bere jen zaškrtnuté", () => {
    expect(filterTracks(tracks, "", "liked", new Set(["b"])).map((t) => t.id)).toEqual(["b"]);
  });

  it("filtr vlastních souborů nechá jen ručně přidané", () => {
    expect(filterTracks(tracks, "", "local", new Set()).map((t) => t.id)).toEqual(["b"]);
  });
});

describe("řazení", () => {
  const stats: PlayStats = { a: { count: 1, at: 300 }, b: { count: 9, at: 100 } };
  const tracks = [
    track("a", { title: "Bbb", addedAt: 20, durationSeconds: 60 }),
    track("b", { title: "Aaa", addedAt: 10, durationSeconds: 90 }),
  ];

  it("naposledy hrané jde podle času, nejposlouchanější podle počtu", () => {
    expect(sortTracks(tracks, "recent", stats).map((t) => t.id)).toEqual(["a", "b"]);
    expect(sortTracks(tracks, "played", stats).map((t) => t.id)).toEqual(["b", "a"]);
  });

  it("při shodě rozhoduje název, ať seznam neposkakuje", () => {
    const same = [track("x", { title: "Bbb" }), track("y", { title: "Aaa" })];
    expect(sortTracks(same, "played", {}).map((t) => t.id)).toEqual(["y", "x"]);
  });

  it("řazení původní pole nepřepisuje", () => {
    const input = [...tracks];
    sortTracks(input, "title", {});
    expect(input.map((t) => t.id)).toEqual(["a", "b"]);
  });
});

describe("alba a interpreti", () => {
  const tracks = [
    track("a", { album: "První", artist: "Kapela", artwork: null }),
    track("b", { album: "První", artist: "Kapela", artwork: "art://1" }),
    track("c", { album: "Druhé", artist: "Někdo jiný" }),
  ];

  it("album sbírá své skladby a obal prvního kusu, který ho má", () => {
    const albums = groupByAlbum(tracks);
    expect(albums.map((a) => a.key)).toEqual(["Druhé", "První"]);
    expect(albums[1].trackIds).toEqual(["a", "b"]);
    expect(albums[1].artwork).toBe("art://1");
    expect(albums[1].subtitle).toBe("Kapela");
  });

  it("album od víc interpretů se tak i jmenuje", () => {
    const mixed = groupByAlbum([track("a", { artist: "X" }), track("b", { artist: "Y" })]);
    expect(mixed[0].subtitle).toBe("Různí interpreti");
  });

  it("interpret ukazuje, kolik toho v knihovně má", () => {
    expect(groupByArtist(tracks).map((a) => a.subtitle)).toEqual(["2 skladby", "1 skladba"]);
  });
});

describe("fronta", () => {
  it("další a předchozí jdou po pořadí fronty", () => {
    const queue = queueOf("a", "b", "c");
    expect(nextTrackId(queue, "a", false)).toBe("b");
    expect(previousTrackId(queue, "b")).toBe("a");
  });

  /* Doběhnutá skladba na konci fronty se ptá opakování (wrap = false),
     stisk tlačítka vpřed se vrací na začátek vždycky. */
  it("konec fronty: doběhnutí končí, tlačítko vpřed se vrátí na začátek", () => {
    const queue = queueOf("a", "b");
    expect(nextTrackId(queue, "b", false)).toBeNull();
    expect(nextTrackId(queue, "b", true)).toBe("a");
  });

  it("předchozí ze začátku skočí na konec", () => {
    expect(previousTrackId(queueOf("a", "b"), "a")).toBe("b");
  });

  it("skladba mimo frontu pokračuje jejím začátkem", () => {
    expect(nextTrackId(queueOf("a", "b"), "mimo", false)).toBe("a");
  });

  it("prázdná fronta nikam nevede", () => {
    expect(nextTrackId({ ids: [], base: [] }, "a", true)).toBeNull();
  });

  it("náhodné pořadí nechá rozehranou skladbu první a nikoho neztratí", () => {
    const queue = buildQueue(["a", "b", "c", "d"], "c", true);
    expect(queue.ids[0]).toBe("c");
    expect([...queue.ids].sort()).toEqual(["a", "b", "c", "d"]);
    expect(queue.base).toEqual(["a", "b", "c", "d"]);
  });

  it("vypnuté náhodné pořadí vrátí původní řadu", () => {
    const shuffle = buildQueue(["a", "b", "c"], "b", true);
    expect(reshuffleQueue(shuffle, "b", false).ids).toEqual(["a", "b", "c"]);
  });

  it("přehrát jako další sedí hned za rozehranou skladbu", () => {
    expect(insertNext(queueOf("a", "b", "c"), ["c"], "a").ids).toEqual(["a", "c", "b"]);
  });

  it("přidat do fronty jde na konec a neduplikuje", () => {
    expect(appendToQueue(queueOf("a", "b"), ["a", "c"], "b").ids).toEqual(["b", "a", "c"]);
  });

  it("smazaná skladba zmizí i z náhodného pořadí i z původní řady", () => {
    const queue = dropFromQueue({ ids: ["c", "a", "b"], base: ["a", "b", "c"] }, "a");
    expect(queue.ids).toEqual(["c", "b"]);
    expect(queue.base).toEqual(["b", "c"]);
  });

  it("na řadě je jen to, co teprve přijde", () => {
    expect(upcomingIds(queueOf("a", "b", "c"), "a")).toEqual(["b", "c"]);
    expect(upcomingIds(queueOf("a", "b"), "b")).toEqual([]);
  });
});

describe("popisky", () => {
  it("skloňování počtu skladeb", () => {
    expect(trackCountLabel(1)).toBe("1 skladba");
    expect(trackCountLabel(3)).toBe("3 skladby");
    expect(trackCountLabel(12)).toBe("12 skladeb");
  });

  it("souhrn délky mluví v hodinách, dokud je z čeho", () => {
    expect(formatTotal(0)).toBeNull();
    expect(formatTotal(600)).toBe("10 min");
    expect(formatTotal(3600)).toBe("1 h");
    expect(formatTotal(5400)).toBe("1 h 30 min");
  });
});
