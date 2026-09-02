"use client";

import * as React from "react";
import { detectCrop, NO_CROP, pdfjs, pdfSlot, textFromContent, type CropBox, type PageText } from "@/lib/pdf";
import type { PDFDocumentProxy } from "pdfjs-dist";

/**
 * Jedna stránka PDF.
 *
 * Tři vrstvy nad sebou, každá dělá jednu věc:
 *  - **plátno** je stránka tak, jak vypadá - i s obrázky, tabulkami a sazbou,
 *  - **textová vrstva** jsou průhledné kusy textu přesně nad svými písmeny;
 *    díky nim jde text vybrat, klepnout do něj a najít v něm,
 *  - **značky** jsou barevné obdélníky pod textem: čtená věta a nálezy
 *    z hledání.
 *
 * Dvě pravidla, na kterých tady všechno stojí:
 *
 * **Místo v seznamu se nepočítá z vykreslené stránky, ale z jejích rozměrů.**
 * Ty se znají dřív, než se něco nakreslí (viz `pdf-reader.tsx`), takže stránka
 * má svou velikost od začátku a v okamžiku vykreslení se v seznamu nepohne nic.
 * Dokud se velikost brala z hotového plátna, měnil se sloupec pod rukama
 * a text ujížděl.
 *
 * **Jedno kreslení, jeden majitel.** Přiblížení se během čtení mění (otočení
 * telefonu, štípnutí dvěma prsty) a každá změna začíná nové kreslení. Dřív si
 * do plátna, textové vrstvy i rozměrů sahaly oba pokusy zároveň, takže na
 * stránce skončil obraz z jednoho přiblížení a text z druhého - text pak
 * přetékal přes okraj a značky ukazovaly vedle. Teď se kreslí stranou
 * a na obrazovku se sáhne až naráz, když je hotové všechno.
 */

/** Barevná značka na stránce, v pozicích do textu stránky. */
export interface PageMark {
  start: number;
  end: number;
  kind: "speech" | "find" | "find-active";
}

/** Rozměry stránky v jejích vlastních bodech, tedy bez přiblížení. */
export interface PageSize {
  width: number;
  height: number;
}

export interface PdfPageViewProps {
  pdf: PDFDocumentProxy;
  /** Číslo stránky od nuly. */
  index: number;
  /** Kolikrát zvětšit oproti přirozené velikosti stránky. */
  scale: number;
  /** Ořezat prázdné okraje? */
  crop: boolean;
  /**
   * Kreslit tuhle stránku?
   *
   * Mimo okno kolem čtenáře stránka plátno pustí z ruky. Kniha o pěti stech
   * stranách by jinak chtěla pět set pláten naráz - a telefon tolik paměti
   * nemá (viz okno v `pdf-reader.tsx`).
   */
  active: boolean;
  /** Kdo se kreslí dřív; 0 je stránka pod očima čtenáře (viz `pdfSlot`). */
  rank: number;
  marks: PageMark[];
  /** Velikost stránky v bodech. Drží místo v seznamu, i než se vykreslí. */
  natural: PageSize;
  /** Klepnutí do textu: pozice znaku v textu stránky. */
  onTextTap?: (page: number, offset: number) => void;
  /** Stránka se vykreslila: text pro hledání, ořez a rozměry pro rozvržení. */
  onReady?: (page: number, info: PageInfo) => void;
}

export interface PageInfo {
  text: PageText;
  crop: CropBox;
  /** Rozměry v bodech stránky, tedy bez přiblížení. */
  width: number;
  height: number;
}

/** Nad tolik už plátno nemá smysl zvětšovat - paměť ano, ostrost ne. */
const MAX_PIXEL_RATIO = 2;

/**
 * Kreslení, které se do téhle doby neozve, se bere jako zaseknuté.
 *
 * Stát se to umí: worker pdf.js zůstane viset po zavření předchozí knihy
 * a slíbené vykreslení už nikdy nepřijde. Bez téhle lhůty by stránka zůstala
 * bílá napořád a nikde by nestálo proč - přesně tak vypadala čtečka, která
 * "nefunguje".
 */
const RENDER_TIMEOUT_MS = 25000;

/** Po chybě to čtečka zkusí ještě jednou sama; teprve pak si řekne o klepnutí. */
const AUTO_RETRIES = 1;

/** Slib, který se do lhůty neozve, se zruší - ať čeká stránka, ne fronta. */
function withTimeout<T>(promise: Promise<T>, cancel: () => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      try {
        cancel();
      } catch {
        // Kreslení už mezitím doběhlo samo.
      }
      reject(new Error("Stránka se kreslí příliš dlouho."));
    }, RENDER_TIMEOUT_MS);
    promise.then(resolve, reject).finally(() => window.clearTimeout(timer));
  });
}

/**
 * Stránka se překresluje jen tehdy, když se opravdu změnila.
 *
 * Rodič se překresluje při každém posunutí prstu (číslo stránky, značky,
 * hledání) a bez tohohle by s ním šla dolů i každá stránka na obrazovce -
 * i když se na ní nezměnilo vůbec nic.
 */
