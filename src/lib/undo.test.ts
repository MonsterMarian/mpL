import { describe, expect, it } from "vitest";
import { countWord, mergeBack } from "./undo";

const item = (id: string, name = id) => ({ id, name });

describe("mergeBack", () => {
  it("vrátí odebrané na původní místo", () => {
    const snapshot = [item("a"), item("b"), item("c")];
    const current = [item("a"), item("c")];
    expect(mergeBack(snapshot, current, new Set(["b"])).map((x) => x.id)).toEqual(["a", "b", "c"]);
  });

  it("nechá na konci, co mezitím přibylo, a nevzkřísí, co zmizelo jinak", () => {
    const snapshot = [item("a"), item("b"), item("c")];
    const current = [item("c"), item("d")];
    expect(mergeBack(snapshot, current, new Set(["b"])).map((x) => x.id)).toEqual(["b", "c", "d"]);
  });

  it("drží novější podobu položky, která zůstala", () => {
    const snapshot = [item("a", "staré"), item("b")];
    const current = [item("a", "nové")];
    expect(mergeBack(snapshot, current, new Set(["b"]))[0].name).toBe("nové");
  });
});

describe("countWord", () => {
  it("skloňuje podle počtu", () => {
    const forms: [string, string, string] = ["soubor", "soubory", "souborů"];
    expect(countWord(1, forms)).toBe("1 soubor");
    expect(countWord(3, forms)).toBe("3 soubory");
    expect(countWord(5, forms)).toBe("5 souborů");
  });
});
