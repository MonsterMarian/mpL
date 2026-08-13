# NOTES — kontext, rozhodnutí a co dál

Shrnutí vzniku aplikace a plán dalších kroků. Jeden soubor, ať se nemusí lovit v historii chatu.

---

## 1. Zadání

Aplikace **MicroWins** ve dvou částech:

**Část 1 — struktura.** Úspěchy ve stromu (`Business / cold calls / X za den` se záznamy `[2; 1.1.2026]`, `[4; 5.6.2026]`, vedle toho `Fitness`). Když byl rekord 2 cold calls za den a dám 4, je to PR. Nová kategorie + záznam k dnešku s hodnotou > 0 = microwin. Nula se neřeší, záporné číslo nejde. Záznam je vždy číslo, klidně desetinné (`2.5 H`). Výchozí datum je den zadání, ale jde zadat i starší — **zpětný zápis se k danému dni jako microwin nepočítá, microwin je vždy jen k dnešku**.

**Část 2 — statistiky.** Tabulka dní z microwinů: kolik jich je za daný den, u každého text metriky, kde je **X** nahrazeno hodnotou z toho dne. Plus streaky a podobné funkce.

**Doplněk během práce.** Převzít 100 % funkcí z referenční ToDo aplikace (screenshoty): projekty s procenty, deadliny, tempem, úkoly s cíli a podúkoly, prstence, graf vývoje, deník změn. Pořadí sekcí: **projekty → strom → analýza/winstreak**. Vizuál volný, komponenty z 21st.dev se doladí později, až bude po ruce harness.

---

## 2. Co vzniklo

| Sekce | Route | Obsah |
|---|---|---|
| Projekty | `/` | záložky Přehled / ToDo / Projekty, filtry, řazení, hledání; mezi sekcemi se dá přejet prstem |
| Detail projektu | `/projects/[id]` | %, delta dne, start–deadline, zbývá dní, tempo %/den, popis, úkoly, milníky, archiv |
| Statistiky projektu | `/projects/[id]/stats` | prstence (Postup / Dny / Hotové úkoly), plošný graf, deník změn |
| Detail úkolu | `/tasks/[id]` | %, `630 / 2 000`, posuvník, −/+ s krokem, nastavení, podúkoly (cíl 1 = jen zaškrtnout) |
| Strom | `/tree` | dnešek + procházení složek s winy a jejich záznamy |
| Analýza | `/stats` | série, pruh měsíce, kalendář roku, přehled winů, tempo projektů |

Stack: Next.js 15 (App Router, vše klientské) · React 19 · TypeScript strict · Tailwind 4 · Vitest. Data v `localStorage`, export/import JSON. Grafy jsou vlastní SVG bez knihoven. 112 testů nad doménovou logikou.

---

## 3. Rozhodnutí a proč

Věci, které ze zadání jednoznačně nevyplývaly a musely se dořešit:

