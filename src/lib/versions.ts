/**
 * Porovnání verzí balíků.
 *
 * Verze je časové razítko `RRRR.MM.DD.HH.mm` z `scripts/release.mjs`. Zvlášť
 * od `live-update.ts`, aby šlo pravidlo otestovat bez Capacitoru - a protože
 * právě tady se rozhoduje, jestli si appka nepřepíše novější verzi starší.
 */

/** Verze webu zabalená v APK. Vypéká ji `scripts/release.mjs` do buildu. */
export function bundledVersion(): string | null {
  return process.env.NEXT_PUBLIC_BUNDLE_VERSION ?? null;
}

/**
 * Je `candidate` novější než `current`?
 *
 * Porovnává se po číslech mezi tečkami, ne řetězcem. Nesrozumitelná verze
 * (písmena, prázdno) se schválně nepovažuje za novější: aktualizace, o které
 * se neví, jestli je krok vpřed, se nemá nasazovat vůbec.
 */
export function isNewerVersion(candidate: string | null, current: string | null): boolean {
  if (!candidate) return false;
  if (!current) return true;
  if (candidate === current) return false;

  const parse = (value: string) => value.trim().split(".").map((part) => Number(part));
  const left = parse(candidate);
  const right = parse(current);
  if ([...left, ...right].some((part) => !Number.isFinite(part))) return false;

  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    if (a !== b) return a > b;
  }
  return false;
}
