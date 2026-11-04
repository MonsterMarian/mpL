# P/_ayer (mpL) jako Android appka

Appka běží v telefonu offline ze souborů v APK. Není to zástupce na web —
nativní obal (Capacitor) drží WebView, splash screen, ikonu, stavovou lištu,
hardwarové tlačítko Zpět a vibrace.

## Co je kde

| Cesta | Co to je |
|---|---|
| `capacitor.config.ts` | ID appky, jméno, barvy, chování splash screenu a lišt |
| `android/` | nativní projekt (Gradle). Generuje ho Capacitor, ruční úpravy přežijí |
| `android/app/src/main/res/` | ikony, splash, barvy a témata |
| `scripts/android-assets.mjs` | generátor ikon a splashe z jednoho SVG |
| `src/lib/native.ts` | most do nativní vrstvy (haptika, lišta, splash, tlačítko Zpět) |
| `android/app/src/main/java/cz/player/app/` | nativní přehrávání, stahování, video a pluginy pro ně |
| `out/` | statický export webu, který se do APK kopíruje |

## Nástroje na tomhle počítači

Nic z toho není nainstalované v systému — leží to vedle sebe v `C:\Android`
a build si na to sáhne sám.

- Android SDK: `C:\Android\sdk` (platform 35 a 36, build-tools 35 a 36)
  - cesta je zapsaná v `android/local.properties` **lomítky dopředu** —
    `sdk.dir=C:\Android\sdk` se v Java properties přečte jako `C:Androidsdk`
- JDK 21: `C:\Android\jdk\jdk-21.0.12.1+1`
  - Capacitor 8 se kompiluje na Javu 21, v systému je 17;
    build si vlastní JDK bere přes `org.gradle.java.home` v `android/gradle.properties`

## Když build spadne na „Unable to establish loopback connection"

Na tomhle stroji je rozbitý AF_UNIX: `bind` projde, `connect` vrátí *Invalid
argument*. JDK si přes unixové sokety dělá každý `Selector.open()` a na TCP
loopback, který funguje, samo neuhne - přepínač pro to nemá. Gradle proto padal
hned při startu.

Řeší to malý javový agent v `scripts/uds-off/`, který ten příznak v JVM přepíše.
`scripts/gradle.mjs` si ho sám přeloží (do `android/build/uds-off/`) a nasadí
přes `JAVA_TOOL_OPTIONS`, takže ho dostane launcher, démon i odštěpené procesy
pro překlad. Ručně není potřeba dělat nic - `npm run android:apk` prostě jede.

## Sestavení APK

**Do telefonu vždy release verzi:**

```bash
npm run android:release
```

Výsledek: `android/app/build/outputs/apk/release/app-release.apk`

Debug verze (`npm run android:apk`) je označená jako `debuggable` a řada
telefonů — hlavně Xiaomi, Samsung a cokoli s Play Protect — ji odmítne
nainstalovat hláškou „Aplikaci nelze nainstalovat". Debug build je na ladění
přes kabel, ne na normální používání.

## Instalace do telefonu

Přes kabel, když je v telefonu zapnuté ladění USB:

```bash
C:\Android\sdk\platform-tools\adb.exe install -r android/app/build/outputs/apk/debug/app-debug.apk
```

Bez kabelu: APK zkopíruj do telefonu (kabel, Disk, e-mail) a otevři ho tam.
Android se zeptá na povolení instalovat z tohoto zdroje — jednorázově potvrď.

## Živé aktualizace (bez přeinstalace)

Appka je hromada statických souborů, které Capacitor servíruje z telefonu.
Když se ty soubory vymění, po restartu běží nová verze — **bez instalace APK**.

Co takhle projde: všechno v `src/` — funkce, opravy, texty, vzhled.
Co neprojde: nativní část (nový plugin, oprávnění, ikona, `targetSdk`). Tam je
potřeba nové APK, ale to je párkrát za rok.

Adresa je zadrátovaná v `src/lib/live-update.ts` jako `DEFAULT_UPDATE_URL`,
takže se nikde nic nenastavuje — appka se aktualizuje sama.

### Vydání nové verze

```bash
npm run ota:bundle
```

Vyrobí `ota/bundle-<verze>.json` (celá appka v jednom souboru) a
`ota/latest.json` (manifest). Pak stačí commit a push — appka si při startu
stáhne manifest, porovná verzi a když je novější, stáhne balík a nasadí ho
**při dalším otevření**.

