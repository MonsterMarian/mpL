import { describe, expect, it } from "vitest";
import { countWord } from "./undo";

describe("countWord", () => {
  it("skloňuje podle počtu", () => {
    const forms: [string, string, string] = ["soubor", "soubory", "souborů"];
    expect(countWord(1, forms)).toBe("1 soubor");
    expect(countWord(3, forms)).toBe("3 soubory");
    expect(countWord(5, forms)).toBe("5 souborů");
  });
});
