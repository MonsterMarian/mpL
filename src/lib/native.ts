/**
 * Most do nativní vrstvy.
 *
 * Appka běží ve dvou prostředích: v prohlížeči při vývoji a jako Android appka
 * přes Capacitor. Všechno tady je proto podmíněné - v prohlížeči se nic
 * nestane a nic nespadne.
 *
 * Pluginy se importují staticky. Dynamický `await import()` si tahá samostatný
 * JS kus a když ho místní server Capacitoru nenajde, vrátí index.html - skript
 * se "načte", ale je to HTML, kus se nezaregistruje a promise se nikdy
 * nevyřeší. Volání pak visí bez jediné stopy.
 */
import { App } from "@capacitor/app";
import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";
import { SplashScreen } from "@capacitor/splash-screen";
import { StatusBar, Style } from "@capacitor/status-bar";

type CapacitorGlobal = {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
};

function capacitor(): CapacitorGlobal | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
}

export function isNative(): boolean {
  return capacitor()?.isNativePlatform?.() === true;
}

/** Krátké cvaknutí při zaškrtnutí winu - na mobilu, jinak nic. */
export async function tapFeedback(): Promise<void> {
  if (!isNative()) return;
  try {
    await Haptics.impact({ style: ImpactStyle.Light });
  } catch {
    // zařízení bez vibrace - není co řešit
  }
}

/** Delší cvaknutí, když padne microwin. */
export async function winFeedback(): Promise<void> {
  if (!isNative()) return;
  try {
    await Haptics.notification({ type: NotificationType.Success });
  } catch {
    // zařízení bez vibrace
  }
}

/** Stavová lišta v barvě appky, ikony podle světlosti tématu. */
export async function syncStatusBar(dark: boolean): Promise<void> {
  if (!isNative()) return;
  try {
    await StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light });
    await StatusBar.setBackgroundColor({ color: dark ? "#09090B" : "#FDFDFD" });
  } catch {
    // starší Android bez podpory barvy lišty
  }
}

export async function hideSplash(): Promise<void> {
  if (!isNative()) return;
  try {
    await SplashScreen.hide();
  } catch {
    // splash se skryje sám podle launchShowDuration
  }
}

/**
 * Hardwarové tlačítko Zpět. Uvnitř appky jde o krok zpět v historii,
 * na hlavní obrazovce appku ukončí - tak se chová každá Android appka.
 */
export async function registerBackButton(onBack: () => boolean): Promise<() => void> {
  if (!isNative()) return () => {};
  try {
    const handle = await App.addListener("backButton", () => {
      const handled = onBack();
      if (!handled) void App.exitApp();
    });
    return () => void handle.remove();
  } catch {
    return () => {};
  }
}
