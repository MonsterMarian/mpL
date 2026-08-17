"use client";

import * as React from "react";
import { Film, FolderOpen, Loader2, Play, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MediaLibrary, canReadDeviceMedia, playableMediaSource, type NativeVideo } from "@/lib/media-library";
import { cn } from "@/lib/utils";

/**
 * Video jako addon.
 *
 * Appka je přehrávač; video je pátý druh obsahu, který v telefonu leží
 * a nemá se kvůli němu otevírat druhá aplikace. Knihovna se čte ze stejného
 * MediaStore jako hudba, jen z jeho videotabulky - proto samostatné oprávnění
 * (od Androidu 13 se hudba a video povolují zvlášť) a proto se o něj appka
 * hlásí, teprve když si addon někdo zapne.
 *
 * Zvuk je jen jeden: spuštění videa umlčí hudbu i předčítání, což zařídí
 * `onBeforePlay` z hlavní obrazovky.
 */

export interface VideoItem {
  id: string;
  title: string;
  src: string;
  durationSeconds: number;
  sizeBytes: number;
  source: "device" | "local";
}

type Permission = "unknown" | "granted" | "denied" | "unavailable";

function formatTime(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "--:--";
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const seconds = Math.floor(value % 60).toString().padStart(2, "0");
  return hours > 0
    ? `${hours}:${minutes.toString().padStart(2, "0")}:${seconds}`
    : `${minutes}:${seconds}`;
}

function formatSize(bytes: number): string {
  if (!bytes) return "";
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}

function mapNative(video: NativeVideo): VideoItem {
  return {
    id: `device-${video.id}`,
    title: video.title || video.fileName,
    src: playableMediaSource(video.src),
    durationSeconds: video.durationSeconds,
    sizeBytes: video.sizeBytes,
    source: "device",
  };
}

