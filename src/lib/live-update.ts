import { WebView } from "@capacitor/core";
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import { isNative } from "./native";
import { bundledVersion, isNewerVersion } from "./versions";

/**
 * Živé aktualizace.
 *
 * Celá appka je hromada statických souborů, které Capacitor servíruje
 * z telefonu. Když se ty soubory vymění, po restartu běží nová verze -
 * bez instalace APK. Nativní část (pluginy, ikona, oprávnění) se takhle
 * vyměnit nedá, na tu je potřeba nové APK.
 *
 * Průběh:
 *   start appky -> nasadí se balík stažený minule -> na pozadí se zkontroluje,
 *   jestli není novější -> stáhne se a nasadí až při dalším startu
 *
 * Nasazuje se schválně až při dalším startu, ne hned: přepnutí za běhu by
 * uživateli zmizela obrazovka pod rukama. Data zůstávají, localStorage patří
 * k adrese `localhost`, kterou výměna souborů nemění.
 */

const URL_KEY = "microwins:ota:url";
const CURRENT_KEY = "microwins:ota:current";
const PENDING_KEY = "microwins:ota:pending";
const BOOTING_KEY = "microwins:ota:booting";

/**
 * Soubory balíku: cesta -> obsah.
 *
 * Text se veze rovnou, binární soubory (obrázky) v base64 - jinak se cestou
 * rozbijí. Starší balíky značku nemají a jsou celé textové, proto je volitelná.
 */
export interface BundleFile {
  path: string;
  content: string;
  encoding?: "base64";
}

export interface UpdateManifest {
  version: string;
  /** Adresa souboru s balíkem. Může být relativní k manifestu. */
  bundle: string;
  notes?: string;
  /** Minimální versionCode APK, kterou balík potřebuje (nepovinné). */
  minAppVersion?: number;
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // soukromý režim - aktualizace se prostě nebude pamatovat
  }
}

/**
 * Odkud se berou aktualizace, když si uživatel nenastaví nic vlastního.
 * Je to natvrdo v kódu schválně: appka se má aktualizovat sama a uživatel
 * o tom nemusí vědět.
 *
 * Přes API, ne přes `raw.githubusercontent.com`: raw drží soubor pět minut
 * v keši a query parametry z klíče keše zahazuje, takže se čerstvost nedá
 * vynutit. API vrací aktuální stav hned. Když API selže (výpadek, limit
 * dotazů), zkusí se raw jako záložní cesta - pomalejší, ale funguje.
 */
export const DEFAULT_UPDATE_URL =
  "https://api.github.com/repos/MonsterMarian/mpL/contents/ota/latest.json?ref=main";

const FALLBACK_UPDATE_URL =
  "https://raw.githubusercontent.com/MonsterMarian/mpL/main/ota/latest.json";

export function getUpdateUrl(): string {
  return read(URL_KEY) ?? DEFAULT_UPDATE_URL;
}

export function setUpdateUrl(url: string): void {
  const trimmed = url.trim();
  // Výchozí adresu neukládáme - když se v budoucím buildu změní, ať se
  // uložená hodnota nepere s novou.
  write(URL_KEY, !trimmed || trimmed === DEFAULT_UPDATE_URL ? null : trimmed);
}

/**
 * Verze, která právě běží.
 *
 * Když se ještě nic nestáhlo, platí verze zabalená v APK - vypéká ji
 * `scripts/release.mjs` do buildu. Bez toho by si čerstvě nainstalovaná
 * appka pokaždé stáhla balík, který už uvnitř má.
 */
export function currentBundleVersion(): string | null {
  return read(CURRENT_KEY) ?? bundledVersion();
}

/**
 * Zahodí záznam o balíku, který je starší než web zabalený v APK.
 *
 * Do telefonu se mezitím nainstalovala novější appka a ta má vyhrát. Bez
 * tohohle si appka po instalaci nového APK při prvním startu sama nasadí
 * starý balík a všechny novinky zmizí - přesně to se stalo 18. 8. 2026.
 * Vrací verzi, se kterou se smí dál počítat.
 */
function withoutStale(key: string, version: string | null): string | null {
  if (!version) return null;
  const apk = bundledVersion();
  if (!apk || isNewerVersion(version, apk)) return version;
  write(key, null);
  return null;
}

export function pendingBundleVersion(): string | null {
  const raw = read(PENDING_KEY);
  if (!raw) return null;
  try {
    return (JSON.parse(raw) as { version: string }).version;
  } catch {
    return null;
  }
}

/*
 * Pluginy se importují staticky, ne přes `await import()`.
 *
 * Dynamický import si tahá samostatný JS kus přes <script>. Když ho místní
 * server Capacitoru nenajde a vrátí místo něj index.html, skript se "načte"
 * úspěšně, jenže je to HTML - kus se nezaregistruje a promise se nikdy
 * nevyřeší ani neodmítne. Nasazení pak viselo bez jediné stopy.
 *
 * Ušetřené kilobajty za to nestojí.
 */

