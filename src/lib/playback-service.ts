import { Capacitor, registerPlugin } from "@capacitor/core";

/**
 * Přehrávání na pozadí.
 *
 * Zvuk hraje ve WebView a ten žije jen tak dlouho jako proces appky. Když se
 * appka odsune na pozadí, je pro Android proces navíc a hudba uprostřed
 * skladby ztichne - nebo se appka po návratu nastartuje od začátku, což
 * vypadá jako pád. Služba v popředí tomu zabrání.
 *
 * V prohlížeči i na starším telefonu bez pluginu se všechno tiše přeskočí:
 * hudba hraje dál, jen bez pojistky.
 */
interface PlaybackPlugin {
  start(options: { title: string; artist: string }): Promise<void>;
  stop(): Promise<void>;
  requestNotifications(): Promise<void>;
}

const Playback = registerPlugin<PlaybackPlugin>("Playback");

let notificationsAsked = false;

export async function keepAlive(title: string, artist: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    // O notifikace se řekne až u prvního přehrání - ptát se na ně hned při
    // startu appky by bylo na nic, uživatel ještě neví proč.
    if (!notificationsAsked) {
      notificationsAsked = true;
      await Playback.requestNotifications().catch(() => {});
    }
    await Playback.start({ title, artist });
  } catch {
    // Starší balík bez pluginu - hudba hraje, jen bez pojistky.
  }
}

export async function releaseKeepAlive(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await Playback.stop();
  } catch {
    // Služba neběží nebo plugin chybí - není co řešit.
  }
}