export function VideoLibrary({
  onBeforePlay,
  onToast,
}: {
  /** Zavolá se, než se video rozjede - hlavní obrazovka na to ztlumí zbytek. */
  onBeforePlay: () => void;
  onToast?: (message: { tone: "info" | "warn" | "win"; title: string; description?: string }) => void;
}) {
  const [videos, setVideos] = React.useState<VideoItem[]>([]);
  const [permission, setPermission] = React.useState<Permission>("unknown");
  const [loading, setLoading] = React.useState(false);
  const [currentId, setCurrentId] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState("");
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const objectUrls = React.useRef<string[]>([]);

  const current = videos.find((v) => v.id === currentId) ?? null;

  const load = React.useCallback(
    async (ask = false) => {
      if (!canReadDeviceMedia()) {
        setPermission("unavailable");
        return;
      }
      setLoading(true);
      try {
        const state = ask
          ? await MediaLibrary.requestVideoPermission()
          : await MediaLibrary.checkVideoPermission();
        // `request` končí bez `granted`, když oprávnění projde - stav se pak
        // dočte samostatným dotazem, ať se nespoléhá na tvar odpovědi.
        const granted = state?.granted ?? (await MediaLibrary.checkVideoPermission()).granted;
        if (!granted) {
          setPermission("denied");
          if (ask) {
            onToast?.({
              tone: "warn",
              title: "Přístup k videím nebyl povolen",
              description: "Povol ho v systémovém nastavení aplikace.",
            });
          }
          return;
        }

        const result = await MediaLibrary.listVideo();
        setPermission("granted");
        setVideos((previous) => [
          ...result.videos.map(mapNative),
          ...previous.filter((v) => v.source === "local"),
        ]);
      } catch (error) {
        console.error("Videa se nepodařilo načíst", error);
        setPermission("denied");
      } finally {
        setLoading(false);
      }
    },
    [onToast],
  );

  React.useEffect(() => {
    void load();
  }, [load]);

  // Vybrané soubory žijí na adresách, které je potřeba po sobě uklidit.
  React.useEffect(
    () => () => {
      for (const url of objectUrls.current) URL.revokeObjectURL(url);
    },
    [],
  );

  const openSettings = async () => {
    try {
      await MediaLibrary.openAppSettings();
    } catch {
      onToast?.({ tone: "warn", title: "Nastavení se nepodařilo otevřít" });
    }
  };

  const addFiles = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length) return;

    const added = files.map((file, index) => {
      const url = URL.createObjectURL(file);
      objectUrls.current.push(url);
      return {
        id: `local-${Date.now()}-${index}`,
        title: file.name.replace(/\.[^/.]+$/, ""),
        src: url,
        durationSeconds: 0,
        sizeBytes: file.size,
        source: "local" as const,
      };
    });

    setVideos((previous) => [...added, ...previous]);
    play(added[0].id);
  };

  const play = (id: string) => {
    onBeforePlay();
    setCurrentId(id);
  };

  React.useEffect(() => {
    if (!currentId) return;
    const element = videoRef.current;
    if (!element) return;
    element.load();
    void element.play().catch(() => {
      // Autoplay může systém odmítnout - uživatel klepne na přehrát ve videu.
    });
  }, [currentId]);

  const shown = videos.filter(
    (v) => !query || v.title.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <section className="animate-in-up flex flex-col gap-5">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-brand">
            <Film className="size-3.5" /> Addon · video
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">Video</h1>
          <p className="mt-2 max-w-lg text-sm text-muted-foreground">
            MP4 z telefonu. Když jede video, hudba i předčítání mlčí — zvuk je jeden.
          </p>
        </div>
        <label className="inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-lg bg-brand px-4 text-sm font-semibold text-black transition-opacity hover:opacity-90">
          <Upload className="size-4" /> Vybrat soubor
          <input type="file" accept="video/*" multiple onChange={addFiles} className="hidden" />
        </label>
      </div>

      {current ? (
        <div className="overflow-hidden rounded-2xl border bg-black">
          <video
            ref={videoRef}
            src={current.src}
            controls
            playsInline
            onPlay={onBeforePlay}
            className="max-h-[60vh] w-full bg-black"
          />
          <div className="flex items-center gap-2 px-4 py-3">
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{current.title}</span>
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
              {formatTime(current.durationSeconds)}
            </span>
          </div>
        </div>
      ) : null}

      {permission === "denied" || permission === "unknown" ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed p-8 text-center">
          <Film className="size-6 text-muted-foreground" />
          <p className="text-sm font-medium">
            {permission === "denied" ? "Přístup k videím je vypnutý" : "Povol přístup k videím"}
          </p>
          <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
            {permission === "denied"
              ? "Android ho zamítl. Otevři nastavení aplikace a povol Videa."
              : "Addon načte videa z telefonu. Bez povolení jde přehrát jen ručně vybraný soubor."}
          </p>
          <Button
            size="sm"
            disabled={loading}
            onClick={() => (permission === "denied" ? void openSettings() : void load(true))}
          >
            {loading ? <Loader2 className="size-4 animate-spin" /> : <FolderOpen className="size-4" />}
            {permission === "denied" ? "Otevřít nastavení" : "Povolit přístup"}
          </Button>
        </div>
      ) : null}

      {permission === "unavailable" ? (
        <p className="rounded-xl border border-dashed px-4 py-3 text-xs text-muted-foreground">
          V prohlížeči se knihovna telefonu číst nedá — vyber soubor ručně.
        </p>
      ) : null}

      {videos.length > 0 ? (
        <>
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Hledat video"
            className="h-9 text-sm"
          />
          <ul className="divide-y rounded-2xl border">
            {shown.map((video) => (
              <li key={video.id}>
                <button
                  type="button"
                  onClick={() => play(video.id)}
                  className={cn(
                    "flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-accent",
                    video.id === currentId && "bg-secondary",
                  )}
                >
                  <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                    {video.id === currentId ? <Play className="size-4 fill-current" /> : <Film className="size-4" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{video.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {[formatTime(video.durationSeconds), formatSize(video.sizeBytes)]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {shown.length === 0 ? (
            <p className="px-1 text-xs text-muted-foreground">Nic neodpovídá hledání.</p>
          ) : null}
        </>
      ) : permission === "granted" ? (
        <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          V telefonu žádné video není.
        </p>
      ) : null}
    </section>
  );
}
