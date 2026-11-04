# AgentMEMORY — mpL (P/_ayer)
Aktualizováno: 2026-11-04 12:29

## Cíl repa
Android appka (Capacitor): přehrávač hudby, čtečka PDF, video a stahování. Data jen v telefonu.

## Stav a jak spustit
- `npm run ci:validate` (tsc + vitest), `npm run dev`; APK a OTA viz `ANDROID.md`.
- Repo https://github.com/MonsterMarian/mpL, větev `main`.

## Hotovo
- 2026-11-04 — Dokumentace přepsaná podle skutečné appky (README, NOTES, ANDROID); `PUSHWIN.md` smazaný, byl z MicroWins.

## Rozpracováno

## Další kroky
- Pozůstatky po MicroWins mimo MD neřešené: jméno a popis v `package.json`, `scripts/import-progress.mjs`, CSS PushWinu v `globals.css`.

## Rozhodnutí a poznámky
- Předpona `microwins:` v `localStorage` se nesmí přejmenovat bez migrace, telefon by přestal data vidět.
- Rozhodnutí a omezení appky jsou v `NOTES.md`. Starý obsah NOTES byl kopie z MicroWins, platná verze je v repu MicroWins.

## Log (posledních ~30)
- 2026-11-04 12:29 — „updejtni MD soubory“ → README a NOTES přepsané, ANDROID opravený, PUSHWIN.md pryč; 86 testů prošlo, žádný balík (jen dokumentace).