| Rozhodnutí | Proč |
|---|---|
| **Denní součet, ne jednotlivý zápis** | „X za jeden den" je denní veličina. Dva zápisy 2 + 3 v jednom dni dají 5. Metrika se dá přepnout na režim „nejlepší pokus" (max) pro věci typu maximální váha na benchi. |
| **Rekord = nejvyšší denní součet** | Konzistentní s předchozím bodem. Rekord je vlastnost dne, ne okamžiku zápisu. |
| **Max jeden microwin na metriku a den** | Jinak by tři zápisy nad rekordem daly tři microwiny a číslo „kolik jich mám dnes" by ztratilo význam. Při zlepšení se microwin aktualizuje. |
| **Zpětný zápis rekord posouvá** | Když jsem 1. 1. udělal 10 hovorů a zapíšu to až teď, rekord *byl* 10. Microwin za to ale nedostanu — ten je odměna za dnešek. |
| **Zpětný zápis může zrušit dnešní microwin** | Pokud dodatečně přiznaný starší den překoná dnešek, dnešek rekordem nebyl. Minulé microwiny se nikdy nepřepisují, jsou to získané fakty. |
| **Procenta se zaokrouhlují dolů** | 99,7 % ještě není hotovo. Sedí to i s referenční aplikací (630/2000 = 31 %, ne 32 %). |
| **Denní otisky postupu (`snapshots`)** | Úkoly znají jen aktuální hodnotu. Bez otisku by nešel nakreslit graf ani deník změn. Jeden otisk na projekt a den. |
| **localStorage místo SQLite** | Zadání bylo o pravidlech a UI. Doménová logika je oddělená od úložiště, takže výměna za DB je práce na jednom místě — viz níže. |
| **Dva akcenty místo jednoho** | Jantar = microwin/rekord, zelená = postup projektu. Sémanticky odlišné věci; jinak platí neutrální paleta. |
| **Zelená na pět způsobů** | Vybrat odstín od stolu nešlo, tak jich je pět (Smaragd / Nefrit / Neon / Limetka / Šalvěj) a přepínají se v Nastavení. Sedí na `data-accent` na `<html>`, takže se to obejde bez přebarvování komponent. Jantar u microwinů se nemění. |
| **Úkoly počítají v celých číslech** | „13,6 / 20" nikdo nečte a posuvník po desetinách takové hodnoty vyráběl sám. Cíl, hodnota, krok i váha se zaokrouhlují při zápisu a stará data se srovnají při načtení. |
| **Cíl 1 = zaškrtávátko** | Pruh a „1 / 1 · 100 %" u úkolu, který se dá jen odškrtnout, zabíraly řádek a nic neříkaly. Úkol s cílem 1 a bez podúkolů se proto kreslí jako checkbox — v seznamu i v detailu. |
| **Rozkliknutá záložka žije v adrese** | Návrat z detailu projektu končil vždycky na Přehledu, protože historie o záložce nic nevěděla. Teď je v `?tab=` a `router.back()` ji vrátí. |
| **Vlastní SVG grafy** | Žádná závislost navíc, plná kontrola nad světlým i tmavým režimem. |
| **Do složek se vchází, nerozbalují se** | Rozbalený strom byl s pár desítkami winů nečitelný. Vidět je vždy obsah jedné složky, cesta ven je v liště nad ní. Rozbalují se jen samotné winy - ty už další úroveň nemají. |
| **Několik pohledů na winy místo jedné tabulky** | Pětisloupcová tabulka odpovídala na všechny otázky naráz a na žádnou pořádně. Pohledy (Stručně / Postup / Dnešek / Žebříček / Úplná tabulka) se přepínají v Nastavení, výchozí je nejstručnější. |
| **Kalendář po celých rocích** | "Posledních 53 týdnů" začínalo uprostřed loňska a nešlo se podle toho zorientovat. Rok je pevná jednotka, mřížka se sama posune na dnešek. |
| **Import po částech, ne všechno naráz** | Appka má dvě nezávislé poloviny (strom a projekty). Kdo si tahá projekty odjinud, nesmí tím smazat strom, co si vede měsíce. Proto se u zálohy vybírá rozsah a jestli se přidává nebo nahrazuje — a napřed se ukáže náhled se skutečnými počty "po načtení". |
| **Ikona jako string s předponou** | Emoji se ukládá rovnou, kreslená ikona jako `lucide:Dumbbell`. Stará data zůstala platná a nic se nemigrovalo. Komponenty se importují jmenovitě, aby v balíku neskončilo všech 1500 ikon knihovny. |
| **Ikonu má jen složka, ne win** | Winy poznává oko podle druhu (měrák / fajfka / hvězda) a vlastní ikona by ten rozdíl zakryla. Složka bez vybrané ikony zůstává kresleným `Folder`, takže strom bez jediné ikony vypadá jako dřív a nic se nemigrovalo. |
| **ToDo je samostatný seznam, ne třetí pohled na projekty** | Kdo si chce odškrtnout, co má koupit, nemá kvůli tomu zakládat projekt s procenty a deadlinem. Položka umí čtyři věci - napsat, odškrtnout, přepsat, smazat - a nic víc: kdyby si žádala nastavení, byl by to úkol a ten už v appce je. |
| **Odškrtnutá položka se maže sama po 6 h** | Hned by nešla vrátit omylem odškrtnutá věc a odpoledne by nebylo vidět, co za den odpadlo. Později by z toho byl druhý archiv - na to jsou projekty. Do té doby leží pod otevřenými, nejnovější první, takže postupně klesá a zmizí odspodu. |
| **Indikátor času je vlasový pruh bez čísla** | Šedý, 2 px, přepočet po minutě. Číslo ani barva se schválně nekreslí: pruh nemá říkat, kolik zbývá, jen že se s tím něco děje. Kdo to nechce vidět, nevidí to. |
| **Appka se otevírá na ToDo, když je co odškrtnout** | Bez `?tab=` v adrese rozhoduje seznam - něco otevřeného = ToDo, prázdno = Přehled. Rozhodne se **jednou při otevření** a dál se drží: kdyby se to počítalo při každém renderu, odškrtnutí poslední položky by pod rukama přehodilo záložku na Přehled právě ve chvíli, kdy si chce člověk prohlédnout, co dodělal. |
| **Přejetí prstem mezi sekcemi** | Tři sekce vedle sebe (Projekty - Strom - Analýza), doleva dál, doprava zpět. Necyklí se: "swipe mě vrátil na začátek" je nepříjemné překvapení a člověk pak neví, kde v řadě stojí. V detailech neplatí - odvedlo by od rozdělané práce a v úkolu si vodorovný tah bere posuvník. |
| **Gesto se pozná až po puštění** | Přejetí musí vyhrát nad scrolováním a to se dá rozhodnout jedině z celého tvaru pohybu: 64 px do strany, nejmíň 1,6× víc než nahoru/dolů, do 700 ms. Uvnitř vodorovného scrolleru (kalendář roku, cesta ve stromu, široká tabulka) patří gesto jemu - ale jen dokud tam je kam posouvat, doscrollovaná tabulka prst nepotřebuje. Myš ne: tahem myši se vybírá text. |

