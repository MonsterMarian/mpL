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

interface MediaLibraryPlugin {
  checkPermission(): Promise<{ granted: boolean }>;
  requestPermission(): Promise<{ granted: boolean }>;
  openAppSettings(): Promise<void>;
  listAudio(): Promise<{ tracks: NativeAudioTrack[] }>;
}

export const MediaLibrary = registerPlugin<MediaLibraryPlugin>("MediaLibrary");

export function canReadDeviceMedia() {
  return Capacitor.isNativePlatform();
}

export function playableMediaSource(source: string) {
  return Capacitor.isNativePlatform() ? Capacitor.convertFileSrc(source) : source;
}
