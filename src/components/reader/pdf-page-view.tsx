"use client";

import * as React from "react";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import { detectCrop, NO_CROP, pdfjs, textFromContent, type CropBox, type PageText } from "@/lib/pdf";

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
 * Kreslí se, jen když je stránka na dohled. Kniha o pěti stech stranách by
 * jinak chtěla pět set pláten naráz a telefon by se s tím neuprosil.
 */

/** Barevná značka na stránce, v pozicích do textu stránky. */
export interface PageMark {
  start: number;
  end: number;
  kind: "speech" | "find" | "find-active";
}

export interface PdfPageViewProps {
  pdf: PDFDocumentProxy;
  /** Číslo stránky od nuly. */
  index: number;
  /** Kolikrát zvětšit oproti přirozené velikosti stránky. */
  scale: number;
  /** Ořezat prázdné okraje? */
  crop: boolean;
  marks: PageMark[];
  /**
   * Jak velká stránka bude, až se vykreslí.
   *
   * Drží místo v seznamu. Musí sedět na hotovou stránku, jinak se v okamžiku
   * vykreslení celý sloupec posune a čtenáři ujede text pod prstem.
   */
  expected: { width: number; height: number } | null;
  /** Poměr stran, dokud se nezná ani ten - poslední záchrana. */
  fallbackAspect: number;
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

/** Kolik obrazovek dopředu a dozadu se kreslí. */
const NEAR_SCREENS = "150% 0px";

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
  marks,
  expected,
  fallbackAspect,
  onTextTap,
  onReady,
}: PdfPageViewProps) {
  const holder = React.useRef<HTMLDivElement | null>(null);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const textRef = React.useRef<HTMLDivElement | null>(null);
  /** Kusy textové vrstvy - z nich se počítají obdélníky značek. */
  const divs = React.useRef<HTMLElement[]>([]);
  const text = React.useRef<PageText | null>(null);

  const [near, setNear] = React.useState(false);
  const [size, setSize] = React.useState<{ width: number; height: number } | null>(null);
  const [box, setBox] = React.useState<CropBox>(NO_CROP);
  const [painted, setPainted] = React.useState(0);

  // Stránka se kreslí, až když se k ní čtenář blíží.
  React.useEffect(() => {
    const node = holder.current;
    if (!node) return;
    const watcher = new IntersectionObserver(
      (entries) => entries.forEach((entry) => entry.isIntersecting && setNear(true)),
      { rootMargin: NEAR_SCREENS },
    );
    watcher.observe(node);
    return () => watcher.disconnect();
  }, []);

  React.useEffect(() => {
    if (!near) return;
    let cancelled = false;
    let task: { cancel: () => void } | null = null;
    let layer: { cancel: () => void } | null = null;
    let page: PDFPageProxy | null = null;

    const draw = async () => {
      const lib = await pdfjs();
      page = await pdf.getPage(index + 1);
      if (cancelled) return;

      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale });
      const canvas = canvasRef.current;
      const context = canvas?.getContext("2d", { willReadFrequently: true });
      if (!canvas || !context) return;

      // Plátno je v pixelech zařízení, ale roztažené na body stránky - jinak
      // je text na telefonu s hustým displejem rozmazaný.
      const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
      canvas.width = Math.max(1, Math.round(viewport.width * ratio));
      canvas.height = Math.max(1, Math.round(viewport.height * ratio));
      canvas.style.width = `${Math.round(viewport.width)}px`;
      canvas.style.height = `${Math.round(viewport.height)}px`;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);

      const render = page.render({ canvasContext: context, viewport, canvas });
      task = render;
      await render.promise;
      if (cancelled) return;

      setSize({ width: Math.round(viewport.width), height: Math.round(viewport.height) });
      const found = detectCrop(canvas);
      setBox(found);

      // Textová vrstva se skládá ze stejného obsahu, ze kterého se počítá text
      // stránky. Dvakrát načtený obsah by mohl mít jiné pořadí kusů a značky
      // by pak ukazovaly vedle.
      const content = await page.getTextContent();
      if (cancelled) return;
      const container = textRef.current;
      if (!container) return;
      container.replaceChildren();
      container.style.setProperty("--scale-factor", String(scale));
      const instance = new lib.TextLayer({ textContentSource: content, container, viewport });
      layer = instance;
      await instance.render();
      if (cancelled) return;

      divs.current = instance.textDivs;
      const built = textFromContent(content);
      text.current = built;
      setPainted((value) => value + 1);
      onReady?.(index, { text: built, crop: found, width: base.width, height: base.height });
    };

    void draw().catch(() => {
      // Rozbitá stránka nesmí shodit celou knihu - zůstane prázdné místo.
    });

    return () => {
      cancelled = true;
      try {
        task?.cancel();
        layer?.cancel();
      } catch {
        // Kreslení už doběhlo samo.
      }
      page?.cleanup();
    };
    // `onReady` se nesleduje schválně: mění se s každým překreslením rodiče
    // a stránka by se kreslila pořád dokola.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdf, index, scale, near]);

  /** Klepnutí do textu → pozice znaku, ze které se dá číst dál. */
  const tap = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!onTextTap || !text.current) return;
    const target = event.target as HTMLElement;
    const at = divs.current.indexOf(target);
    if (at < 0) return;
    const span = text.current.spans[at];
    if (span) onTextTap(index, span.start);
  };

  const width = size?.width ?? 0;
  const height = size?.height ?? 0;
  const cropped = crop ? box : NO_CROP;
  const visibleWidth = width * (cropped.right - cropped.left);
  const visibleHeight = height * (cropped.bottom - cropped.top);

  return (
    <div
      ref={holder}
      data-pdf-page={index}
      className="pdf-page"
      style={
        size
          ? { width: `${Math.round(visibleWidth)}px`, height: `${Math.round(visibleHeight)}px` }
          : expected
            ? { width: `${Math.round(expected.width)}px`, height: `${Math.round(expected.height)}px` }
            : { aspectRatio: String(fallbackAspect || 0.72), width: "100%" }
      }
    >
      <div
        className="pdf-page-shift"
        style={{
          width: width ? `${width}px` : "100%",
          height: height ? `${height}px` : "100%",
          transform: `translate(${-cropped.left * width}px, ${-cropped.top * height}px)`,
        }}
      >
        <canvas ref={canvasRef} className="pdf-canvas" />
        <div ref={textRef} className="pdf-text textLayer" onClick={tap} />
        <div className="pdf-marks" aria-hidden="true">
          <Marks marks={marks} divs={divs.current} text={text.current} holder={textRef.current} version={painted} />
        </div>
      </div>
      {size ? null : <span className="pdf-page-number">{index + 1}</span>}
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
