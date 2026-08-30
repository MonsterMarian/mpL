/**
 * Podoba galerie videí.
 *
 * Jedna mřížka nesedí každé sbírce. U filmů se dvouslovnými názvy je nejlepší
 * velký náhled, u nahrávek z telefonu (`VID_20260830_094301.mp4`) je náhled
 * k ničemu a rozhoduje název s datem, který se do dlaždice nevejde. Proto se
 * podoba vybírá, ne hádá - a volba se drží na disku.
 */
export type VideoLayout = "grid" | "list" | "cinema";

export const VIDEO_LAYOUTS: { id: VideoLayout; label: string; hint: string }[] = [
  { id: "grid", label: "Mřížka", hint: "Dlaždice vedle sebe. Nejvíc videí na obrazovku." },
  { id: "list", label: "Seznam", hint: "Řádky s celým názvem, délkou i velikostí." },
  { id: "cinema", label: "Plátna", hint: "Jeden velký náhled pod druhým, jako plakáty." },
];

const KEY = "microwins:video_layout";

/** Výchozí je mřížka - tak galerie vypadala od začátku. */
export function loadVideoLayout(): VideoLayout {
  try {
    const saved = localStorage.getItem(KEY);
    return VIDEO_LAYOUTS.some((item) => item.id === saved) ? (saved as VideoLayout) : "grid";
  } catch {
    return "grid";
  }
}

export function saveVideoLayout(layout: VideoLayout): void {
  try {
    localStorage.setItem(KEY, layout);
  } catch {
    // soukromý režim - volba vydrží do zavření appky
  }
}
