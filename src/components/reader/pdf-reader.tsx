"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  Bookmark,
  BookmarkCheck,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  Crop,
  List,
  Minus,
  Pause,
  Play,
  Plus,
  Search,
  Settings2,
  Sparkles,
  Volume2,
  X,
} from "lucide-react";
import { PdfPageView, type PageInfo, type PageMark, type PageSize } from "./pdf-page-view";
import { pdfSlot, readOutline, searchPages, type OutlineEntry, type SearchHit } from "@/lib/pdf";
import {
  clampZoom,
  loadReaderPrefs,
  saveReaderPrefs,
  type ReaderFlow,
  type ReaderPrefs,
  type ReaderTheme,
} from "@/lib/reader-prefs";
import { SpeechSettings } from "@/components/speech-settings";
import type { SpeechSegment } from "@/lib/documents";
import { cn } from "@/lib/utils";

/**
 * Čtečka PDF.
 *
 * Dokument se ukazuje tak, jak vypadá - vykreslené stránky pod sebou,
 * s obrázky, sazbou i tabulkami. Nad plátnem leží průhledná textová vrstva,
 * takže se dá text vybrat, najít v něm a zvýraznit v něm čtenou větu.
 *
 * Ovládání je stavěné na jednu ruku v telefonu: horní lišta se schová při
 * čtení a vrátí se klepnutím doprostřed stránky, dole zůstává posuvník
 * stránek. Vzhled (barvy, ořez okrajů, přiblížení) platí pro celou čtečku,
 * ne pro jednu knihu - kdo čte v noci, čte tak všechno.
 */

export interface ReaderSpeech {
  /**
   * Stránka, na které se čte.
   *
   * Nemusí to být ta na obrazovce - v knize, kterou zrovna posloucháš, se dá
   * listovat, aniž by hlas skákal za tebou.
   */
  page: number;
  /** Věty té stránky. */
  segments: SpeechSegment[];
  /** Která z nich se čte (nebo od které se bude pokračovat). */
  active: number;
  reading: boolean;
  /** „Číst odsud": stránka a pozice znaku v jejím textu. */
  onReadFrom: (page: number, offset: number) => void;
  onToggle: () => void;
}

export interface PdfReaderProps {
  pdf: PDFDocumentProxy;
  name: string;
  pageCount: number;
  /** Text stránek z knihovny; hledání jede přes něj, ne přes vykreslené strany. */
  pageTexts: string[];
  page: number;
  onPage: (page: number) => void;
  bookmarks: number[];
  onToggleBookmark: (page: number) => void;
  /** Poměr stran první stránky - drží místo těm ještě nevykresleným. */
  aspect: number;
  onClose: () => void;
  speech?: ReaderSpeech;
}

type Panel = "none" | "toc" | "find" | "look" | "voice";

/** Jedno prázdné pole pro všechny stránky bez značek - nové by je překreslovalo. */
const NO_MARKS: PageMark[] = [];

/** Kolik místa zbude po stranách stránky. */
const GUTTER = 8;

/**
 * Okno vykreslených stránek kolem té, na kterou se čte.
 *
 * Dopředu víc než dozadu - čte se odshora dolů, takže další stránka je
 * potřeba dřív než ta předchozí. Mimo okno stránka plátno pustí z ruky:
 * jinak by kniha o pěti stech stranách chtěla pět set pláten naráz a telefon
 * by ji odstřelil dřív, než by se čtenář dostal do půlky.
 */
const AHEAD = 2;
const BEHIND = 1;

/** Po kolika stránkách se ohlásí rozměry změřené na pozadí. */
const SIZE_BATCH = 24;

/** Měření rozměrů pouští před sebe každé kreslení - viz `pdfSlot`. */
const SWEEP_RANK = 9;

/**
 * Jak daleko od obrazovky ještě čtečka jede za čtenou větou.
 *
 * V obrazovkách. Poslouchat a přitom se dívat na stránku o kus dál je
 * normální - a v tu chvíli nemá nic samo odjíždět zpátky k hlasu. Když je
 * ale věta hned za okrajem (třeba se právě obrátil list), přisune se.
 */
