import { describe, expect, it } from "vitest";
import { isNewerVersion } from "./versions";

describe("porovnání verzí balíku", () => {
  it("novější razítko vyhraje", () => {
    expect(isNewerVersion("2026.08.18.11.10", "2026.08.17.19.46")).toBe(true);
  });

  /* Kvůli tomuhle se appka po instalaci nového APK vracela ke starému balíku:
     porovnávalo se na „jiná verze = novější". */
  it("starší razítko se nenasadí", () => {
    expect(isNewerVersion("2026.08.17.19.46", "2026.08.18.11.10")).toBe(false);
  });

  it("stejná verze není novější", () => {
    expect(isNewerVersion("2026.08.18.11.10", "2026.08.18.11.10")).toBe(false);
  });

  it("čísla se porovnávají jako čísla, ne jako text", () => {
    expect(isNewerVersion("2026.08.18.9.05", "2026.08.18.10.05")).toBe(false);
    expect(isNewerVersion("2026.08.18.10.05", "2026.08.18.9.05")).toBe(true);
  });

  it("kratší verze se doplní nulami", () => {
    expect(isNewerVersion("2026.08.18", "2026.08.18.00.01")).toBe(false);
    expect(isNewerVersion("2026.08.19", "2026.08.18.23.59")).toBe(true);
  });

  it("bez nasazené verze je novější cokoliv", () => {
    expect(isNewerVersion("2026.08.18.11.10", null)).toBe(true);
    expect(isNewerVersion(null, "2026.08.18.11.10")).toBe(false);
  });

  it("nesrozumitelná verze se za novější nepovažuje", () => {
    expect(isNewerVersion("nightly", "2026.08.18.11.10")).toBe(false);
    expect(isNewerVersion("2026.08.18.11.10", "nightly")).toBe(false);
  });
});