---

## 4. Známá omezení

- **Data jsou vázaná na prohlížeč a zařízení.** Jiný počítač = jiná data. Záloha je ruční přes export JSON.
- **Bez přihlášení a bez synchronizace.**
- **Bez undo.** Smazání uzlu/projektu je nevratné (dialog aspoň ukáže, co všechno zmizí).
- **Přetahovat jde jen ve vlastním pořadí** — v řazení podle názvu nebo postupu úchyty zmizí, protože puštěný řádek by okamžitě odskočil zpátky.
- **Ploché „Úkoly" napříč projekty se přetahovat nedají** — míchají rodiče i podúkoly do jednoho seznamu, takže pořadí v nich nemá kam se uložit.
- **Přílohy u úkolů nejsou** (referenční aplikace je má).
- **Historie postupu se nedá zpětně opravit** — otisk vzniká v den změny.
- Grafy nemají textovou alternativu (tabulku hodnot) pro čtečky, jen `aria-label`.

---

## 5. Návrhy do budoucna

### 5.1 Migrace na SQLite (hlavní kandidát)

Sedí to na stack z `ToDo` (Prisma + `better-sqlite3`) a řeší zálohu i práci z víc zařízení. Doménová vrstva je čistá, takže se nemění — mění se jen to, odkud stav přichází.

**Schéma zhruba 1:1 s `src/lib/types.ts`:**

```prisma
model TreeNode {
  id          String   @id
  parentId    String?
  kind        String   // "category" | "metric"
  name        String
  unit        String?
  aggregation String?  // "sum" | "max"
  createdAt    DateTime
  parent      TreeNode?  @relation("tree", fields: [parentId], references: [id], onDelete: Cascade)
  children    TreeNode[] @relation("tree")
  entries     Entry[]
  microwins   Microwin[]
}

model Entry {
  id        String   @id
  metricId  String
  date      String   // YYYY-MM-DD, lokální den
  value     Float
  note      String?
  backdated Boolean
  createdAt DateTime
  metric    TreeNode @relation(fields: [metricId], references: [id], onDelete: Cascade)
  @@index([metricId, date])
}

model Microwin {
  id             String   @id
  metricId       String
  date           String
  value          Float
  previousRecord Float
  firstEver      Boolean
  createdAt      DateTime
  metric         TreeNode @relation(fields: [metricId], references: [id], onDelete: Cascade)
  @@unique([metricId, date])   // pravidlo "jeden microwin na metriku a den" vynutí databáze
  @@index([date])
}

model Project  { /* name, icon, startDate, deadline, description, order, archivedAt */ }
model Task     { /* projectId, parentId, name, icon, target, current, unit, step, weight, dueDate, milestoneId, description, order, completedAt */ }
model Milestone{ /* projectId, name, date */ }
model Snapshot { /* projectId, date, percent */  // @@unique([projectId, date]) }
```

**Postup:**

