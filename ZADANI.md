# Zadání z poznámek (16. 8. 2026)

**Poznámka:** „Music player — a pdf reader (readera)."

Tedy: jedna appka, dvě role — přehrávač hudby **a** čtečka dokumentů. Obojí
v appce už je, takže tohle není stavba od nuly, ale dotažení čtečky na
úroveň přehrávače.

## Co dnes čtečka umí

[src/app/page.tsx:418](src/app/page.tsx) načte PDF přes `pdfjs-dist`, vytáhne
textovou vrstvu a poskládá stránky do `DocumentPage[]`. Čte se to nahlas
přes `window.speechSynthesis`. Čtečka se dá vypnout v Nastavení
(`microwins:reader_addon`).

## Co dodělat

**1. PDF bez textové vrstvy.** Naskenovaný dokument dnes skončí hláškou
„Zkus PDF s textovou vrstvou nebo TXT soubor"
([page.tsx:447](src/app/page.tsx)). Minimum: rozpoznat ten případ dřív
a říct rovnou, že dokument je obrázkový, ne nabízet čtení, které nikdy
nepůjde.

**2. Zapamatovat, kde uživatel skončil.** Po zavření dokumentu se má při
příštím otevření pokračovat na stejné stránce, stejně jako přehrávač ví,
kde je ve skladbě.

**3. Čtení nahlas jako pořádné přehrávání.** Dnes je TTS zvlášť od hudebního
přehrávače. Má se ovládat stejnými prvky: pauza, skok o stránku zpět/vpřed,
rychlost. Když čte řeč, hudba mlčí a naopak — dva zvuky přes sebe nedávají
smysl.

**4. Ať dokument přežije restart.** Vybraný soubor se dnes drží jen v paměti
stránky. Uložit ho k sobě (Filesystem v telefonu, IndexedDB v prohlížeči),
ať se knihovna dokumentů chová jako knihovna hudby.

## Hotovo, když

Otevřu PDF, začnu ho poslouchat, appku zavřu a po otevření pokračuju tam, kde
jsem skončil; obrázkové PDF řekne jasně, proč nejde přečíst; a při čtení
nahlas nehraje hudba přes to.

## Doručení

Všechno je `src/`, takže to jde **balíčkem živé aktualizace**
(`npm run ota:bundle` + push). Nové APK potřeba není.
