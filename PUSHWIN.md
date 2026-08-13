# PushWin

Implementováno. Doména je v `src/lib/pushwin.ts` (čisté funkce, testy
v `pushwin.test.ts`), obrazovka v `src/components/pushwin/pushwin-card.tsx`.

## Co to je

Jednou týdně si uživatel může nechat vylosovat **výzvu** - konkrétní, měřitelný
úkol postavený z jeho vlastních dat a nastavený **kousek za hranici toho, co už
dokázal**. Splní ji do konce týdne, nebo propadne.

Microwin říká „dnes to bylo lepší než kdy dřív". PushWin říká „zkus tohle".
Rozdíl je v tom, kdo určuje laťku: microwin ji čte z historie zpětně, PushWin
ji staví dopředu.

## Proč jednou týdně

Denní výzva by se stala druhým seznamem úkolů a přebila by microwiny, které
mají zůstat hlavní hrou. Týden je taky nejkratší okno, do kterého se vejde
špatný den - výzva na 24 hodin trestá nemoc a služební cestu, výzva na týden ne.

Losování je proto **jednou za kalendářní týden** (pondělí-neděle). Nevyužité
losování se nepřenáší.

## Kdy se odemkne

Po **50 microwinech**. Do té doby se v Nastavení nic neukazuje - dřív by
generátor neměl z čeho stavět laťku a výzvy by byly buď triviální, nebo
nesplnitelné. Padesát je zhruba měsíc a půl běžného používání, tedy okamžik,
kdy už má strom tvar a je vidět, co uživatel vlastně dělá.

Po odemčení přibude v Nastavení přepínač **PushWins** (výchozí vypnuto) -
jde o hru navíc, ne o povinnost.

## Losování

Vizuálně jako otevírání bedny: vodorovný pás výzev projíždí kolem značky,
zpomaluje a dojede na jednu. Trvá to ~3 vteřiny a je to jediné místo v appce,
kde je ozdoba schválně delší, než by musela být - napětí je celý smysl.

Losuje se ve dvou krocích:

1. **Obtížnost** podle nastavených šancí (viz níž).
2. **Typ výzvy** z těch, které jdou pro daného uživatele vůbec postavit.

Druhý krok je nutný: kdo nemá jedinou číselnou metriku, nemůže dostat výzvu na
rekord. Generátor proto nejdřív sestaví seznam **splnitelných kandidátů** a
teprve z nich losuje. Když je seznam prázdný (čerstvý strom, samé `once` winy),
losování se nenabídne vůbec - lepší než vylosovat něco, co nejde splnit.

## Obtížnosti

| Obtížnost | Laťka | Šance (výchozí) |
|---|---|---|
| Lehká | 60 % cesty od běžné hodnoty k rekordu, pod rekordem | 55 % |
| Střední | rekord překonat o krok | 30 % |
| Těžká | rekord o desetinu výš | 15 % |

Šance jsou v Nastavení posuvníkem - kdo chce jen těžké, ať je má. Na nulu
nemůžou spadnout všechny naráz.

Laťka se **vždy** počítá z dat uživatele, nikdy z pevného čísla. Kdo má
záznamy mezi 30 a 40 (typicky 34, rekord 40), dostane lehkou na 38, střední
na 41 a těžkou na 44. Běžná hodnota je **medián**, ne průměr - jeden výstřel
nesmí posunout laťku na měsíc dopředu. Dělá to `ladder()`.

Když pro vylosovanou obtížnost není z čeho stavět, sáhne se po lehčí. Nic
nevylosovat je lepší než vylosovat nesplnitelné, ale nabídnout aspoň něco je
lepší než nic.

## Typy výzev

Rozdělené podle toho, jak se pozná splnění. To je nejdůležitější osa: výzva,
kterou by musel uživatel odškrtávat ručně, je výzva, u které se dá lhát.

### A. Vyhodnotí se samy z dat

Tyhle jsou jádro. Nic se neodškrtává - appka splnění pozná ve chvíli, kdy se
zapíše záznam.

| Výzva | Příklad | Laťka z dat |
|---|---|---|
| **Nádech** - X microwinů za jeden den | „5 microwinů v jednom dni" | nejlepší den za 30 dní +1 |
| **Série** - X dní po sobě aspoň jeden microwin | „6 dní v řadě" | současná nejdelší série +1 |
| **Rekord v metrice** - překonat konkrétní číslo | „35 kliků v jedné sérii" | poslední rekord + 5-15 % |
| **Návrat** - microwin ve složce, kde je ticho | „něco v Business" | složka bez winu 14+ dní |
| **Šířka** - microwiny ve třech různých složkách | „3 složky za týden" | počet aktivních složek za 30 dní |
| **Objem** - součet metriky za týden | „celkem 200 kliků" | týdenní průměr × 1,2 |
| **Prvenství** - zapsat win, který ještě nikdy nepadl | „nový win v Zdraví" | vždy splnitelné |
| **Ráno** - X winů zapsaných před polednem | „3 dopolední winy" | nepostaveno, viz Co zůstalo otevřené |

