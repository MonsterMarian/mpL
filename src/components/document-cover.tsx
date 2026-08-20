"use client";

import * as React from "react";
import { FileText } from "lucide-react";
import { MediaLibrary, canReadDeviceMedia, type NativeDocument } from "@/lib/media-library";
import { cn } from "@/lib/utils";

/**
 * Obálka dokumentu.
 *
 * První stránku PDF kreslí systémový `PdfRenderer` v nativní vrstvě - kniha se
 * tak nemusí celá natáhnout do paměti webu jen kvůli náhledu. Hotová obálka se
 * ukládá, takže se při dalším otevření sekce nekreslí znovu.
 *
 * Kreslí se jen to, co je zrovna na obrazovce: náhled se vyžádá, teprve když
 * dlaždice doskrolluje do pohledu. Deset knih naráz by jinak na chvíli zabralo
 * telefon.
 */
const CACHE_KEY = "microwins:doc_covers";
const CACHE_LIMIT = 60;

type Cache = Record<string, string>;

function readCache(): Cache {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Cache) : {};
  } catch {
    return {};
  }
}

function writeCache(key: string, value: string): void {
  try {
    const cache = readCache();
    cache[key] = value;
    // Starší obálky se zahazují - jinak by úložiště rostlo donekonečna.
    const keys = Object.keys(cache);
    if (keys.length > CACHE_LIMIT) {
      for (const stale of keys.slice(0, keys.length - CACHE_LIMIT)) delete cache[stale];
    }
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Plné úložiště: náhledy se prostě nakreslí příště znovu.
  }
}

export function DocumentCover({ document: doc, className }: { document: NativeDocument; className?: string }) {
  // Klíč nese i velikost: přepsaný soubor pod stejným jménem má jinou obálku.
  const key = `${doc.id}:${doc.sizeBytes}`;
  const [cover, setCover] = React.useState<string | null>(() => readCache()[key] ?? null);
  const holder = React.useRef<HTMLSpanElement>(null);

  React.useEffect(() => {
    if (cover || !canReadDeviceMedia() || !doc.mimeType.includes("pdf")) return;
    const element = holder.current;
    if (!element) return;

    let cancelled = false;
    const load = () => {
      void MediaLibrary.documentThumbnail({ uri: doc.uri })
        .then((result) => {
          if (cancelled || !result?.thumbnail) return;
          setCover(result.thumbnail);
          writeCache(key, result.thumbnail);
        })
        .catch(() => {});
    };

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          load();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(element);

    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [cover, doc.mimeType, doc.uri, key]);

  return (
    <span
      ref={holder}
      className={cn(
        "flex items-center justify-center overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.05]",
        className,
      )}
    >
      {cover ? (
        // eslint-disable-next-line @next/next/no-img-element -- data URI z PdfRenderer
        <img src={cover} alt="" aria-hidden="true" className="size-full object-cover" />
      ) : (
        <FileText className="size-7 text-muted-foreground" />
      )}
    </span>
  );
}