Nasazuje se schválně až při dalším startu: přepnutí za běhu by uživateli zmizela
obrazovka pod rukama.

**Číslo verze musí sedět mezi webem a manifestem.** `scripts/release.mjs` proto
staví web sám a předává mu verzi přes `NEXT_PUBLIC_BUNDLE_VERSION` — kdyby se
stavělo zvlášť, appka by po každé instalaci stahovala balík, který už v sobě má.
Skript to na konci kontroluje a při nesouladu skončí chybou.

### Nové APK

```bash
npm run android:release
```

Postaví balík i APK z jednoho buildu (takže mají stejnou verzi) a rovnou APK
podepíše do `Player.apk` v kořeni projektu. Nutné jen při zásahu do nativní části.

Samotné podepsání jde spustit i zvlášť: `npm run android:sign`. Schémata v1+v2+v3,
v4 vypnuté - to používá jen `adb install --incremental` a nechává po sobě
soubor `.apk.idsig`.

### Když se něco pokazí

Balík, který appku položí, řeší hlídač startu v `app/layout.tsx`: když se do
pár vteřin nikdo neozve, vrátí se sám k verzi z APK.

### Data při aktualizaci

Zůstávají. `localStorage` patří k adrese `localhost`, kterou výměna souborů
nemění. Stejně tak přeinstalace APK přes existující appku data nemaže —
maže je jen odinstalace.

## Změna ikony nebo splashe

Uprav SVG v `scripts/android-assets.mjs` a spusť:

```bash
npm run android:assets
```

Barvy tam odpovídají tokenům z `src/app/globals.css`. Když se změní paleta
appky, změň je i tam a přegeneruj.

## Podpisový klíč

Release se podepisuje klíčem z `android/player.jks`, heslo je
v `android/keystore.properties`. Obojí je mimo git.

**Ten soubor zálohuj.** Android považuje appku podepsanou jiným klíčem za jinou
appku — bez původního klíče nejde vydat aktualizace, jde jen odinstalovat
a nainstalovat znovu, což smaže data.

Nový klíč (jen když se ten starý ztratí):

```bash
C:\Android\jdk\jdk-21.0.12.1+1\bin\keytool.exe -genkeypair -v -keystore android/player.jks -alias player -keyalg RSA -keysize 2048 -validity 10000
```

## Když se APK nedá nainstalovat

1. **Použil jsi debug APK?** Ber `app-release.apk`, ne `app-debug.apk`.
2. **Play Protect** — hlásí „Neznámá aplikace zablokována". Klepni na
   *Další podrobnosti → Přesto nainstalovat*.
3. **Povolení instalace** — telefon chce povolit instalaci konkrétní appce,
   ze které APK otevíráš (Soubory, Chrome). Nastavení nabídne samo.
4. **Starší verze v telefonu** s jiným podpisem — nejdřív odinstaluj.
5. **Android starší než 7.0** — appka nepojede, `minSdk` je 24 a níž ho
   Capacitor 8 nepustí.
6. **Poškozený přenos** — messengery APK překomprimují. Posílej kabelem
   nebo přes Disk.

## Data

Nastavení, playlisty, oblíbené, postup ve čtení a seznam stahování jsou
v `localStorage` uvnitř WebView appky. Zůstávají po zavření i po restartu telefonu.
**Odinstalace appky je smaže.** Dokumenty leží v souborech appky přes
`@capacitor/filesystem` a historie stahování má zálohu v Dokumentech.

Zálohu všech dat do souboru appka nemá. Klíče v `localStorage` mají kvůli původu
appky předponu `microwins:`. Přejmenovat je jde jen s migrací, jinak appka uložená
data přestane vidět.

## Pozor při vývoji

- Appka má jedinou stránku `src/app/page.tsx`, sekce jsou stav. Statický export
  neumí předgenerovat cesty pro id, která vzniknou až v telefonu.
- Každá změna webu se do appky dostane až přes `cap sync android`.
  Samotný `next build` na APK nesáhne.
- `npm run build` za běhu dev serveru rozbije dev appku v prohlížeči, server
  napřed zastav.
- Worker čtečky PDF kopíruje do webu `scripts/copy-pdf-worker.mjs` (`npm run
  pdf:worker`). `dev` i `build` ho spouští samy.
- Čtečku ověřuj s oknem v popředí. `page.render()` běží přes
  `requestAnimationFrame` a ve skrytém okně se nikdy nedokončí.
