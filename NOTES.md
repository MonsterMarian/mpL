# NOTES - kontext, rozhodnutí a co dál

Shrnutí vzniku aplikace a pravidel, která se mají držet. Jeden soubor, ať se nemusí
lovit v historii chatu.

---

## 1. Zadání a původ

Appka vznikla na kostře MicroWins (nativní obal, build skripty, živé aktualizace),
ale je to jiný produkt: **přehrávač a čtečka v jedné appce**. Zadání čtečky je
v [ZADANI.md](ZADANI.md).

Pozůstatky po MicroWins jsou v kódu dodnes: jméno v `package.json`, předpona
`microwins:` u klíčů v `localStorage` a skript `scripts/import-progress.mjs`.
Předponu **nepřejmenovávat bez migrace**: telefon by přestal uložená data vidět.

---

## 2. Co vzniklo

| Sekce | Obsah |
|---|---|
| Knihovna | hudba z telefonu, oblíbené, playlisty, fronta, řazení, časovač vypnutí, počty poslechů |
| Dokumenty | knihovna s kartou Pokračovat ve čtení, stránky PDF, záložky, obsah, hledání, vzhled, předčítání |
| Video | filmy z telefonu, nativní přehrávač, nastavení za jedním ozubeným kolem, tři podoby galerie |
| Stahování | stahování hudby a videa na pozadí, historie s možností stáhnout znovu |
| Nastavení | přístup k hudbě, ovládání v systému, addony, ikony sekcí, vzhled, aktualizace |

Stack: Next.js 15 (statický export, jedna stránka `src/app/page.tsx`, sekce jsou
stav) · React 19 · TypeScript strict · Tailwind 4 · Vitest (86 testů) · Capacitor 8.

---

## 3. Rozhodnutí a proč

| Rozhodnutí | Proč |
|---|---|
| **Hudbu hraje nativní `PlaybackService`, web je jen ovladač** | Hudba ve stránce byla svázaná s oknem a po odsunutí appky ztichla. |
| **Každý start přes `startForegroundService` končí `startForeground`** | Jinak Android 12+ appku shodí nebo službu zabije. Popředí se opouští jen když `!isPlaying() && !playWhenReady`. Porušení tohohle pravidla způsobilo samovolné zastavování hudby (říjen 2026). |
| **Výjimka z optimalizace baterie se nepřidává** | Nebyla potřeba a uživatel ji odmítl. Stahování drží naživu `DownloadService`. |
| **Smazání souboru z telefonu potvrzuje appka** | Appka má přístup ke všem souborům, takže Android mazání schválí potichu a bez okna. `createDeleteRequest` tu nestačí. |
| **Buď jedno potvrzení, nebo Vrátit, nikdy obojí** | Co se nedá vrátit (soubor v telefonu), potvrzuje `ConfirmDelete`. Co vrátit jde (odebrání z knihovny, dokumenty), se smaže rovnou a hláška nabídne 6 s na Vrátit. |
| **Podržení položky otevře výběr s akcemi rovnou dole** | Akce za třemi tečkami byly krok navíc. Chová se stejně v hudbě, filmech i dokumentech. |
| **Appka je jen na výšku, na šířku smí jen `VideoActivity`** | Film má vlastní tlačítko otočení. |
| **Stránka PDF se kreslí s lhůtou a opakováním** | `page.render()` běží přes `requestAnimationFrame`. Na pozadí se slib nikdy neuzavře, takže by vykreslení zůstalo viset. |
| **Dokument žije na disku, ne v paměti stránky** | Čtečka se má chovat jako hudba: po restartu je knihovna pořád na místě (`document-store.ts`). |
| **Police dělí knihy na Rozečtené a Ostatní, bez pruhu postupu** | Tenký pruh na obálce nebyl vidět, uživatel ho nechtěl. Postup říká štítek s procenty a nadpis. Karta Pokračovat ve čtení i nadpis platí jen pro knihu rozečtenou: nezačatá ani dočtená tam nepatří. |
| **Psaní do hledání je jen náhled** | Skok na nález by se uložil jako rozečtené místo, takže hledání by čtenáři vzalo stránku. Hledá se od aktuální strany a po zavření se čtečka vrátí, pokud si čtenář nezvolil konkrétní nález. Zavření celé čtečky s otevřeným hledáním tahle pojistka nepokrývá. |
| **Živá aktualizace se nasazuje až při dalším startu** | Přepnutí za běhu by uživateli vzalo obrazovku pod rukama. |

---

## 4. Známá omezení

- **Data jsou jen v telefonu.** Účet ani synchronizace nejsou a odinstalace
  `localStorage` smaže. Přežije jen historie stahování, která má zálohu
  v Dokumentech.
- **Appka nemá zálohu dat do souboru.** Playlisty, oblíbené a postup ve čtení
  se nedají přenést na jiný telefon.
- **Nativní změny potřebují nové APK.** Živá aktualizace vymění jen webovou část.
  Týká se to i opravy NewPipeExtractoru, když se změní YouTube.
- **Bez OCR.** U skenu bez textové vrstvy nefunguje hledání ani předčítání.
- **Předčítání potřebuje hlas nainstalovaný v systému.**

---

## 5. Orientace v kódu

```
src/app/page.tsx               hlavní stránka: sekce, stav přehrávače, knihovny a čtečky
src/components/music/          knihovna, přehrávač v liště a na celou obrazovku
src/components/reader/         čtečka PDF
src/components/selection.tsx   výběr více položek a potvrzení smazání
src/components/download-view.tsx, video-library.tsx, settings-dialog.tsx
src/lib/
  library.ts, playlists.ts     knihovna hudby, playlisty
  playback-service.ts          most k nativnímu přehrávání
  media-library.ts             most k hudbě, videu a stahování v telefonu
  documents.ts, document-store.ts, pdf.ts, reader-prefs.ts   čtečka
  speech.ts                    předčítání
  downloads.ts, stream.ts      stahování, nativní přehrávač a adresy streamů
  undo.ts                      texty a pravidla pro Vrátit
  live-update.ts, versions.ts  živé aktualizace
android/app/src/main/java/cz/player/app/
  PlaybackService, DownloadService, VideoActivity, CrashLog a pluginy
```

Pravidlo, které se vyplatí držet: **v `lib/` žádný React, v komponentách žádná
byznys logika.** Díky tomu jde chování otestovat bez renderu.
