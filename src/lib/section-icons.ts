/**
 * Ikony sekcí.
 *
 * Vybrat ikonu appky za uživatele je střelba naslepo - co jednomu sedí, druhý
 * nesnáší. Sekce proto nabízí pár tvarů a volba se drží na disku. Výchozí jsou
 * ty, se kterými appka jezdila od začátku.
 */
export type SectionId = "library" | "reader" | "video" | "downloads";

export type SectionIconId =
  | "library"
  | "music"
  | "disc"
  | "headphones"
  | "audio-lines"
  | "radio"
  | "list-music"
  | "cassette"
  | "book-open-text"
  | "book"
  | "file-text"
  | "notebook"
  | "book-marked"
  | "book-text"
  | "newspaper"
  | "scroll-text"
  | "film"
  | "video"
  | "clapperboard"
  | "monitor-play"
  | "tv"
  | "popcorn"
  | "circle-play"
  | "videotape"
  | "download"
  | "arrow-down-to-line"
  | "cloud-download"
  | "inbox"
  | "hard-drive-download"
  | "folder-down"
  | "circle-arrow-down"
  | "package-open";

export interface SectionIconChoice {
  id: SectionIconId;
  label: string;
}

/** Co si jde vybrat, sekce po sekci. První v řadě je výchozí. */
export const SECTION_ICONS: Record<SectionId, SectionIconChoice[]> = {
  library: [
    { id: "library", label: "Police" },
    { id: "music", label: "Nota" },
    { id: "disc", label: "Deska" },
    { id: "headphones", label: "Sluchátka" },
    { id: "audio-lines", label: "Vlna" },
    { id: "radio", label: "Rádio" },
    { id: "list-music", label: "Seznam" },
    { id: "cassette", label: "Kazeta" },
  ],
  reader: [
    { id: "book-open-text", label: "Otevřená kniha" },
    { id: "book", label: "Kniha" },
    { id: "file-text", label: "Stránka" },
    { id: "notebook", label: "Sešit" },
    { id: "book-marked", label: "Kniha se záložkou" },
    { id: "book-text", label: "Kniha s textem" },
    { id: "newspaper", label: "Noviny" },
    { id: "scroll-text", label: "Svitek" },
  ],
  video: [
    { id: "film", label: "Filmový pás" },
    { id: "video", label: "Kamera" },
    { id: "clapperboard", label: "Klapka" },
    { id: "monitor-play", label: "Obrazovka" },
    { id: "tv", label: "Televize" },
    { id: "popcorn", label: "Popcorn" },
    { id: "circle-play", label: "Přehrát" },
    { id: "videotape", label: "Videokazeta" },
  ],
  downloads: [
    { id: "download", label: "Šipka do složky" },
    { id: "arrow-down-to-line", label: "Šipka k čáře" },
    { id: "cloud-download", label: "Mrak" },
    { id: "inbox", label: "Schránka" },
    { id: "hard-drive-download", label: "Disk" },
    { id: "folder-down", label: "Složka" },
    { id: "circle-arrow-down", label: "Šipka v kolečku" },
    { id: "package-open", label: "Balík" },
  ],
};

export type SectionIcons = Record<SectionId, SectionIconId>;

const STORAGE_KEY = "microwins:section_icons";

export function defaultSectionIcons(): SectionIcons {
  return {
    library: SECTION_ICONS.library[0].id,
    reader: SECTION_ICONS.reader[0].id,
    video: SECTION_ICONS.video[0].id,
    downloads: SECTION_ICONS.downloads[0].id,
  };
}

export function loadSectionIcons(): SectionIcons {
  const fallback = defaultSectionIcons();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return fallback;
    const stored = parsed as Partial<SectionIcons>;
    const pick = (section: SectionId) =>
      SECTION_ICONS[section].some((choice) => choice.id === stored[section])
        ? (stored[section] as SectionIconId)
        : fallback[section];
    return {
      library: pick("library"),
      reader: pick("reader"),
      video: pick("video"),
      downloads: pick("downloads"),
    };
  } catch {
    return fallback;
  }
}

export function saveSectionIcons(icons: SectionIcons): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(icons));
  } catch {
    // soukromý režim - volba vydrží do zavření appky
  }
}