export const PdfPageView = React.memo(function PdfPageView({
  pdf,
  index,
  scale,
  crop,
  active,
  rank,
  marks,
  natural,
  onTextTap,
  onReady,
}: PdfPageViewProps) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const slotRef = React.useRef<HTMLDivElement | null>(null);
  /** Kusy textové vrstvy - z nich se počítají obdélníky značek. */
  const divs = React.useRef<HTMLElement[]>([]);
  const text = React.useRef<PageText | null>(null);

  /** Ořez okrajů. Změří se při vykreslení a platí i po uvolnění plátna. */
  const [box, setBox] = React.useState<CropBox>(NO_CROP);
  const [shown, setShown] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  /** Roste s každým dokresleným plátnem - značky se podle něj přepočítají. */
  const [painted, setPainted] = React.useState(0);
  /** Roste s klepnutím na „zkusit znovu"; jiný smysl to číslo nemá. */
  const [retry, setRetry] = React.useState(0);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    const slot = slotRef.current;
    if (!canvas || !slot) return;

    if (!active) {
      // Nulové plátno je jediný způsob, jak prohlížeči říct, že obrázek už
      // není potřeba. Rozměry stránky se drží zvlášť, takže se v seznamu ani
      // po uvolnění nic nepohne.
      canvas.width = 0;
      canvas.height = 0;
      canvas.style.width = "";
      canvas.style.height = "";
      slot.replaceChildren();
      divs.current = [];
      text.current = null;
      setShown(false);
      setFailed(false);
      return;
    }

    let alive = true;
    let stop: (() => void) | null = null;

    const draw = async () => {
      const lib = await pdfjs();
      if (!alive) return;

      const done = await pdfSlot(rank);
      try {
        if (!alive) return;
        const page = await pdf.getPage(index + 1);
        if (!alive) return;

        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale });

        // Plátno je v pixelech zařízení, ale roztažené na body stránky - jinak
        // je text na telefonu s hustým displejem rozmazaný.
        const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
        const draft = document.createElement("canvas");
        draft.width = Math.max(1, Math.round(viewport.width * ratio));
        draft.height = Math.max(1, Math.round(viewport.height * ratio));
        const paper = draft.getContext("2d", { willReadFrequently: true });
        if (!paper) throw new Error("Plátno se nepodařilo otevřít.");
        paper.setTransform(ratio, 0, 0, ratio, 0, 0);

        const render = page.render({ canvasContext: paper, viewport, canvas: draft });
        stop = () => render.cancel();
        await withTimeout(render.promise, () => render.cancel());
        if (!alive) return;

        const found = detectCrop(draft);

        // Textová vrstva se skládá ze stejného obsahu, ze kterého se počítá
        // text stránky. Dvakrát načtený obsah by mohl mít jiné pořadí kusů
        // a značky by pak ukazovaly vedle.
        const content = await page.getTextContent();
        if (!alive) return;

        const shelf = document.createElement("div");
        shelf.className = "pdf-text textLayer";
        shelf.style.setProperty("--scale-factor", String(scale));
        const layer = new lib.TextLayer({ textContentSource: content, container: shelf, viewport });
        stop = () => layer.cancel();
        await layer.render();
        if (!alive) return;

        // Až sem se na obrazovku nesáhlo. Teď naráz: obraz, text i ořez
        // patří k jednomu a témuž přiblížení.
        canvas.width = draft.width;
        canvas.height = draft.height;
        canvas.style.width = `${Math.round(viewport.width)}px`;
        canvas.style.height = `${Math.round(viewport.height)}px`;
        canvas.getContext("2d")?.drawImage(draft, 0, 0);
        draft.width = 0;
        draft.height = 0;

        slot.replaceChildren(shelf);
        divs.current = layer.textDivs;
        const built = textFromContent(content);
        text.current = built;

        setBox(found);
        setShown(true);
        setFailed(false);
        setPainted((value) => value + 1);
        onReady?.(index, { text: built, crop: found, width: base.width, height: base.height });
      } finally {
        done();
      }
    };

    void (async () => {
      for (let at = 0; at <= AUTO_RETRIES; at += 1) {
        if (!alive) return;
        try {
          await draw();
          return;
        } catch (error) {
          if (!alive) return;
          // Rozbitá stránka nesmí shodit celou knihu. Potichu ji ale nechat
          // bílou je horší než chyba: uživatel pak hlásí, že „čtečka
          // nefunguje", a nikde není vidět, co se pokazilo.
          console.error(`Stránku ${index + 1} se nepodařilo vykreslit`, error);
        }
      }
      if (alive) setFailed(true);
    })();

    return () => {
      alive = false;
      try {
        stop?.();
      } catch {
        // Kreslení už doběhlo samo.
      }
    };
    // `onReady` se nesleduje schválně: mění se s každým překreslením rodiče
    // a stránka by se kreslila pořád dokola.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdf, index, scale, active, retry]);

  /** Klepnutí do textu → pozice znaku, ze které se dá číst dál. */
  const tap = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!onTextTap || !text.current) return;
    const at = divs.current.indexOf(event.target as HTMLElement);
    if (at < 0) return;
    const span = text.current.spans[at];
    if (span) onTextTap(index, span.start);
  };

  const cropped = crop ? box : NO_CROP;
  const width = Math.max(1, Math.round(natural.width * scale));
  const height = Math.max(1, Math.round(natural.height * scale));

  return (
    <div
      data-pdf-page={index}
      className="pdf-page"
      style={{
        width: `${Math.round(width * (cropped.right - cropped.left))}px`,
        height: `${Math.round(height * (cropped.bottom - cropped.top))}px`,
      }}
    >
      <div
        className="pdf-page-shift"
        style={{
          width: `${width}px`,
          height: `${height}px`,
          transform: `translate(${-cropped.left * width}px, ${-cropped.top * height}px)`,
        }}
      >
        <canvas ref={canvasRef} className="pdf-canvas" />
        <div ref={slotRef} className="pdf-text-slot" onClick={tap} />
        <div className="pdf-marks" aria-hidden="true">
          <Marks marks={marks} divs={divs.current} text={text.current} holder={slotRef.current} version={painted} />
        </div>
      </div>
      {shown ? null : failed ? (
        <button type="button" onClick={() => setRetry((value) => value + 1)} className="pdf-page-retry">
          Stránku {index + 1} se nepodařilo vykreslit. Klepnutím zkusit znovu.
        </button>
      ) : (
        <span className="pdf-page-number">{index + 1}</span>
      )}
    </div>
  );
});

