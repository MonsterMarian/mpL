# MicroWins jako Android appka

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
| `out/` | statický export webu, který se do APK kopíruje |

## Nástroje na tomhle počítači

Nic z toho není nainstalované v systému — leží to vedle sebe v `C:\Android`
a build si na to sáhne sám.

- Android SDK: `C:\Android\sdk` (platform 35 a 36, build-tools 35 a 36)
  - cesta je zapsaná v `android/local.properties` **lomítky dopředu** —
    `sdk.dir=C:\Android\sdk` se v Java properties přečte jako `C:Androidsdk`
- JDK 21: `C:\Android\jdk\jdk-21.0.12+8`
  - Capacitor 8 se kompiluje na Javu 21, v systému je 17;
    build si vlastní JDK bere přes `org.gradle.java.home` v `android/gradle.properties`

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
podepíše do `../MicroWins.apk`. Nutné jen při zásahu do nativní části.

Samotné podepsání jde spustit i zvlášť: `npm run android:sign`. Schémata v1+v2+v3,
v4 vypnuté - to používá jen `adb install --incremental` a nechává po sobě
soubor `.apk.idsig`.

### Když se něco pokazí

**Nastavení → Aktualizace → Vrátit se k verzi z APK** zahodí stažené balíky.
Rozbalovací **Adresa manifestu** dovolí ukázat appku jinam, než kam míří
výchozí adresa.

### Data při aktualizaci

Zůstávají. `localStorage` patří k adrese `localhost`, kterou výměna souborů
nemění. Stejně tak přeinstalace APK přes existující appku data nemaže —
maže je jen odinstalace.

## Změna ikony nebo splashe

Uprav SVG v `scripts/android-assets.mjs` a spusť:

```bash
npm run android:assets
```

Barvy tam odpovídají tokenům z `src/app/globals.css` (`--background`, `--win`
v tmavém režimu). Když se změní paleta appky, změň je i tam a přegeneruj.

## Podpisový klíč

Release se podepisuje klíčem z `android/microwins.jks`, heslo je
v `android/keystore.properties`. Obojí je mimo git.

**Ten soubor zálohuj.** Android považuje appku podepsanou jiným klíčem za jinou
appku — bez původního klíče nejde vydat aktualizace, jde jen odinstalovat
a nainstalovat znovu, což smaže data.

Nový klíč (jen když se ten starý ztratí):

```bash
C:\Android\jdk\jdk-21.0.12+8\bin\keytool.exe -genkeypair -v -keystore android/microwins.jks -alias microwins -keyalg RSA -keysize 2048 -validity 10000
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

Ukládají se do `localStorage` uvnitř WebView appky. Zůstávají po zavření i po
restartu telefonu. **Odinstalace appky je smaže.**

Záloha: **Nastavení (ozubené kolo) → Data → Exportovat vše**. V appce se soubor
zapíše a otevře systémové sdílení, takže míří na Disk, do mailu, kamkoli —
stahovací odkaz jako v prohlížeči ve WebView nefunguje, proto
`@capacitor/filesystem` a `@capacitor/share`.

Obnova: **Obnovit ze souboru**, nebo vložit obsah zálohy jako text (záchranná
cesta, když výběr souboru zlobí).

Načtení se nikdy nespustí rovnou — nejdřív se ukáže náhled: co v souboru je,
co načíst (**vše / jen projekty / jen strom**), jestli **přidat** k současným
datům nebo je **nahradit**, a kolik čeho po načtení bude. Díky tomu se dají
natáhnout projekty odjinud, aniž by se sáhlo na strom winů. Volby, které
soubor neobsahuje, jsou zašedlé. Logika je v `src/lib/import.ts`.

Záloha nese celý `MicroWinsState` (strom, záznamy, microwiny, projekty, úkoly,
milníky, denní otisky) plus nastavení vzhledu. Formát viz `src/lib/backup.ts`;
načte i starší holý export bez obálky.

### Data z jiné aplikace

`scripts/import-progress.mjs` převede CSV export z aplikace Progress na zálohu
MicroWins, kterou pak vezme **Obnovit ze souboru** s rozsahem „jen projekty":

```bash
node scripts/import-progress.mjs --in <složka s CSV> [--out <soubor.json>]
```

Skript si na konci sám přepočítá procenta podle pravidel MicroWins a porovná je
se zdrojem — když se rozejdou, mapování je špatně a skript skončí chybou.
Komentáře se dopíšou do popisu úkolu (appka je nemá), přílohy se nepřenesou.

#### Doručení dat balíkem (bez souboru)

Data se do telefonu dají dostat i bez kopírování souboru: balík si je přiveze
s sebou, při prvním spuštění se usadí do `localStorage` a další verze balíku už
je obsahovat nemusí. `localStorage` patří k adrese `localhost`, kterou výměna
souborů nemění, takže po odstranění seedu data zůstanou.

1. `node scripts/import-progress.mjs --seed src/lib/seed-import-data.ts`
2. Přidat `src/lib/seed-import.ts` — jednorázové použití (značka
   `microwins:seed:<id>` v localStorage), rozsah **jen projekty**, plus
   pojistka „projekt se stejným názvem a startem už tu je".
3. Zavolat `applySeed(loaded)` v `store-provider.tsx` při hydrataci.
4. `npm run ota:bundle`, commit, push. Uživatel nasadí, data se usadí.
5. **Po potvrzení** smazat oba soubory i volání, vydat čistý balík.

Pátý krok neodkládej — dokud je seed v manifestu, stáhne si ho každý, kdo
appku s touhle adresou spustí. A pozor: data zůstávají v historii gitu i po
smazání souboru, takže tímhle neposílej nic, co nemá být veřejné.

**Historie postupu** se skládá zpátky z dat vzniku a poslední změny každého
úkolu a podúkolu: zaškrtnutí je skok v den odškrtnutí (přesné), u číselných
úkolů se růst mezi vznikem a poslední změnou odhaduje rovnoměrně. Bez toho by
graf i deník změn byly u každého projektu jedna přímka. Poslední otisk padne
nejpozději na včerejšek — s otiskem k dnešku by appka celý přenesený postup
ohlásila jako přírůstek dne importu.

## Pozor při vývoji

- Routy nesmí být dynamické (`/projects/[id]`). Statický export neumí
  předgenerovat cesty pro id, která vzniknou až v telefonu — proto
  `/projects?id=…`, `/projects/stats?id=…` a `/tasks?id=…`.
- Každá změna webu se do appky dostane až přes `cap sync android`.
  Samotný `next build` na APK nesáhne.
