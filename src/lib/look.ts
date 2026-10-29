/**
 * Sjednocený vzhled tlačítek, přepínačů a nadpisů.
 *
 * Zkušební přepínač v Nastavení: stará a sjednocená podoba se dají porovnat
 * jedním klepnutím. Samotné styly jsou v `globals.css` pod `[data-look]`.
 */
const KEY = "microwins:unified_look";

export function loadUnifiedLook(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function applyUnifiedLook(on: boolean): void {
  if (on) document.documentElement.dataset.look = "unified";
  else delete document.documentElement.dataset.look;
}

export function saveUnifiedLook(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    // soukromý režim - volba vydrží do zavření appky
  }
  applyUnifiedLook(on);
}
