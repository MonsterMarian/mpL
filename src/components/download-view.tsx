"use client";

import * as React from "react";
import { ArrowDownToLine, Loader2, Music2, Trash2, Video } from "lucide-react";
import { Input } from "@/components/ui/input";
import { MediaLibrary, canReadDeviceMedia } from "@/lib/media-library";
import { nativeStreamAvailable, resolveStream } from "@/lib/stream";
import {
  addDownload,
  clearDownloads,
  guessFileName,
  loadDownloads,
  needsResolving,
  safeFileName,
  unsupportedSource,
  type DownloadRecord,
} from "@/lib/downloads";
import { cn } from "@/lib/utils";

/**
 * Stahování jako addon.
 *
 * Umí dvojí. Přímý odkaz na soubor jde rovnou systémovému stahovači. Odkaz na
 * stránku (YouTube, Spotify) napřed rozebere nativní vrstva a teprve pak se
 * stahuje - v telefonu není nic, čím by se adresa streamu dala zjistit z
 * JavaScriptu.
 *
 * Hudba se ukládá jako `m4a`, ne `mp3`: YouTube posílá zvuk v AAC nebo Opusu
 * a převod by chtěl ffmpeg, který v appce není. Přehraje to všechno včetně
 * téhle appky.
 */
type Kind = "audio" | "video";

export function DownloadView({
  onToast,
  onDownloaded,
}: {
  onToast?: (message: { tone: "info" | "warn" | "win"; title: string; description?: string }) => void;
  /** Hotové stahování knihovnu přečte znovu, ať se soubor hned objeví. */
  onDownloaded?: () => void;
}) {
  const [url, setUrl] = React.useState("");
  const [kind, setKind] = React.useState<Kind>("audio");
  const [busy, setBusy] = React.useState<null | "resolving" | "starting">(null);
  const [history, setHistory] = React.useState<DownloadRecord[]>([]);

  React.useEffect(() => setHistory(loadDownloads()), []);

  const start = async (event: React.FormEvent) => {
    event.preventDefault();
    const address = url.trim();
    if (!address || busy) return;

    const broken = unsupportedSource(address);
    if (broken) {
      onToast?.({ tone: "warn", title: broken.title, description: broken.description });
      return;
    }

    if (!canReadDeviceMedia()) {
      onToast?.({ tone: "warn", title: "Jen v telefonu", description: "V prohlížeči se stahovat nedá." });
      return;
    }

    try {
      let fileUrl = address;
      let fileName = guessFileName(address);

      if (needsResolving(address)) {
        if (!nativeStreamAvailable()) {
          onToast?.({
            tone: "warn",
            title: "Chybí v téhle instalaci",
            description: "Rozbor odkazů přijde s novějším APK.",
          });
          return;
        }
        setBusy("resolving");
        onToast?.({ tone: "info", title: "Hledám soubor", description: "Rozebírám odkaz…" });
        const found = await resolveStream(address, kind);
        fileUrl = found.url;
        fileName = safeFileName(`${found.author ? `${found.author} - ` : ""}${found.title}`, found.extension);
      }

      setBusy("starting");
      const result = await MediaLibrary.download({ url: fileUrl, fileName });
      setHistory(addDownload({ url: address, fileName: result?.fileName ?? fileName, at: Date.now() }));
      setUrl("");
      onToast?.({
        tone: "win",
        title: "Stahuju",
        description: "Průběh je v liště telefonu. Až bude hotovo, objeví se v knihovně.",
      });
      // Soubor přibude v MediaStore až po dostažení - knihovna se přečte znovu
      // za chvíli i po návratu do appky.
      window.setTimeout(() => onDownloaded?.(), 5000);
    } catch (error) {
      console.error("Stahování selhalo", error);
      const message = error instanceof Error ? error.message : String(error);
      onToast?.({ tone: "warn", title: "Nepovedlo se", description: message.slice(0, 120) });
    } finally {
      setBusy(null);
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
          Odkaz na YouTube, Spotify, nebo přímo na soubor. Stažené jde do Hudby (Filmů)
          v telefonu, takže si to knihovna appky najde sama.
        </p>
      </div>

      <form onSubmit={start} className="flex flex-col gap-3">
        <div className="flex gap-1 rounded-full bg-white/[0.04] p-1">
          {([
            { id: "audio" as const, label: "Hudba", icon: Music2 },
            { id: "video" as const, label: "Video", icon: Video },
          ]).map((option) => {
            const Icon = option.icon;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => setKind(option.id)}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-2 text-xs font-medium transition-colors",
                  kind === option.id ? "bg-white/10 text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="size-3.5" />
                {option.label}
              </button>
            );
          })}
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://www.youtube.com/watch?v=…"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            className="h-11 flex-1 rounded-xl text-sm"
          />
          <button
            type="submit"
            disabled={!url.trim() || busy !== null}
            className="flex h-11 items-center justify-center gap-2 rounded-xl bg-brand px-5 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <ArrowDownToLine className="size-4" />}
            {busy === "resolving" ? "Hledám…" : "Stáhnout"}
          </button>
        </div>
      </form>

      <p className="rounded-xl border border-dashed border-white/10 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
        Hudba se ukládá jako <span className="font-mono">m4a</span> - YouTube posílá zvuk v AAC
        nebo Opusu a převod na MP3 by chtěl nástroj, který v telefonu není. Přehraje se všude,
        včetně téhle appky. U Spotify se čte jen název skladby a ta se pak najde na YouTube:
        do chráněného obsahu appka nesahá.
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
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-white/[0.06] text-muted-foreground">
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
