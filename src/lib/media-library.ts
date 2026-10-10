import { Capacitor, PluginListenerHandle, registerPlugin } from "@capacitor/core";

/** Progress event vysílaný nativní vrstvou průběžně při stahování a konverzi. */
export interface DownloadProgressEvent {
  /** ID downloadu — odpovídá `id` vrácenému z `download()`. */
  id: string;
  fileName: string;
  /** 0–100 při stahování, -1 při indeterminate konverzi do MP3. */
  progress: number;
  phase: "downloading" | "converting";
}

/** Event vysílaný po úspěšném dokončení stahování. */
export interface DownloadCompleteEvent {
  id: string;
  fileName: string;
  status: "completed";
}

/** Event vysílaný při chybě stahování. */
export interface DownloadErrorEvent {
  id: string;
  fileName: string;
  status: "failed";
  error: string;
}

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
   * Stáhne soubor z přímé adresy. Obstará to systémový DownloadManager, takže
   * stahování přežije i zavřenou appku a hotový soubor se objeví v knihovně.
   */
  download(options: {
    url: string;
    fileName?: string;
    title?: string;
    artist?: string;
  }): Promise<{
    id: string;
    fileName: string;
    /** Appka stahuje sama a ohlásí průběh i konec. Starší APK u videa ne. */
    reportsProgress?: boolean;
  }>;
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
  /** Průběžný progres stahování (0–100 nebo -1 při konverzi). */
  addListener(event: "downloadProgress", handler: (e: DownloadProgressEvent) => void): Promise<PluginListenerHandle>;
  /** Stahování dokončeno — soubor je v telefonu. */
  addListener(event: "downloadComplete", handler: (e: DownloadCompleteEvent) => void): Promise<PluginListenerHandle>;
  /** Stahování selhalo. */
  addListener(event: "downloadError", handler: (e: DownloadErrorEvent) => void): Promise<PluginListenerHandle>;
}

export const MediaLibrary = registerPlugin<MediaLibraryPlugin>("MediaLibrary");

export function canReadDeviceMedia() {
  return Capacitor.isNativePlatform();
}

export function playableMediaSource(source: string) {
  return Capacitor.isNativePlatform() ? Capacitor.convertFileSrc(source) : source;
}