/**
 * Balík z APK, ke kterému se dá vždycky vrátit.
 *
 * Záznamy se přepisují jako první: `setServerBasePath` se nedočká odpovědi
 * (viz `applyPendingUpdate`), takže na něj nečekáme a rovnou překreslíme.
 */
export async function revertToBundled(): Promise<void> {
  if (!isNative()) return;
  write(CURRENT_KEY, null);
  write(PENDING_KEY, null);
  write(BOOTING_KEY, null);
  void WebView.setServerBasePath({ path: "" });
  void WebView.persistServerBasePath();
  setTimeout(() => {
    try {
      window.location.reload();
    } catch {
      // nic lepšího už neuděláme
    }
  }, 400);
}

/**
 * Appka naběhla, takže nasazený balík umí nastartovat.
 *
 * Značku hlídá krátký skript v `<head>` (viz `app/layout.tsx`): když ji do pár
 * vteřin nikdo nesmaže, znamená to bílou obrazovku a skript se vrátí k verzi
 * z APK. Hlídač musí být tam a ne tady - rozbitý balík tenhle soubor vůbec
 * nespustí.
 */
export function markBootSucceeded(): void {
  write(BOOTING_KEY, null);
  (window as unknown as { __mwBooted?: boolean }).__mwBooted = true;
}

/**
 * Nasadí balík stažený při minulém běhu. Volá se co nejdřív po startu,
 * ještě než uživatel začne něco dělat.
 *
 * Vrací nasazenou verzi, nebo `null`, když není co nasazovat.
 */
export interface ApplyResult {
  applied: string | null;
  /** Vyplněno, když nasazení selhalo - jinak by chyba zmizela beze stopy. */
  error?: string;
}

/**
 * Strop na volání nativní vrstvy.
 *
 * Plugin, který se nevrátí, umí zaseknout celé nasazení potichu - žádná chyba,
 * žádná změna, uživatel jen kouká na tlačítko, které "nic nedělá". Strop z toho
 * udělá chybu se jménem volání, takže je hned vidět, kdo se zasekl.
 */
