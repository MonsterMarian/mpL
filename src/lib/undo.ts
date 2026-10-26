/** „1 soubor", „3 soubory", „5 souborů" - do otázky, co se smaže. */
export function countWord(count: number, [one, few, many]: [string, string, string]): string {
  return `${count} ${count === 1 ? one : count >= 2 && count <= 4 ? few : many}`;
}
