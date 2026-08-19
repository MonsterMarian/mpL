"use client";

import * as React from "react";
import { ArrowDownToLine, Loader2, Music2, Trash2, Video } from "lucide-react";
import { Input } from "@/components/ui/input";
import { MediaLibrary, canReadDeviceMedia } from "@/lib/media-library";
import {
  addDownload,
  clearDownloads,
  guessFileName,
  loadDownloads,
  unsupportedSource,
  type DownloadRecord,
} from "@/lib/downloads";
import { cn } from "@/lib/utils";

/**
 * Stahování jako addon.
 *
 * Bere přímý odkaz na soubor - podcast, vlastní hosting, cokoliv, co na adrese
 * doopravdy leží. Stažené jde rovnou do Hudby (nebo Filmů) v telefonu, takže
 * si to knihovna appky najde sama.
 *
 * Vytahovat média ze stránek YouTube nebo Spotify tenhle addon nedělá: u
 * Spotify jde o obcházení ochrany obsahu, u YouTube o porušení jeho podmínek.
 * Odkaz na takovou stránku proto rovnou řekne, co s ním je.
 */
export function DownloadView({
  onToast,
  onDownloaded,
}: {
  onToast?: (message: { tone: "info" | "warn" | "win"; title: string; description?: string }) => void;
  /** Hotové stahování knihovnu přečte znovu, ať se soubor hned objeví. */
  onDownloaded?: () => void;
}) {
  const [url, setUrl] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [history, setHistory] = React.useState<DownloadRecord[]>([]);

  React.useEffect(() => setHistory(loadDownloads()), []);

  const start = async (event: React.FormEvent) => {
    event.preventDefault();
    const address = url.trim();
    if (!address || busy) return;

    const blocked = unsupportedSource(address);
    if (blocked) {
      onToast?.({ tone: "warn", title: blocked.title, description: blocked.description });
      return;
    }

    if (!canReadDeviceMedia()) {
      onToast?.({ tone: "warn", title: "Jen v telefonu", description: "V prohlížeči se stahovat nedá." });
      return;
    }

    setBusy(true);
    try {
      const fileName = guessFileName(address);
      const result = await MediaLibrary.download({ url: address, fileName });
      setHistory(addDownload({ url: address, fileName: result?.fileName ?? fileName, at: Date.now() }));
      setUrl("");
      onToast?.({
        tone: "win",
        title: "Stahuju",
        description: "Průběh je v liště telefonu. Až bude hotovo, objeví se v knihovně.",
      });
      // Soubor přibude v MediaStore až po dostažení - knihovna se přečte znovu
      // za chvíli i po návratu do appky.
      window.setTimeout(() => onDownloaded?.(), 4000);
    } catch (error) {
      console.error("Stahování selhalo", error);
      onToast?.({ tone: "warn", title: "Stahování se nepovedlo", description: "Zkontroluj adresu - musí mířit přímo na soubor." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="animate-in-up flex flex-col gap-5">
      <div>
        <p className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-brand">
          <ArrowDownToLine className="size-3.5" /> Addon · stahování
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">Stahování</h1>
        <p className="mt-2 max-w-lg text-sm text-muted-foreground">
          Vlož přímý odkaz na soubor (MP3, M4A, MP4). Stažené jde do Hudby nebo Filmů v telefonu
          a knihovna appky si ho najde sama.
        </p>
      </div>

      <form onSubmit={start} className="flex flex-col gap-2 sm:flex-row">
        <Input
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://…/skladba.mp3"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          className="h-11 flex-1 rounded-xl text-sm"
        />
        <button
          type="submit"
          disabled={!url.trim() || busy}
          className="flex h-11 items-center justify-center gap-2 rounded-xl bg-brand px-5 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <ArrowDownToLine className="size-4" />}
          Stáhnout
        </button>
      </form>

      <p className="rounded-xl border border-dashed border-white/10 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
        YouTube a Spotify tudy nejdou. Spotify má obsah chráněný a jeho obcházení je nelegální;
        YouTube to zakazuje ve svých podmínkách. Odkaz musí mířit přímo na soubor.
      </p>

      {history.length > 0 ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Naposledy staženo</h2>
            <button
              type="button"
              onClick={() => setHistory(clearDownloads())}
              className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              <Trash2 className="size-3.5" /> Vymazat seznam
            </button>
          </div>
          <ul className="divide-y rounded-2xl border">
            {history.map((record) => (
              <li key={`${record.at}-${record.fileName}`} className="flex items-center gap-3 px-3 py-2.5">
                <span
                  className={cn(
                    "grid size-9 shrink-0 place-items-center rounded-lg bg-white/[0.06]",
                    "text-muted-foreground",
                  )}
                >
                  {/\.(mp4|mkv|webm)$/i.test(record.fileName) ? <Video className="size-4" /> : <Music2 className="size-4" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{record.fileName}</span>
                  <span className="block truncate text-xs text-muted-foreground">{record.url}</span>
                </span>
                <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                  {new Date(record.at).toLocaleDateString("cs")}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
