/**
 * Mazání s možností vrátit.
 *
 * Co jde vzít zpátky (odebrání z knihovny appky, soubor smazaný přímo appkou),
 * se neptá „opravdu?" - zmizí hned a hláška nabídne „Vrátit". Doopravdy se
 * smaže, až hláška odejde. Soubory hudby a filmů z telefonu jdou jinudy:
 * potvrzuje je Android vlastním oknem a to je jediná otázka.
 */

/** Jak dlouho jde smazání vrátit. Tak dlouho visí i hláška. */
export const UNDO_MS = 6000;

/**
 * Vrátí odebrané položky na jejich původní místo. Co mezitím přibylo, zůstane
 * na konci; co se mezitím změnilo, zůstane v nové podobě.
 */
export function mergeBack<T extends { id: string }>(snapshot: T[], current: T[], back: ReadonlySet<string>): T[] {
  const now = new Map(current.map((item) => [item.id, item]));
  const ordered = snapshot
    .filter((item) => now.has(item.id) || back.has(item.id))
    .map((item) => now.get(item.id) ?? item);
  const placed = new Set(ordered.map((item) => item.id));
  return [...ordered, ...current.filter((item) => !placed.has(item.id))];
}

/** „1 soubor", „3 soubory", „5 souborů" - do hlášky o tom, co zmizelo. */
export function countWord(count: number, [one, few, many]: [string, string, string]): string {
  return `${count} ${count === 1 ? one : count >= 2 && count <= 4 ? few : many}`;
}