/**
 * Obdélníky pod textem.
 *
 * Počítají se z živého rozložení, ne z čísel v PDF: kus textové vrstvy je
 * `span` s vlastním natočením a roztažením, takže jediný, kdo ví, kde přesně
 * leží třetí slovo v pořadí, je prohlížeč. Proto `Range` a `getClientRects` -
 * ty vrátí i řádek zalomený uprostřed věty jako dva obdélníky, ne jeden přes
 * celou stránku.
 */
function Marks({
  marks,
  divs,
  text,
  holder,
  version,
}: {
  marks: PageMark[];
  divs: HTMLElement[];
  text: PageText | null;
  holder: HTMLDivElement | null;
  /** Roste s každým překreslením stránky - donutí obdélníky přepočítat. */
  version: number;
}) {
  const [boxes, setBoxes] = React.useState<{ rect: DOMRect; kind: PageMark["kind"]; key: string }[]>([]);

  React.useEffect(() => {
    if (!holder || !text || !divs.length || !marks.length) {
      setBoxes([]);
      return;
    }
    const origin = holder.getBoundingClientRect();
    const out: { rect: DOMRect; kind: PageMark["kind"]; key: string }[] = [];

    marks.forEach((mark, order) => {
      for (const rect of rectsFor(mark, divs, text)) {
        out.push({
          kind: mark.kind,
          key: `${order}-${out.length}`,
          rect: new DOMRect(rect.left - origin.left, rect.top - origin.top, rect.width, rect.height),
        });
      }
    });
    setBoxes(out);
  }, [marks, divs, text, holder, version]);

  return (
    <>
      {boxes.map((box) => (
        <span
          key={box.key}
          data-mark={box.kind}
          className="pdf-mark"
          style={{
            left: `${box.rect.left}px`,
            top: `${box.rect.top}px`,
            width: `${box.rect.width}px`,
            height: `${box.rect.height}px`,
          }}
        />
      ))}
    </>
  );
}

/** Obdélníky jedné značky. Prázdné pole znamená, že text na stránce není. */
function rectsFor(mark: PageMark, divs: HTMLElement[], text: PageText): DOMRect[] {
  const range = document.createRange();
  const start = locate(mark.start, divs, text, false);
  const end = locate(mark.end, divs, text, true);
  if (!start || !end) return [];
  try {
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    return [...range.getClientRects()].filter((rect) => rect.width > 0.5 && rect.height > 0.5);
  } catch {
    return [];
  }
}

/**
 * Pozice v textu stránky → místo v textové vrstvě.
 *
 * `after` rozhoduje, co se stane s pozicí na hraně dvou kusů: začátek značky
 * patří tomu následujícímu, konec tomu předchozímu. Bez toho by věta končící
 * na hraně řádku přetáhla zvýraznění o jeden kus dál.
 */
function locate(
  offset: number,
  divs: HTMLElement[],
  text: PageText,
  after: boolean,
): { node: Node; offset: number } | null {
  const { spans } = text;
  for (let at = 0; at < spans.length; at += 1) {
    const span = spans[at];
    if (span.end === span.start) continue;
    const inside = after ? offset > span.start && offset <= span.end : offset >= span.start && offset < span.end;
    if (!inside) continue;
    const node = divs[at]?.firstChild;
    if (!node) return null;
    return { node, offset: Math.min(offset - span.start, node.textContent?.length ?? 0) };
  }
  return null;
}
