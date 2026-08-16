import { describe, expect, it } from "vitest";
import {
  buildTextPages,
  clampPage,
  documentId,
  EMPTY_PAGE_TEXT,
  hasReadableText,
  isImageOnly,
  pageText,
  speechChunks,
  type DocumentPage,
} from "./documents";

const page = (text: string, label = "Strana"): DocumentPage => ({ text, label });

describe("obrázkový dokument", () => {
  it("naskenované PDF se pozná podle prázdných stránek", () => {
    expect(isImageOnly([page(""), page("  "), page("12")])).toBe(true);
  });

  it("dokument s textovou vrstvou obrázkový není", () => {
    expect(isImageOnly([page(""), page("Tohle je čitelný odstavec textu.")])).toBe(false);
  });

  it("prázdný seznam stránek se za obrázkový nevydává", () => {
    expect(isImageOnly([])).toBe(false);
  });

  /* Číslo stránky a pár znaků z hlavičky má i naskenovaná kniha - kdyby se to
     počítalo jako text, tvářila by se jako čitelná a nabídla by čtení nahlas. */
  it("pár zbloudilých znaků se za text nepočítá", () => {
    expect(hasReadableText("12")).toBe(false);
    expect(hasReadableText("Tohle je věta, která se dá přečíst.")).toBe(true);
  });

  it("stránka bez textu dostane hlášku místo prázdna", () => {
    expect(pageText("  ")).toBe(EMPTY_PAGE_TEXT);
    expect(pageText("Tohle je čitelný odstavec.")).toBe("Tohle je čitelný odstavec.");
  });
});

describe("stránkování textového souboru", () => {
  it("dlouhý text se rozseká po zadané délce", () => {
    const pages = buildTextPages("abcdefghij", 4);

    expect(pages.map((p) => p.text)).toEqual(["abcd", "efgh", "ij"]);
    expect(pages[2].label).toBe("Část 3");
  });

  it("prázdný soubor nemá stránky", () => {
    expect(buildTextPages("")).toEqual([]);
  });
});

describe("zapamatovaná stránka", () => {
  it("stejný soubor dostane stejné id", () => {
    expect(documentId("Kniha 2. díl.pdf", 1024)).toBe(documentId("Kniha 2. díl.pdf", 1024));
  });

  it("jiná velikost je jiný dokument", () => {
    expect(documentId("kniha.pdf", 10)).not.toBe(documentId("kniha.pdf", 11));
  });

  /* Uložená stránka může být z delší verze souboru - čtečka by pak sáhla
     mimo pole a ukázala prázdno. */
  it("stránka mimo rozsah spadne na poslední", () => {
    expect(clampPage(99, 5)).toBe(4);
    expect(clampPage(-3, 5)).toBe(0);
    expect(clampPage(2, 0)).toBe(0);
    expect(clampPage(Number.NaN, 5)).toBe(0);
  });
});

describe("kusy k předčítání", () => {
  it("text se dělí po větách", () => {
    expect(speechChunks("První věta. Druhá věta!", 20)).toEqual(["První věta.", "Druhá věta!"]);
  });

  it("krátké věty se spojí do jednoho kusu", () => {
    expect(speechChunks("Ano. Ne.", 200)).toEqual(["Ano. Ne."]);
  });

  it("věta delší než limit se rozseká natvrdo", () => {
    const chunks = speechChunks("a".repeat(50), 20);

    expect(chunks).toHaveLength(3);
    expect(chunks.join("")).toBe("a".repeat(50));
  });

  it("prázdný text se nečte", () => {
    expect(speechChunks("   \n  ")).toEqual([]);
  });

  /* Dělení smí posunout mezery (dlouhá věta se láme natvrdo), ale ani jedno
     písmeno nesmí zmizet nebo se zopakovat - jinak by se něco nepřečetlo. */
  it("žádné písmeno se neztratí ani nezdvojí", () => {
    const text = "Jedna věta. Druhá věta je delší a pokračuje dál. Třetí!";
    const bare = (value: string) => value.replace(/\s+/g, "");

    expect(bare(speechChunks(text, 30).join(""))).toBe(bare(text));
  });
});