1. `npm i prisma @prisma/client better-sqlite3` + `prisma/schema.prisma`, `npx prisma migrate dev`.
2. `src/lib/repository.ts` — načtení celého stavu (`loadState()`) a zápis změn. Datové sady jsou malé (stovky řádků), takže „načti všechno do paměti, ulož diff" je v pohodě a `domain.ts` / `projects.ts` zůstanou beze změny.
3. Akce z `actions.ts` a `project-actions.ts` obalit **Server Actions** — čisté funkce spočítají nový stav, server action ho uloží. Pravidla zůstávají otestovaná tam, kde jsou teď.
4. `StoreProvider` místo `loadState()` z localStorage dostane počáteční stav ze serveru a po každé akci si vyžádá `revalidate`.
5. **Migrace dat:** existující `localStorage` export (dialog Data → Exportovat JSON) nacpat do importního endpointu. Formát je stejný jako `MicroWinsState`, takže stačí `prisma.$transaction` s `createMany`.
6. Nechat `localStorage` jako offline cache — aplikace pak funguje i bez běžícího serveru.

**Pozor při migraci:** datum se všude drží jako `YYYY-MM-DD` string v *lokálním* čase. Nepřevádět na `DateTime`, jinak se přes půlnoc a přes letní čas rozjede „dnešek" a microwiny se začnou počítat ke špatnému dni.

### 5.2 Vizuál podle harnessu a 21st.dev

Připraveno: `components.json`, `cn()` (clsx + tailwind-merge), shadcn CSS proměnné v `globals.css`, `components/ui/` se stejným API jako shadcn. Výměna primitiv (Dialog, Button, Card, Select) za komponenty z 21st.dev by neměla sáhnout do volajícího kódu. Nejvíc by si polepšily: dialogy (Radix + animace), select, toast, prázdné stavy.

### 5.3 Funkční nápady

| Nápad | Poznámka |
|---|---|
| **Drag & drop pořadí** | logika (`moveProject`, `moveTask`) už existuje, chybí jen UI |
| **Undo / koš** | 30denní soft-delete místo tvrdého mazání |
| **Cíle na metriku** | „chci 10 cold calls denně" — vedle rekordu i denní cíl a jeho plnění |
| **Týdenní / měsíční rekordy** | teď je rekord jen denní; týdenní součet je přirozené rozšíření |
| **Připomínka na sérii** | notifikace, když se blíží půlnoc a dnešek je bez microwinu |
| **PWA + offline instalace** | s localStorage je to skoro zadarmo, dá se to na mobil |
| **Propojení projektů a stromu** | posun úkolu by mohl volitelně zapsat i záznam do metriky (např. „X kliků za den") |
| **Přílohy a odkazy u úkolů** | referenční aplikace je má |
| **Vlastní ikony metrik a kategorií** | teď má emoji jen projekt a úkol |
| **Grafy jako tabulka** | přepínač „zobrazit data" kvůli přístupnosti |
| **E2E testy (Playwright)** | doménová logika je pokrytá, proklik UI zatím ne |

### 5.4 Drobnosti

- Heatmapa v analýze je natvrdo na 18 týdnů — udělat volitelné (rok / vše).
- „Tempo %/den" počítá lineárně do deadlinu; šlo by ukázat i skluz proti ideální čáře přímo v grafu.
- Prahové barvy: projekt po termínu je červený, ale graf to nereflektuje.

---

## 6. Orientace v kódu

```
src/lib/
  types.ts            datový model (strom, projekty, otisky)
  domain.ts           PRAVIDLA MICROWINŮ - rekordy, vyhodnocení zápisu, popisky s X
  actions.ts          přechody stavu stromu (+ syncTodayMicrowin)
  projects.ts         výpočty postupu, řady pro graf, filtry
  project-actions.ts  CRUD projektů a úkolů (+ snapshotProject)
  stats.ts            série, kalendář roku, přehled winů
  todos.ts            jednoduchý seznam (přidat, odškrtnout, mazání po 6 h)
  storage.ts          localStorage + export/import  ← jediné místo k výměně za DB
  backup.ts           záloha celé appky (stav + nastavení), sdílení souboru
  prefs.ts            nastavení zobrazení mimo hlavní stav
  icons.ts            katalog ikon pro projekty (emoji + lucide)
  import.ts           slučování zálohy se stavem (rozsah + přidat/nahradit)
  live-update.ts      živé aktualizace balíku z GitHubu
```

Pravidlo, které se vyplatí držet: **v `lib/` žádný React, v komponentách žádná byznys logika.** Díky tomu jde celé chování microwinů i projektů otestovat bez renderu (`actions.test.ts`, `projects.test.ts`).