Postavené jsou: **Nádech**, **Série**, **Rekord**, **Objem**, **Šířka**,
**Návrat**. „Ráno" ne - viz Otevřené otázky.

### B. Odškrtávají se ručně

**Nedělají se.** Výzva, kterou si člověk odklikne sám, se od obyčejného `once`
winu neliší ničím než tím, že ji vymyslel počítač - a přitom si vyžádá celou
vrstvu UI na potvrzování.

## Jak se splnění zapisuje

Vždycky odvozeně, nikdy tlačítkem. Po každém zápisu záznamu se přepočítá
podmínka běžící výzvy; když sedí, výzva se označí za splněnou, uloží se
**seznam microwinů, které ji naplnily**, a přehraje se oslava.

Ten seznam je důležitý: bez něj by u splněné výzvy zbylo jen „hotovo" a po
měsíci by nikdo nevěděl, čím. S ním se dá rozkliknout „6 microwinů v jednom
dni" a vidět, kterých šest to bylo.

Přepočet je čistá funkce nad stavem, takže se dá spustit i zpětně - to řeší
zpětně psané záznamy (`backdated`). Když někdo v pátek doplní čtvrteční
záznam, výzva se splní k tomu čtvrtku.

## Kalendář

Nad každým týdnem přibude proužek:

- **zelený** - výzva splněna
- **šedý obrys** - výzva běží
- **prázdný** - v tom týdnu se nelosovalo
- **červený** - výzva propadla

Klepnutí otevře detail: zadání, obtížnost, kolik zbývá do splnění a seznam
navázaných microwinů. Ten detail je jediné místo, kde se výzva dá i vzdát -
schválně schované, aby se to nedělalo omylem.

Propadlé výzvy se nemažou. Sedm zelených proužků v řadě je odměna, tři červené
jsou informace.

## Datový model

Nový seznam vedle `microwins`, mimo strom:

```ts
interface PushWin {
  id: string;
  /** Pondělí týdne, do kterého výzva patří. */
  week: ISODate;
  kind: PushWinKind;          // "burst" | "streak" | "record" | …
  difficulty: "easy" | "medium" | "hard";
  /** Cílové číslo (5 microwinů, 35 kliků, 6 dní). */
  target: number;
  /** Uzel, kterého se výzva týká; null = napříč stromem. */
  nodeId: string | null;
  /** Text zadání zamrzlý při losování - strom se může změnit. */
  text: string;
  drawnAt: string;
  completedAt: string | null;
  /** Microwiny, které výzvu naplnily. */
  microwinIds: string[];
}
```

Zamrznutý `text` je schválně: kdyby se skládal až při zobrazení, přejmenovaná
nebo smazaná složka by výzvu zpětně přepsala.

Do zálohy patří stejně jako zbytek stavu; při importu „jen strom" jedou
výzvy s ním. `pushExempt` je příznak na `TreeNode`.

## Rozhodnuté otázky

1. **Zpětné zápisy se nepočítají.** Do výzvy jde jen microwin, za kterým stojí
   záznam psaný v ten den (`backdated === false`). Zpětné doplnění je pravda
   o minulosti, ale výzva je o tom, co člověk udělá teď - jinak by šla splnit
   dopsáním včerejška. Hlídá to `countsForPush`.
2. **Odložené složky.** Složka jde označit „mimo PushWiny" (`pushExempt`
   v jejím dialogu). Výzvy pak necílí na ni ani na nic pod ní - `pushableNodes`
   to řeší pro celý podstrom. Když uživatel složku rovnou smaže, běžící výzva
   na ni se **tiše zruší**, ne označí za propadlou: za úklid stromu se netrestá.
3. **Jedno losování týdně**, druhé se odemkne po 365 microwinech
   (`drawsPerWeek`). Nové losování jde až po dojetí toho předchozího, takže
   nejde točit, dokud nepadne něco lehkého.
4. **Konec výzvy** je splnění nebo neděle. Nová se losuje od pondělí a může
   padnout stejná - to je RNG, ne záměr.
5. **Notifikace** se zatím neřeší.

## Co zůstalo otevřené

- **„Ráno"** (X winů zapsaných před polednem) není postavené. `Entry` má
  `createdAt` s časem, takže by to šlo, ale u zpětně psaných záznamů to nedává
  smysl a pravidlo by se muselo lišit od ostatních výzev.
- **Vzdát výzvu** zatím nejde. Propadne sama v neděli.
