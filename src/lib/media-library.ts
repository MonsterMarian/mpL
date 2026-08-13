import { Capacitor, registerPlugin } from "@capacitor/core";

export interface NativeAudioTrack {
  id: string;
  title: string;
  artist: string;
  album: string;
  durationSeconds: number;
  src: string;
  mimeType: string;
}

interface MediaLibraryPlugin {
  checkPermission(): Promise<{ granted: boolean }>;
  requestPermission(): Promise<{ granted: boolean }>;
  listAudio(): Promise<{ tracks: NativeAudioTrack[] }>;
}

export const MediaLibrary = registerPlugin<MediaLibraryPlugin>("MediaLibrary");

export function canReadDeviceMedia() {
  return Capacitor.isNativePlatform();
}

export function playableMediaSource(source: string) {
  return Capacitor.isNativePlatform() ? Capacitor.convertFileSrc(source) : source;
}