function withTimeout<T>(work: Promise<T>, label: string, ms = 6000): Promise<T> {
  return Promise.race([
    work,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} se neozvalo do ${ms / 1000} s`)), ms),
    ),
  ]);
}

/** Cesta k adresáři balíku, jak ji chce nativní most (bez file://). */
async function bundleDir(version: string): Promise<string> {
  const path = `bundles/${version}`;
  // Bez index.html by se appka neotevřela vůbec.
  await withTimeout(
    Filesystem.stat({ path: `${path}/index.html`, directory: Directory.Data }),
    "Filesystem.stat",
  );
  const uri = await withTimeout(
    Filesystem.getUri({ path, directory: Directory.Data }),
    "Filesystem.getUri",
  );
  return uri.uri.replace(/^file:\/\//, "");
}

export async function applyPendingUpdate(): Promise<ApplyResult> {
  // Celé v try: cokoli, co spadne mimo něj, skončí jako tlačítko, které
  // "nic nedělá" - žádná hláška, žádná změna, žádná stopa.
  try {
    if (!isNative()) return { applied: null };

    // Balík starší než appka v APK je vždycky omyl, ať už čeká na nasazení,
    // nebo je nasazený - Capacitor po instalaci nového APK stejně startuje
    // z jeho vlastních souborů a tohle mu ten návrat zpátky nedovolí.
    const pending = withoutStale(PENDING_KEY, pendingBundleVersion());
    // Když nic nečeká, stejně zkontrolujeme, jestli sedí nasazená verze:
    // uložení cesty na nativní straně se nemusí povést a appka by se po
    // restartu tiše vrátila k verzi z APK.
    const target = pending ?? withoutStale(CURRENT_KEY, read(CURRENT_KEY));
    if (!target) return { applied: null };

    const dir = await bundleDir(target);

    const active = await withTimeout(
      WebView.getServerBasePath(),
      "WebView.getServerBasePath",
    ).catch(() => ({ path: "" }));

    if (active.path === dir) {
      // Už běžíme z tohohle balíku. Jen dorovnat záznamy a nesahat na WebView,
      // jinak by se appka překreslovala pořád dokola.
      write(CURRENT_KEY, target);
      write(PENDING_KEY, null);
      write(BOOTING_KEY, null);
      return { applied: null };
    }

    // Zapsat dřív než se sáhne na WebView: setServerBasePath appku okamžitě
    // překreslí a další kód už nemusí doběhnout.
    write(CURRENT_KEY, target);
    write(PENDING_KEY, null);
    write(BOOTING_KEY, target);

    // Na setServerBasePath se schválně NEČEKÁ.
    //
    // Bridge.setServerBasePath dělá tohle:
    //     localServer.hostFiles(path);                   // synchronně
    //     webView.post(() -> webView.loadUrl(appUrl));   // překreslení do fronty
    // a teprve pak plugin zavolá call.resolve(). Překreslení je ve frontě dřív
    // než doručení odpovědi do JS, takže odpověď z principu nikdy nedorazí -
    // `await` na tomhle volání čeká navždy.
    //
    // Podstatné je, že `hostFiles` doběhne hned: nový adresář se servíruje
    // okamžitě. Stačí tedy překreslit a nečekat na potvrzení.
    void WebView.setServerBasePath({ path: dir });
    void WebView.persistServerBasePath();

    // Když se nativní překreslení nedostaví, dotlačíme ho z JS. Soubory už
    // servíruje nový adresář, takže obyčejné znovunačtení stačí.
    setTimeout(() => {
      try {
        window.location.reload();
      } catch {
        // nic lepšího už neuděláme
      }
    }, 400);

    return { applied: target };
  } catch (e) {
    // Pending schválně nemažeme: balík je stažený, chyba může být dočasná
    // a uživatel to má moct zkusit znovu.
    return { applied: null, error: String(e).slice(0, 200) };
  }
}

/**
 * Stáhne manifest. Zvládne obojí: prostý JSON (raw) i odpověď GitHub API,
 * která obsah nese zabalený v base64.
 */
async function fetchManifest(url: string): Promise<UpdateManifest> {
  // ŽÁDNÉ vlastní hlavičky.
  //
  // Hlavička mimo bezpečný seznam CORS (třeba Cache-Control) si vynutí
  // předletový OPTIONS dotaz. GitHub API ho sice zodpoví, ale Cache-Control
  // v access-control-allow-headers nemá, a raw na OPTIONS vrací rovnou 403.
  // Obě cesty tím padnou naráz a stahování skončí na "Failed to fetch".
  //
  // `cache: "no-store"` je volba fetche, ne hlavička - preflight nespouští.
  const res = await fetch(`${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const body = (await res.json()) as UpdateManifest & { content?: string; encoding?: string };
  if (body.encoding === "base64" && body.content) {
    // Přes bajty, ne přímo z atob: atob vrací znaky po bajtech a diakritika
    // v poznámce by se rozsypala.
    const bytes = Uint8Array.from(atob(body.content.replace(/\s/g, "")), (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes)) as UpdateManifest;
  }
  return body;
}

export type UpdateCheck =
  | { kind: "disabled" }
  | { kind: "up-to-date"; version: string | null }
  | { kind: "downloaded"; version: string; notes?: string }
  | { kind: "failed"; message: string };

/** Stáhne novější balík, pokud je. Nasadí se až při příštím startu. */
export async function checkForUpdate(): Promise<UpdateCheck> {
  if (!isNative()) return { kind: "disabled" };
  const url = getUpdateUrl();
  if (!url) return { kind: "disabled" };

  try {
    let manifest: UpdateManifest;
    try {
      manifest = await fetchManifest(url);
    } catch (e) {
      if (url !== DEFAULT_UPDATE_URL) throw e;
      manifest = await fetchManifest(FALLBACK_UPDATE_URL);
    }
    if (!manifest?.version || !manifest?.bundle) {
      return { kind: "failed", message: "Manifest nemá version nebo bundle." };
    }

    // Jen dopředu. Když se porovnávalo na „jiná verze = novější", stačilo
    // zapomenout pushnout balík a appka si přes nové APK sama nasadila ten
    // starý z GitHubu.
    const current = currentBundleVersion();
    if (!isNewerVersion(manifest.version, current) || !isNewerVersion(manifest.version, pendingBundleVersion())) {
      return { kind: "up-to-date", version: current };
    }

    // Relativní jméno balíku se skládá vůči raw, ne vůči adrese manifestu -
    // ta může mířit na API, kde balík neleží.
    const base = url === DEFAULT_UPDATE_URL ? FALLBACK_UPDATE_URL : url;
    const bundleUrl = new URL(manifest.bundle, base).toString();
    const bundleRes = await fetch(bundleUrl, { cache: "no-store" });
    if (!bundleRes.ok) return { kind: "failed", message: `Balík: HTTP ${bundleRes.status}` };
    const files = (await bundleRes.json()) as BundleFile[];
    if (!Array.isArray(files) || !files.some((f) => f.path === "index.html")) {
      return { kind: "failed", message: "Balík neobsahuje index.html." };
    }

    const dir = `bundles/${manifest.version}`;

    // Zbytek po nepovedeném stahování by se míchal s novým balíkem.
    try {
      await Filesystem.rmdir({ path: dir, directory: Directory.Data, recursive: true });
    } catch {
      // ještě neexistuje
    }

    for (const file of files) {
      await Filesystem.writeFile({
        path: `${dir}/${file.path}`,
        data: file.content,
        directory: Directory.Data,
        // Bez `encoding` bere Capacitor obsah jako base64 a zapíše ho bajt po
        // bajtu - přesně to potřebují obrázky.
        ...(file.encoding === "base64" ? {} : { encoding: Encoding.UTF8 }),
        recursive: true,
      });
    }

    write(PENDING_KEY, JSON.stringify({ version: manifest.version, path: dir }));
    return { kind: "downloaded", version: manifest.version, notes: manifest.notes };
  } catch (e) {
    return { kind: "failed", message: String(e).slice(0, 160) };
  }
}
