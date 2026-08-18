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