const FOLLOW_REACH = 1.5;

/** Půlka nabídky „Číst odsud" - o tolik se drží od kraje obrazovky. */
const SPOT_HALF = 68;

/** Klepnutí výš než tohle si nabídku nechá pověsit pod prst, ne nad něj. */
const SPOT_FLIP = 130;

const THEME_LABELS: { id: ReaderTheme; label: string }[] = [
  { id: "day", label: "Den" },
  { id: "sepia", label: "Sépie" },
  { id: "night", label: "Noc" },
  { id: "console", label: "Konzole" },
];

export function PdfReader({
  pdf,
  name,
  pageCount,
  pageTexts,
  page,
  onPage,
  bookmarks,
  onToggleBookmark,
  aspect,
  onClose,
  speech,
}: PdfReaderProps) {
  const scroller = React.useRef<HTMLDivElement | null>(null);
  const stack = React.useRef<HTMLDivElement | null>(null);

  const [prefs, setPrefs] = React.useState<ReaderPrefs>(() => loadReaderPrefs());
  const [mounted, setMounted] = React.useState(false);
  const [panel, setPanel] = React.useState<Panel>("none");
  const [chrome, setChrome] = React.useState(true);
  const [viewWidth, setViewWidth] = React.useState(0);
  /** Rozměry stránek v bodech; `null` znamená „ještě nezměřeno". */
  const [sizes, setSizes] = React.useState<(PageSize | null)[]>([]);
  /** Stránka, kolem které se kreslí. Jde za obrazovkou, ne za hlášením ven. */
  const [center, setCenter] = React.useState(page);
  /** Jakou část šířky stránky zabírá sazba - podle ní se stránka roztáhne. */
  const [cropWidth, setCropWidth] = React.useState(1);
  const [outline, setOutline] = React.useState<OutlineEntry[] | null>(null);
  const [query, setQuery] = React.useState("");
  const [hits, setHits] = React.useState<SearchHit[]>([]);
  const [hit, setHit] = React.useState(0);
  /** Přiblížení během štípnutí dvěma prsty; stránky se překreslí až po něm. */
  const [pinch, setPinch] = React.useState(1);

  const scrolling = React.useRef(false);
  const wanted = React.useRef(page);

  React.useEffect(() => setMounted(true), []);
  React.useEffect(() => saveReaderPrefs(prefs), [prefs]);

  /*
    Šířka okna rozhoduje, jak velká stránka je - a mění se otočením telefonu.
    Měří se až po prvním vykreslení: dokud se čtečka nepřestěhuje na <body>,
    žádné okno k měření není.
  */
  React.useEffect(() => {
    const node = scroller.current;
    if (!node) return;
    const measure = () => setViewWidth(node.clientWidth);
    measure();
    const watcher = new ResizeObserver(measure);
    watcher.observe(node);
    return () => watcher.disconnect();
  }, [mounted]);

  /**
   * Rozměry stránek se změří dřív, než se cokoli nakreslí.
   *
   * **Tohle je to skákání.** Dokud se velikost stránky brala z hotového
   * plátna, měl seznam do posledního vykreslení špatné výšky: každá stránka
   * se v okamžiku dokreslení o kus srazila nebo natáhla, sloupec se posunul
   * a text ujel čtenáři pod prstem. Rozměr přitom PDF zná od začátku a dá
   * se přečíst bez kreslení - jen se na to musí zeptat.
   *
   * Měří se na pozadí a po dávkách: u tlusté knihy je to pár set otázek do
   * workeru a čekat na poslední z nich by znamenalo koukat na prázdno.
   */
  React.useEffect(() => {
    let alive = true;
    setSizes(new Array(pageCount).fill(null));

    void (async () => {
      const found: (PageSize | null)[] = new Array(pageCount).fill(null);
      for (let at = 0; at < pageCount; at += 1) {
        if (!alive) return;
        // Slot se bere a zase pouští u každé stránky zvlášť. Kreslení, které
        // si mezitím řeklo o slovo, se tak dostane na řadu hned za tou právě
        // měřenou - u tlusté knihy je to rozdíl mezi „stránka je tu hned"
        // a „chvíli koukáš na prázdno".
        const done = await pdfSlot(SWEEP_RANK);
        try {
          const view = (await pdf.getPage(at + 1)).getViewport({ scale: 1 });
          found[at] = { width: view.width, height: view.height };
        } catch {
          // Rozbitá stránka podrží místo podle sousedů, ať se seznam nesesype.
        } finally {
          done();
        }
        // První stránka hned - podle ní se počítá přiblížení celé knihy.
        if (at === 0 || (at + 1) % SIZE_BATCH === 0) {
          if (!alive) return;
          setSizes([...found]);
        }
      }
      if (alive) setSizes(found);
    })();

    return () => {
      alive = false;
    };
  }, [pdf, pageCount]);

  /** Velikost stránky. Nezměřená si vypůjčí tu první - ta sedí skoro vždycky. */
  const fallbackSize = React.useMemo<PageSize>(
    () => ({ width: 600, height: 600 / (aspect || 0.72) }),
    [aspect],
  );

  const sizeOf = React.useCallback(
    (index: number): PageSize => sizes[index] ?? sizes[0] ?? fallbackSize,
    [sizes, fallbackSize],
  );

  /**
   * Přiblížení.
   *
   * `zoom` 1 znamená „stránka přes celou šířku". Kdyby se počítalo z pevného
   * čísla, na tabletu by kniha zůstala v proužku uprostřed a na telefonu by
   * přetékala - a to je zrovna to, co má čtečka řešit za uživatele.
   */
  const scale = React.useMemo(() => {
    if (!viewWidth) return 1;
    const usable = Math.max(160, viewWidth - GUTTER * 2);
    // Ořez se do měřítka promítne jen tehdy, když se opravdu ořezává. Jinak
    // by se stránka zvětšovala podle okrajů, které jsou pořád vidět.
    const share = prefs.crop ? cropWidth : 1;
    return (usable / (sizeOf(0).width * share)) * prefs.zoom;
  }, [viewWidth, cropWidth, prefs.crop, prefs.zoom, sizeOf]);

  /**
   * Okraje se změří jednou za knihu.
   *
   * Tohle byla ta blikačka. Ořez se počítá z vykreslených pixelů, měřítko se
   * počítá z ořezu - a stránka se překresluje, když se měřítko změní. Jedno
   * tak dokola krmilo druhé: nové měřítko dalo jinak vypadající plátno, z něj
   * vyšel o kousek jiný ořez, ten zase pohnul měřítkem. Stránka se překreslovala
   * několikrát za vteřinu, text pod prstem mizel a předčítání se nemělo čeho
   * chytit. Změřit stačí jednou; kniha má okraje po celou dobu stejné.
   */
  const cropMeasured = React.useRef(false);

  React.useEffect(() => {
    cropMeasured.current = false;
    restored.current = false;
    setCropWidth(1);
  }, [pdf]);

  const pageReady = React.useCallback((index: number, info: PageInfo) => {
    // Rozměr z vykreslené stránky je jistota navíc: dorovná odhad tam, kde se
    // měření na pozadí ještě nedostalo.
    setSizes((previous) => {
      if (previous[index]) return previous;
      const next = [...previous];
      next[index] = { width: info.width, height: info.height };
      return next;
    });
    if (cropMeasured.current) return;
    if (index !== 0 && index !== wanted.current) return;
    cropMeasured.current = true;
    const width = info.crop.right - info.crop.left;
    setCropWidth(width > 0.2 ? width : 1);
  }, []);

  // --- listování ------------------------------------------------------------

  /** Stránka, na kterou se čte - ta, která zabírá střed obrazovky. */
  const readCurrentPage = React.useCallback((): number => {
    const node = scroller.current;
    if (!node) return page;
    const middle = node.getBoundingClientRect().top + node.clientHeight * 0.4;
    const pages = node.querySelectorAll<HTMLElement>("[data-pdf-page]");
    let best = 0;
    for (const element of pages) {
      const rect = element.getBoundingClientRect();
      if (rect.top <= middle) best = Number(element.dataset.pdfPage ?? 0);
      else break;
    }
    return best;
  }, [page]);

  const scrollToPage = React.useCallback((index: number, behavior: ScrollBehavior = "auto") => {
    const node = scroller.current;
    const target = node?.querySelector<HTMLElement>(`[data-pdf-page="${index}"]`);
    if (!node || !target) return;
    // Okno kreslení se posune hned, ne až rolování dojede: skok na dvoustou
    // stránku má začít kreslit dvoustou stránku, ne tu, od které se odjíždí.
    setCenter(index);
    scrolling.current = true;
    node.scrollTo({ top: node.scrollTop + target.getBoundingClientRect().top - node.getBoundingClientRect().top, behavior });
    window.setTimeout(() => {
      scrolling.current = false;
    }, behavior === "smooth" ? 600 : 120);
  }, []);

  // Stránka zvenčí (obsah, hledání, dočtená stránka při předčítání).
  React.useEffect(() => {
    if (page === wanted.current) return;
    wanted.current = page;
    scrollToPage(page);
  }, [page, scrollToPage]);

  /**
   * Otevřít knihu tam, kde se skončilo.
   *
   * Rozměry stránek dojdou po dávkách, takže se sloupec ještě chvíli po
   * otevření usazuje. Dokud čtenář sám nikam nešel, drží se proto stránka, ne
   * počet bodů odshora - jinak by se kniha po každé dávce o kus posunula.
   * První vlastní dotek to vypne: kdo si odroloval jinam, tam má zůstat.
   */
  const restored = React.useRef(false);
  const touched = React.useRef(false);

  React.useEffect(() => {
    restored.current = false;
    touched.current = false;
  }, [pdf]);

  React.useEffect(() => {
    if (!sizes[0] || !viewWidth) return;
    restored.current = true;
    if (touched.current) return;
    scrollToPage(wanted.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sizes, viewWidth]);

  /**
   * Přiblížení a otočení telefonu drží čtenáře na téže stránce.
   *
   * Posun se počítá v bodech odshora, ale zvětšená kniha je vyšší - stejné
   * číslo pak ukazuje jinam. Kdo si na třicáté stránce přiblížil písmo,
   * skončil o pět stran vedle a musel se hledat. Stránka je to, co drží.
   */
  const lastScale = React.useRef(0);

  React.useEffect(() => {
    if (!sizes[0] || !viewWidth) return;
    if (!lastScale.current) {
      lastScale.current = scale;
      return;
    }
    if (Math.abs(scale - lastScale.current) < 0.0005) return;
    lastScale.current = scale;
    scrollToPage(wanted.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale, sizes, viewWidth]);

  /**
   * Hlášení stránky ven počká, až se rolování zastaví.
   *
   * Rodič si na každé změně stránky přepíše stav, zapíše postup na disk
   * a předčítání pošle na začátek stránky. Při hlášení z každého snímku
   * rolování se tím appka dusila a čtení nahlas se pořád restartovalo.
   */
  const settle = React.useRef(0);

  React.useEffect(() => () => window.clearTimeout(settle.current), []);

  const onScroll = () => {
    if (spot) setSpot(null);
    const at = readCurrentPage();
    // Okno kreslení jde za obrazovkou i během vlastního posunu čtečky - jinak
    // by po skoku na jinou stránku nebylo co ukázat.
    setCenter(at);
    if (scrolling.current) return;
    touched.current = true;
    /*
      Než se kniha otevře na uložené stránce, stojí sloupec na začátku - a při
      usazování rozvržení z něj chodí posuny. Ohlásit je ven znamenalo přepsat
      uloženou stránku nulou dřív, než se na ni stačilo skočit: kniha se pak
      pokaždé otevřela na první straně a čtenář se musel hledat znovu.
    */
    if (!restored.current) return;
    if (at === wanted.current) return;
    wanted.current = at;
    window.clearTimeout(settle.current);
    settle.current = window.setTimeout(() => onPage(at), 140);
  };

  // --- štípnutí dvěma prsty --------------------------------------------------

  const gesture = React.useRef<{ span: number; zoom: number } | null>(null);

  const touchStart = (event: React.TouchEvent) => {
    if (event.touches.length !== 2) return;
    gesture.current = { span: fingerSpan(event.touches), zoom: prefs.zoom };
  };

  const touchMove = (event: React.TouchEvent) => {
    const start = gesture.current;
    if (!start || event.touches.length !== 2) return;
    const span = fingerSpan(event.touches);
    if (span <= 0 || start.span <= 0) return;
    // Během gesta se jen roztahuje hotový obraz. Překreslovat plátna v každém
    // snímku by z plynulého štípnutí udělalo trhané čekání.
    setPinch(clampZoom(start.zoom * (span / start.span)) / start.zoom);
  };

  const touchEnd = () => {
    const start = gesture.current;
    if (!start) return;
    gesture.current = null;
    const zoom = clampZoom(start.zoom * pinch);
    setPinch(1);
    setPrefs((previous) => ({ ...previous, zoom }));
  };

  // --- hledání ---------------------------------------------------------------

  React.useEffect(() => {
    if (query.trim().length < 2) {
      setHits([]);
      return;
    }
    const timer = window.setTimeout(() => {
      const found = searchPages(pageTexts, query);
      setHits(found);
      setHit(0);
      if (found.length) {
        wanted.current = found[0].page;
        onPage(found[0].page);
        // Skočit tam musí i obraz, ne jen číslo stránky dole.
        window.setTimeout(() => scrollToPage(found[0].page, "smooth"), 60);
      }
    }, 220);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, pageTexts, scrollToPage]);

  const goToHit = (index: number) => {
    if (!hits.length) return;
    const at = (index + hits.length) % hits.length;
    setHit(at);
    wanted.current = hits[at].page;
    onPage(hits[at].page);
    scrollToPage(hits[at].page, "smooth");
  };

  // --- obsah knihy -----------------------------------------------------------

  const openOutline = async () => {
    setPanel("toc");
    if (outline) return;
    setOutline(await readOutline(pdf));
  };

  // --- značky na stránkách ---------------------------------------------------

  const marks = React.useMemo(() => {
    const map = new Map<number, PageMark[]>();
    const add = (index: number, mark: PageMark) => {
      const list = map.get(index);
      if (list) list.push(mark);
      else map.set(index, [mark]);
    };

    hits.forEach((found, index) =>
      add(found.page, { start: found.start, end: found.end, kind: index === hit ? "find-active" : "find" }),
    );

    // Zvýrazní se věta, která se čte nebo od které se bude pokračovat, a to
    // na stránce, kde se čte - ne na té, kterou má čtenář zrovna před očima.
    // Na čerstvě otevřené knize se nečte a nikde se neskončilo, takže by
    // obtažená první věta byla jen oranžová klika přes půl titulní strany.
    const spoken = speech && (speech.reading || speech.active > 0) ? speech.segments[speech.active] : null;
    if (spoken) add(speech!.page, { start: spoken.start, end: spoken.end, kind: "speech" });

    return map;
    // Rodič skládá `speech` při každém překreslení znovu, takže se sleduje
    // jeho obsah, ne totožnost objektu - jinak se značky počítají pořád dokola.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hits, hit, speech?.segments, speech?.active, speech?.reading, speech?.page]);

  /**
   * Čtená věta zůstává na obrazovce - dokud se čtenář nedívá jinam.
   *
   * Obdélníky vzniknou až po překreslení stránky, proto to čekání - jinak by
   * se posouvalo na místo, které ještě neexistuje.
   *
   * `page` tu schválně není: dokud v seznamu bylo, stačilo odrolovat o kus
   * níž a čtečka se hned odsunula zpátky k hlasu. Jede se za **větou**, ne za
   * tím, kam se čtenář dívá - a jen když je věta na dohled.
   */
  React.useEffect(() => {
    if (!speech?.reading) return;
    const timer = window.setTimeout(() => {
      const node = scroller.current;
      const mark = node?.querySelector<HTMLElement>('.pdf-mark[data-mark="speech"]');
      if (!node || !mark) return;

      const view = node.getBoundingClientRect();
      const box = mark.getBoundingClientRect();
      const reach = view.height * FOLLOW_REACH;
      if (box.bottom < view.top - reach || box.top > view.bottom + reach) return;

      // Posun za čtenou větou se nesmí vrátit zpátky jako "čtenář listuje".
      // Bez tohohle si čtečka z vlastního posunu odvodila jinou stránku
      // a ohlásila ji ven jako novou pozici ve čtení.
      scrolling.current = true;
      mark.scrollIntoView({ block: "center", behavior: "smooth" });
      window.setTimeout(() => {
        scrolling.current = false;
      }, 600);
    }, 90);
    return () => window.clearTimeout(timer);
  }, [speech?.active, speech?.reading, speech?.page]);

  /**
   * Klepnutí do textu nabídne „Číst odsud", nepřesune čtení samo.
   *
   * Do teď hlas skočil rovnou tam, kam se kleplo. Do textu se přitom omylem
   * trefí kdekdo - stačí se při rolování dotknout stránky - a přijít tím
   * o místo, kde člověk poslouchal, je horší než klepnout dvakrát. Nabídka
   * navíc drží pravidlo, že se čtení stěhuje jen čtením nebo úmyslem.
   */
  const [spot, setSpot] = React.useState<{ page: number; offset: number; x: number; y: number } | null>(null);

  const tapText = React.useCallback(
    (index: number, offset: number, x: number, y: number) => {
      if (!speech) return;
      setSpot({ page: index, offset, x, y });
    },
    [speech],
  );

  const marked = bookmarks.includes(page);
  const pages = React.useMemo(() => Array.from({ length: pageCount }, (_, index) => index), [pageCount]);

  /*
    Čtečka visí na <body>, ne v sekci s obsahem.
    Sekce se při přepnutí přesouvá (animate-in-up) a posunutý předek dělá
    ze všeho uvnitř svůj vlastní rámec - okno přes celou obrazovku by se do něj
    schovalo a smrsklo na nulovou výšku.
  */
  if (!mounted) return null;

  return createPortal(
    <div className="pdf-reader" data-theme={prefs.theme} data-chrome={chrome ? "on" : "off"}>
      <div className="pdf-bar">
        <button type="button" onClick={onClose} className="pdf-tool" aria-label="Zpět na knihovnu">
          <ChevronLeft className="size-5" />
        </button>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{name}</span>
        <button
          type="button"
          onClick={() => setPanel(panel === "find" ? "none" : "find")}
          className={cn("pdf-tool", panel === "find" && "pdf-tool-on")}
          aria-label="Hledat v dokumentu"
        >
          <Search className="size-5" />
        </button>
        <button
          type="button"
          onClick={() => (panel === "toc" ? setPanel("none") : void openOutline())}
          className={cn("pdf-tool", panel === "toc" && "pdf-tool-on")}
          aria-label="Obsah"
        >
          <List className="size-5" />
        </button>
        <button
          type="button"
          onClick={() => onToggleBookmark(page)}
          className={cn("pdf-tool", marked && "pdf-tool-on")}
          aria-label={marked ? "Zrušit záložku" : "Přidat záložku"}
        >
          {marked ? <BookmarkCheck className="size-5" /> : <Bookmark className="size-5" />}
        </button>
        {/*
          Hlas patří ke čtečce, ne do nastavení celé appky: řeší se přesně
          tehdy, když si někdo pustí knihu nahlas a hlas mu nesedí.
        */}
        {speech ? (
          <button
            type="button"
            onClick={() => setPanel(panel === "voice" ? "none" : "voice")}
            className={cn("pdf-tool", panel === "voice" && "pdf-tool-on")}
            aria-label="Hlas předčítání"
          >
            <Volume2 className="size-5" />
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => setPanel(panel === "look" ? "none" : "look")}
          className={cn("pdf-tool", panel === "look" && "pdf-tool-on")}
          aria-label="Vzhled stránky"
        >
          <Settings2 className="size-5" />
        </button>
      </div>

      {panel === "voice" ? (
        <div className="pdf-panel">
          <SpeechSettings open />
        </div>
      ) : null}

      {panel === "find" ? (
        <div className="pdf-panel">
          <div className="flex items-center gap-2">
            <Search className="size-4 shrink-0 opacity-60" />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Hledat v dokumentu"
              className="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none"
              enterKeyHint="search"
            />
            <span className="shrink-0 text-xs tabular-nums opacity-70">
              {hits.length ? `${hit + 1}/${hits.length}` : query.trim().length > 1 ? "nic" : ""}
            </span>
            <button type="button" onClick={() => goToHit(hit - 1)} className="pdf-tool" aria-label="Předchozí nález">
              <ChevronUp className="size-4" />
            </button>
            <button type="button" onClick={() => goToHit(hit + 1)} className="pdf-tool" aria-label="Další nález">
              <ChevronDown className="size-4" />
            </button>
            <button type="button" onClick={() => { setQuery(""); setPanel("none"); }} className="pdf-tool" aria-label="Zavřít hledání">
              <X className="size-4" />
            </button>
          </div>
          {hits.length ? (
            <ul className="pdf-list">
              {hits.slice(0, 60).map((found, index) => (
                <li key={`${found.page}-${found.start}`}>
                  <button type="button" onClick={() => goToHit(index)} className={cn("pdf-list-item", index === hit && "pdf-list-item-on")}>
                    <span className="shrink-0 text-xs tabular-nums opacity-60">{found.page + 1}</span>
                    <span className="min-w-0 flex-1 truncate text-xs">{found.preview}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {panel === "toc" ? (
        <div className="pdf-panel">
          {outline === null ? (
            <p className="px-1 py-3 text-xs opacity-70">Načítám obsah…</p>
          ) : outline.length ? (
            <ul className="pdf-list">
              {outline.map((entry, index) => (
                <li key={`${entry.title}-${index}`}>
                  <button
                    type="button"
                    disabled={entry.page === null}
                    onClick={() => {
                      if (entry.page === null) return;
                      wanted.current = entry.page;
                      onPage(entry.page);
                      scrollToPage(entry.page);
                      setPanel("none");
                    }}
                    className="pdf-list-item disabled:opacity-40"
                    style={{ paddingLeft: `${0.5 + entry.depth * 0.9}rem` }}
                  >
                    <span className="min-w-0 flex-1 truncate text-xs">{entry.title}</span>
                    <span className="shrink-0 text-xs tabular-nums opacity-60">{entry.page === null ? "" : entry.page + 1}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-1 py-3 text-xs opacity-70">
              Tenhle dokument obsah nemá. Skákat jde posuvníkem dole nebo přes záložky.
            </p>
          )}
          {bookmarks.length ? (
            <>
              <p className="mt-2 px-1 text-[10px] font-semibold uppercase tracking-[0.18em] opacity-60">Záložky</p>
              <ul className="pdf-list">
                {[...bookmarks].sort((a, b) => a - b).map((index) => (
                  <li key={index}>
                    <button
                      type="button"
                      onClick={() => {
                        wanted.current = index;
                        onPage(index);
                        scrollToPage(index);
                        setPanel("none");
                      }}
                      className="pdf-list-item"
                    >
                      <BookmarkCheck className="size-3.5 shrink-0 opacity-70" />
                      <span className="min-w-0 flex-1 truncate text-xs">Strana {index + 1}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      ) : null}

      {panel === "look" ? (
        <div className="pdf-panel flex flex-col gap-3">
          <div className="flex gap-1.5">
            {THEME_LABELS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setPrefs((previous) => ({ ...previous, theme: option.id }))}
                data-swatch={option.id}
                className={cn("pdf-swatch", prefs.theme === option.id && "pdf-swatch-on")}
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPrefs((previous) => ({ ...previous, zoom: clampZoom(previous.zoom - 0.15) }))}
              className="pdf-tool"
              aria-label="Zmenšit"
            >
              <Minus className="size-4" />
            </button>
            <span className="w-14 text-center text-xs tabular-nums">{Math.round(prefs.zoom * 100)} %</span>
            <button
              type="button"
              onClick={() => setPrefs((previous) => ({ ...previous, zoom: clampZoom(previous.zoom + 0.15) }))}
              className="pdf-tool"
              aria-label="Zvětšit"
            >
              <Plus className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => setPrefs((previous) => ({ ...previous, crop: !previous.crop }))}
              className={cn("pdf-chip", prefs.crop && "pdf-chip-on")}
            >
              <Crop className="size-3.5" /> Ořezat okraje
            </button>
            <button
              type="button"
              onClick={() =>
                setPrefs((previous) => ({ ...previous, flow: (previous.flow === "scroll" ? "page" : "scroll") as ReaderFlow }))
              }
              className={cn("pdf-chip", prefs.flow === "page" && "pdf-chip-on")}
            >
              <Sparkles className="size-3.5" /> {prefs.flow === "page" ? "Po stránkách" : "Plynule"}
            </button>
          </div>
        </div>
      ) : null}

      <div
        ref={scroller}
        className="pdf-scroll"
        data-flow={prefs.flow}
        onScroll={onScroll}
        onClick={() => setSpot(null)}
        onTouchStart={touchStart}
        onTouchMove={touchMove}
        onTouchEnd={touchEnd}
        onTouchCancel={touchEnd}
      >
        <div
          ref={stack}
          className="pdf-stack"
          style={pinch === 1 ? undefined : { transform: `scale(${pinch})`, transformOrigin: "top center" }}
        >
          {pages.map((index) => (
            <PdfPageView
              key={index}
              pdf={pdf}
              index={index}
              scale={scale}
              crop={prefs.crop}
              active={index >= center - BEHIND && index <= center + AHEAD}
              rank={index === center ? 0 : 1}
              marks={marks.get(index) ?? NO_MARKS}
              natural={sizeOf(index)}
              onTextTap={tapText}
              onReady={pageReady}
            />
          ))}
        </div>
      </div>

      {/*
        Nabídka „Číst odsud" visí u místa, kam se kleplo. Teprve klepnutí na
        ni přesune čtení - viz `tapText`.
      */}
      {spot && speech ? (
        <button
          type="button"
          className="pdf-spot"
          data-below={spot.y < SPOT_FLIP ? "yes" : undefined}
          style={{
            left: `${Math.min(Math.max(spot.x, SPOT_HALF), window.innerWidth - SPOT_HALF)}px`,
            top: `${spot.y}px`,
          }}
          onClick={() => {
            speech.onReadFrom(spot.page, spot.offset);
            setSpot(null);
          }}
        >
          <Play className="size-3 fill-current" /> Číst odsud
        </button>
      ) : null}

      <div className="pdf-foot">
        <button
          type="button"
          onClick={() => setChrome((value) => !value)}
          className="pdf-tool"
          aria-label={chrome ? "Skrýt lišty" : "Ukázat lišty"}
        >
          {chrome ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
        </button>
        <input
          type="range"
          min={0}
          max={Math.max(0, pageCount - 1)}
          value={page}
          onChange={(event) => {
            const next = Number(event.target.value);
            wanted.current = next;
            onPage(next);
            scrollToPage(next);
          }}
          aria-label="Stránka"
          className="pdf-range min-w-0 flex-1"
        />
        <span className="shrink-0 text-xs tabular-nums">
          {page + 1} / {pageCount}
        </span>
        {speech ? (
          <button type="button" onClick={speech.onToggle} className="pdf-play" aria-label={speech.reading ? "Pozastavit čtení" : "Číst nahlas"}>
            {speech.reading ? <Pause className="size-4 fill-current" /> : <Play className="ml-0.5 size-4 fill-current" />}
          </button>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

function fingerSpan(touches: React.TouchList): number {
  const [first, second] = [touches[0], touches[1]];
  return Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY);
}
