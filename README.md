# P/_ayer (mpL)

Přehrávač a čtečka do telefonu s Androidem. Jedna appka se čtyřmi sekcemi:

1. **Knihovna** - hudba z telefonu: skladby, oblíbené, playlisty, fronta,
   opakování, náhodné pořadí, časovač vypnutí a počty poslechů. Hraje na pozadí,
   ovládá se i z notifikace a ze zamčené obrazovky.
2. **Dokumenty** - PDF a textové soubory. Stránky se kreslí jako v originále,
   appka si pamatuje, kde se skončilo, a umí záložky, obsah, hledání, sépii,
   přiblížení i předčítání se zvýrazněnou větou. Sken bez textové vrstvy pozná
   a řekne to rovnou.
3. **Video** - filmy z telefonu v nativním přehrávači, i ve formátech, které
   webové přehrávače neumí.
4. **Stahování** - hudba a video z odkazů. Doběhne i po odchodu z appky
   a skladba dostane obrázek, název a interpreta přímo do souboru.

Dokumenty, Video a Stahování jsou addony: v Nastavení se dají vypnout, zmizí jen
jejich záložka a data zůstanou. Podržení položky otevře výběr a akce nad ní, a to
stejně v hudbě, filmech i dokumentech.

Všechno leží v telefonu, appka nemá účet ani synchronizaci. Nové verze si stahuje
sama z GitHubu (viz [ANDROID.md](ANDROID.md)).

---

## Spuštění

Pro lokální běh:

```bash
npm install
npm run dev
```

Aplikace poběží na `http://localhost:3000`. V prohlížeči běží jen webová část.
Přehrávání hudby, video, knihovna z telefonu a stahování potřebují nativní vrstvu,
takže je ověříš až v APK. Stavba APK a vydávání jsou v [ANDROID.md](ANDROID.md),
rozhodnutí a omezení v [NOTES.md](NOTES.md).

Kontrola před vydáním:

```bash
npm run ci:validate   # tsc + vitest
```

## Technologie

- Next.js 15 (statický export) a React 19
- TypeScript (strict mode)
- Tailwind CSS 4
- Vitest pro testování logiky bez Reactu
- Capacitor 8 (nativní Android appka)
- `pdfjs-dist` pro čtečku
- Nativní vrstva v Javě: Media3 ExoPlayer a libVLC na video, NewPipeExtractor
  na hledání adres streamů, jump3r na převod do MP3
