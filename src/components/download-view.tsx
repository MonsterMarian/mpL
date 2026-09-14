"use client";

import * as React from "react";
import { AlertTriangle, ArrowDownToLine, Loader2, Music2, Trash2, Video } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  MediaLibrary,
  canReadDeviceMedia,
  type DownloadCompleteEvent,
  type DownloadErrorEvent,
  type DownloadProgressEvent,
} from "@/lib/media-library";
import { getNativeStreamInfo, nativeStreamAvailable, resolveStream } from "@/lib/stream";
import {
  addDownload,
  cleanDownloadUrl,
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
 * Hudba se ukládá jako `mp3`, video jako `mp4`. Přehraje to všechno včetně
 * téhle appky.
 */
type Kind = "audio" | "video";

interface ActiveDownload {
  id: string;
  fileName: string;
  /** 0–100 při stahování, -1 = indeterminate konverze */
  progress: number;
  phase: "downloading" | "converting";
}

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
  const [nativeOutdated, setNativeOutdated] = React.useState(false);
  const [activeDownloads, setActiveDownloads] = React.useState<ActiveDownload[]>([]);

  // Ref na onDownloaded, aby listener ve useEffect nebral zastaralou closure
  const onDownloadedRef = React.useRef(onDownloaded);
  React.useEffect(() => { onDownloadedRef.current = onDownloaded; }, [onDownloaded]);

  React.useEffect(() => {
    setHistory(loadDownloads());
    if (!canReadDeviceMedia()) return;

    getNativeStreamInfo().then((info) => {
      if (!info || info.extractorVersion !== "0.26.5") {
        setNativeOutdated(true);
      }
    });

    // Přihlásíme se k odběru download eventů
    const listeners: Promise<{ remove: () => void }>[] = [];

    listeners.push(
      MediaLibrary.addListener("downloadProgress", (e: DownloadProgressEvent) => {
        setActiveDownloads((prev) => {
          const existing = prev.find((d) => d.id === e.id);
          if (!existing) {
            return [...prev, { id: e.id, fileName: e.fileName, progress: e.progress, phase: e.phase }];
          }
          return prev.map((d) =>
            d.id === e.id ? { ...d, progress: e.progress, phase: e.phase } : d
          );
        });
      }),
    );

    listeners.push(
      MediaLibrary.addListener("downloadComplete", (e: DownloadCompleteEvent) => {
        setActiveDownloads((prev) => prev.filter((d) => d.id !== e.id));
        onDownloadedRef.current?.();
        onToast?.({ tone: "win", title: "Staženo", description: `${e.fileName} je v knihovně.` });
      }),
    );

    listeners.push(
      MediaLibrary.addListener("downloadError", (e: DownloadErrorEvent) => {
        setActiveDownloads((prev) => prev.filter((d) => d.id !== e.id));
        onToast?.({ tone: "warn", title: "Stahování selhalo", description: e.error?.slice(0, 130) });
      }),
    );

    return () => {
      void Promise.all(listeners).then((handles) => handles.forEach((h) => h.remove()));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = async (event: React.FormEvent) => {
    event.preventDefault();
    const address = cleanDownloadUrl(url);
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
      let streamTitle: string | undefined;
      let streamArtist: string | undefined;

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
        streamTitle = found.title;
        streamArtist = found.author;
      }

      setBusy("starting");
      const result = await MediaLibrary.download({
        url: fileUrl,
        fileName,
        title: streamTitle,
        artist: streamArtist,
      });

      // Ihned zaregistrujeme aktivní download do stavu
      const downloadId = result?.id;
      if (downloadId) {
        setActiveDownloads((prev) => [
          ...prev,
          { id: downloadId, fileName: result.fileName ?? fileName, progress: 0, phase: "downloading" },
        ]);
        // Fallback: pokud downloadComplete event nedorazí (thread timing), přenač knihovnu
        // za 20s, 45s a 90s – pokryje jak rychlé stahování tak pomalou MP3 konverzi.
        const t1 = window.setTimeout(() => onDownloadedRef.current?.(), 20_000);
        const t2 = window.setTimeout(() => onDownloadedRef.current?.(), 45_000);
        const t3 = window.setTimeout(() => onDownloadedRef.current?.(), 90_000);
        // Pokud downloadComplete přijde dřív, zbytečné timery pryč
        const clearFallbacks = () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
        MediaLibrary.addListener("downloadComplete", (e) => {
          if (e.id === downloadId) clearFallbacks();
        });
        MediaLibrary.addListener("downloadError", (e) => {
          if (e.id === downloadId) clearFallbacks();
        });
      }

      setHistory(addDownload({ url: address, fileName: result?.fileName ?? fileName, at: Date.now() }));
      setUrl("");
      onToast?.({ tone: "info", title: "Stahuji", description: "Průběh vidíš níže." });
    } catch (error) {
      console.error("Stahování selhalo", error);
      const message = error instanceof Error ? error.message : String(error);
      const isUnavailable =
        message.includes("Player.apk") ||
        message.includes("unavailable") ||
        message.includes("ContentNotAvailable");

      onToast?.({
        tone: "warn",
        title: "Nepovedlo se",
        description: isUnavailable
          ? "Odkaz se nepodařilo rozebrat. Pokud máš v telefonu starší verzi aplikace, nainstaluj si aktuální Player.apk."
          : message.slice(0, 130),
      });
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

      {nativeOutdated ? (
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200">
          <AlertTriangle className="size-4 shrink-0 mt-0.5 text-amber-400" />
          <div>
            <p className="font-semibold text-amber-300">V telefonu běží stará verze aplikace</p>
            <p className="mt-0.5 text-muted-foreground text-[11px] leading-relaxed">
              Nativní modul pro YouTube v nainstalovaném APK je starý. Živá aktualizace
              mění jen web — pro spolehlivé stahování z YouTube je nutné přeinstalovat
              aplikaci novým balíčkem <span className="font-mono text-foreground">Player.apk</span>.
            </p>
          </div>
        </div>
      ) : null}

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
        Hudba se ukládá ve formátu <span className="font-mono">mp3</span> do složky Hudba,
        video jako <span className="font-mono">mp4</span> do Filmů. Přehraje se všude,
        včetně téhle appky. U Spotify se přečte název skladby a ta se pak najde na YouTube:
        do chráněného obsahu appka nesahá.
      </p>

      {/* Aktivní stahování */}
      {activeDownloads.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Právě se stahuje</h2>
          <ul className="flex flex-col gap-2">
            {activeDownloads.map((dl) => (
              <li
                key={dl.id}
                className="flex flex-col gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-3"
              >
                <div className="flex items-center gap-2">
                  <Loader2 className="size-4 shrink-0 animate-spin text-brand" />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{dl.fileName}</span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {dl.phase === "converting" ? "Konverze…" : `${dl.progress} %`}
                  </span>
                </div>
                {/* Progress bar */}
                <div className="h-1 w-full overflow-hidden rounded-full bg-white/10">
                  {dl.phase === "converting" ? (
                    <div className="h-full w-1/3 animate-pulse rounded-full bg-brand" />
                  ) : (
                    <div
                      className="h-full rounded-full bg-brand transition-all duration-300"
                      style={{ width: `${dl.progress}%` }}
                    />
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {dl.phase === "converting"
                    ? "Převádím audio do MP3 — může to chvíli trvat…"
                    : "Stahuji ze serveru…"}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

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