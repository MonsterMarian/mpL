import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Nativní obal appky. `webDir` je statický export z `next build`.
 * Appka běží offline ze souborů v telefonu, žádný server.
 */
const config: CapacitorConfig = {
  appId: "cz.player.app",
  appName: "P/_ayer",
  webDir: "out",
  android: {
    // Vlastní pozadí, ať mezi splash screenem a appkou neprobleskne bílá.
    backgroundColor: "#09090B",
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 600,
      launchAutoHide: true,
      backgroundColor: "#09090B",
      androidSplashResourceName: "splash",
      androidScaleType: "CENTER_CROP",
      showSpinner: false,
    },
    StatusBar: {
      style: "DARK",
      backgroundColor: "#09090B",
    },
    // Android 15+ kreslí edge-to-edge. Capacitor pak vstřikuje
    // --safe-area-inset-*, na které sahá globals.css.
    SystemBars: {
      insetsHandling: "css",
    },
  },
};

export default config;
