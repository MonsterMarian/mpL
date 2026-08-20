import { Capacitor, registerPlugin } from "@capacitor/core";

export interface NativeAudioTrack {
  id: string;
  title: string;
  artist: string;
  album: string;
  durationSeconds: number;
  src: string;
  mimeType: string;
  /** Obal alba z MediaStore. Chybí, když ho album nemá. */
  artwork?: string | null;
  /** Kdy soubor přibyl do zařízení, v milisekundách. */
  addedAt?: number;
}

/** Video ze zařízení. Stejná cesta jako u hudby, jen jiná tabulka MediaStore. */
export interface NativeVideo {
  id: string;
  title: string;
  fileName: string;
  durationSeconds: number;
  sizeBytes: number;
  src: string;
  addedAt: number;
  mimeType: string;
}

/** Dokument nalezený v telefonu - ještě nerozebraný, jen položka v seznamu. */
export interface NativeDocument {
  id: string;
  name: string;
  uri: string;
  sizeBytes: number;
  addedAt: number;
  mimeType: string;
  /** Složka, ve které leží - `Download`, `Documents/knihy`… */
  folder: string;
}

interface MediaLibraryPlugin {
  checkPermission(): Promise<{ granted: boolean }>;
  requestPermission(): Promise<{ granted: boolean }>;
  openAppSettings(): Promise<void>;
  listAudio(): Promise<{ tracks: NativeAudioTrack[] }>;
  /**
   * Smaže soubory ze zařízení. Od Androidu 11 se ptá systém vlastním oknem -
   * proto se posílají všechna id naráz, aby se ptal jednou - a `deleted: false`
   * znamená „uživatel to odklikl pryč", ne chybu.
   */
  deleteAudio(options: { ids: string[] }): Promise<{ deleted: boolean }>;
  /**
   * Otevře soubor v jiné aplikaci. WebView umí jen webové kodeky, takže
   * u filmů (MKV, AC3) je tohle jediná cesta, jak je přehrát.
   */
  openExternally(options: { uri: string; mimeType?: string }): Promise<void>;
  /**
   * Stáhne soubor z přímé adresy. Obstará to systémový DownloadManager, takže
   * stahování přežije i zavřenou appku a hotový soubor se objeví v knihovně.
   */
  download(options: { url: string; fileName?: string }): Promise<{ id: string; fileName: string }>;
  /**
   * Dokumenty v telefonu (PDF, EPUB, TXT). Chce to „přístup ke všem souborům" -
   * PDF nejsou z pohledu Androidu média, takže je povolení k hudbě nekryje.
   */
  listDocuments(): Promise<{ granted: boolean; documents: NativeDocument[] }>;
  /** Obálka dokumentu - první stránka PDF jako data URI. */
  documentThumbnail(options: { uri: string }): Promise<{ thumbnail: string | null; pages?: number }>;
  checkAllFilesAccess(): Promise<{ granted: boolean }>;
  requestAllFilesAccess(): Promise<void>;
  /** Náhled videa jako data URI. `null`, když ho MediaStore nemá. */
  videoThumbnail(options: { id: string }): Promise<{ thumbnail: string | null }>;
  /**
   * Video se od Androidu 13 povoluje zvlášť od hudby, takže má vlastní
   * dvojici check/request - jinak by si appka řekla o obojí naráz i u toho,
   * kdo video vůbec nezapnul.
   */
  checkVideoPermission(): Promise<{ granted: boolean }>;
  requestVideoPermission(): Promise<{ granted: boolean }>;
  listVideo(): Promise<{ videos: NativeVideo[] }>;
}

export const MediaLibrary = registerPlugin<MediaLibraryPlugin>("MediaLibrary");

export function canReadDeviceMedia() {
  return Capacitor.isNativePlatform();
}

export function playableMediaSource(source: string) {
  return Capacitor.isNativePlatform() ? Capacitor.convertFileSrc(source) : source;
}
