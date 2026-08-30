import { describe, expect, it } from "vitest";
import { searchPages, textFromContent } from "./pdf";

/**
 * Text stránky a textová vrstva musí vzniknout jedním pravidlem - na tom stojí
 * zvýraznění čtené věty. Tyhle testy hlídají právě to pravidlo.
 */
describe("textFromContent", () => {
  it("lepí kusy za sebe a zalomí řádek u toho, který ho končí", () => {
    const built = textFromContent({
      items: [
        { str: "Ahoj", hasEOL: false },
        { str: " světe", hasEOL: true },
        { str: "druhý řádek", hasEOL: false },
      ],
    });
    expect(built.text).toBe("Ahoj světe\ndruhý řádek");
  });

  it("pozice kusů ukazují do složeného textu", () => {
    const built = textFromContent({
      items: [
        { str: "Ahoj", hasEOL: false },
        { str: " světe", hasEOL: true },
        { str: "dál", hasEOL: false },
      ],
    });
    expect(built.spans).toHaveLength(3);
    expect(built.text.slice(built.spans[1].start, built.spans[1].end)).toBe(" světe");
    // Zalomení patří mezi kusy, ne do žádného z nich.
    expect(built.text.slice(built.spans[2].start, built.spans[2].end)).toBe("dál");
  });

  it("značky struktury bez textu se přeskočí, ať indexy sedí na vrstvu", () => {
    const built = textFromContent({
      items: [{ type: "beginMarkedContent" }, { str: "text", hasEOL: false }, { type: "endMarkedContent" }],
    });
    expect(built.spans).toHaveLength(1);
    expect(built.text).toBe("text");
  });

  it("prázdný kus zabírá místo v seznamu, ale ne v textu", () => {
    const built = textFromContent({ items: [{ str: "" }, { str: "a" }] });
    expect(built.spans).toHaveLength(2);
    expect(built.spans[0]).toEqual({ start: 0, end: 0 });
    expect(built.text).toBe("a");
  });
});

describe("searchPages", () => {
  const pages = ["Příliš žluťoučký kůň úpěl ďábelské ódy.", "Kůň se vrátil. Další kůň taky."];

  it("najde výskyt bez ohledu na diakritiku a velikost písmen", () => {
    const hits = searchPages(pages, "KUN");
    expect(hits.map((hit) => hit.page)).toEqual([0, 1, 1]);
  });

  it("pozice ukazují do původního textu, ne do zjednodušeného", () => {
    const [first] = searchPages(pages, "kun");
    expect(pages[first.page].slice(first.start, first.end)).toBe("kůň");
  });

  it("kratší dotaz než dva znaky se nehledá", () => {
    expect(searchPages(pages, "k")).toEqual([]);
  });

  it("náhled ukáže okolí nálezu", () => {
    const [first] = searchPages(pages, "ďábelské");
    expect(first.preview).toContain("ďábelské");
  });
});
