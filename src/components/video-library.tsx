"use client";

import * as React from "react";
import { Film, FolderOpen, Loader2, Pause, Play, RotateCcw, RotateCw, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MediaLibrary, canReadDeviceMedia, playableMediaSource, type NativeVideo } from "@/lib/media-library";
import { onAppResume } from "@/lib/native";
import { nativeStreamAvailable, playVideoNatively } from "@/lib/stream";
import { type VideoLayout } from "@/lib/video-layout";
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
  /** Původní `content://` adresa - potřebuje ji jiný přehrávač. */
  uri?: string;
  mimeType?: string;
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
    uri: video.src,
    mimeType: video.mimeType,
    durationSeconds: video.durationSeconds,
    sizeBytes: video.sizeBytes,
    source: "device",
  };
}

/**
 * Náhled videa.
 *
 * Miniatury drží MediaStore, takže se nic negeneruje znovu - jen se o ně
 * řekne, když je dlaždice na obrazovce. Než dorazí, drží místo tichá plocha:
 * probliknutá náhradní ikona vypadá při otevření sekce jako chyba.
 */
function VideoThumbnail({ video }: { video: VideoItem }) {
  const [thumbnail, setThumbnail] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    if (!video.uri || !canReadDeviceMedia()) return;
    const nativeId = video.id.replace(/^device-/, "");
    void MediaLibrary.videoThumbnail({ id: nativeId })
      .then((result) => {
        if (!cancelled) setThumbnail(result?.thumbnail ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [video.id, video.uri]);

  if (!thumbnail) {
    return (
      <span className="absolute inset-0 flex items-center justify-center text-muted-foreground">
        <Film className="size-6 opacity-40" />
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- data URI z MediaStore
    <img src={thumbnail} alt="" aria-hidden="true" loading="lazy" decoding="async" className="absolute inset-0 size-full object-cover" />
  );
}

export function VideoLibrary({
  onBeforePlay,
  onToast,
  onPlayerChange,
  layout = "grid",
}: {
  /** Zavolá se, než se video rozjede - hlavní obrazovka na to ztlumí zbytek. */
  onBeforePlay: () => void;
  onToast?: (message: { tone: "info" | "warn" | "win"; title: string; description?: string }) => void;
  /**
   * Ohlásí, jestli je otevřený přehrávač uvnitř appky, a jak ho zavřít.
   * Hardwarové Zpět řeší hlavní obrazovka na jednom místě, takže potřebuje
   * vědět, že je nad ní ještě něco navrchu.
   */
  onPlayerChange?: (close: (() => void) | null) => void;
  /** Podoba galerie. Vybírá se v nastavení, viz `lib/video-layout.ts`. */
  layout?: VideoLayout;
}) {
  const [videos, setVideos] = React.useState<VideoItem[]>([]);
  const [permission, setPermission] = React.useState<Permission>("unknown");
  const [loading, setLoading] = React.useState(false);
  const [currentId, setCurrentId] = React.useState<string | null>(null);
  /** Video, které WebView odmítl - i s důvodem, proč se sem vůbec dostalo. */
  const [failed, setFailed] = React.useState<string | null>(null);
  const [failedReason, setFailedReason] = React.useState<string | null>(null);
  const [playing, setPlaying] = React.useState(false);
  const [position, setPosition] = React.useState(0);
  const [length, setLength] = React.useState(0);
  const [controlsVisible, setControls] = React.useState(true);
  const [query, setQuery] = React.useState("");
  /**
   * Je v telefonu nainstalovaná appka, která umí nativní přehrávač?
   *
   * Zjišťuje se až po připojení, ne při vykreslení: `out/` se předgeneruje na
   * počítači, kde žádný Capacitor není, a rozdíl proti telefonu by rozbil
   * hydrataci. `null` znamená „ještě nevíme".
   */
  const [nativePlayer, setNativePlayer] = React.useState<boolean | null>(null);
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

  React.useEffect(() => {
    setNativePlayer(nativeStreamAvailable());
  }, []);

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
    void play(added[0].id);
  };

  /**
   * Spustí film.
   *
   * Nativní přehrávač umí i to, co WebView ne (MKV, HEVC, AC3), a nese si
   * vlastní ovládání - film z telefonu jde vždycky tam. Obrazovka uvnitř appky
   * zůstává pro ručně vybraný soubor, pro prohlížeč a jako záchrana, když
   * nativní cesta odmítne.
   *
   * Nic z toho se nesmí stát potichu: dokud se nezdar jen polykal, vypadalo
   * klepnutí na film tak, že appka nedělá vůbec nic.
   */
  const play = async (id: string) => {
    onBeforePlay();
    const video = videos.find((item) => item.id === id);
    if (!video) return;

    let reason: string | null = null;

    if (video.uri) {
      const result = await playVideoNatively(video.uri, video.title);
      if (result.started) return;

      reason =
        result.reason === "no-native"
          ? "Nativní přehrávač v nainstalované appce chybí. Filmy hraje nativní část, a tu živá aktualizace nevymění - je potřeba novější APK."
          : result.message;
      onToast?.({
        tone: "warn",
        title: "Nativní přehrávač film nevzal",
        description: reason,
      });
    }

    setFailed(null);
    setFailedReason(reason);
    setPosition(0);
    setLength(0);
    setControls(true);
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

  // Hardwarové Zpět patří tomu, co je navrchu. Přehrávač je přes celou
  // obrazovku, takže se má zavřít dřív, než se odejde ze sekce.
  React.useEffect(() => {
    onPlayerChange?.(currentId ? () => setCurrentId(null) : null);
    return () => onPlayerChange?.(null);
  }, [currentId, onPlayerChange]);

  // Povolení k videím se uděluje v systémovém nastavení - po návratu se
  // knihovna přečte znovu, jinak to vypadá, že povolení nezabralo.
  React.useEffect(() => {
    let cleanup = () => {};
    void onAppResume(() => void load()).then((fn) => {
      cleanup = fn;
    });
    return () => cleanup();
  }, [load]);

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
        <div className="fixed inset-0 z-50 flex flex-col bg-black">
          {/*
            Video přes celou obrazovku, jak to dělá každý přehrávač: obraz nemá
            soupeřit se seznamem a s lištami appky. Ven se jde křížkem nebo
            systémovým tlačítkem zpět.
          */}
          <div className="mw-safe-top flex items-center gap-2 px-3 pt-2 text-white">
            <button
              type="button"
              onClick={() => setCurrentId(null)}
              aria-label="Zavřít video"
              className="rounded-full p-2 text-white/80 transition-colors hover:text-white"
            >
              <X className="size-6" />
            </button>
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{current.title}</span>

          </div>

          <div className="relative flex flex-1 items-center justify-center">
            <video
              ref={videoRef}
              src={current.src}
              playsInline
              onPlay={() => {
                onBeforePlay();
                setPlaying(true);
              }}
              onPause={() => setPlaying(false)}
              onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime)}
              onLoadedMetadata={(event) => setLength(event.currentTarget.duration)}
              onError={() => setFailed(current.id)}
              onClick={() => setControls((value) => !value)}
              className="max-h-full w-full bg-black"
            />

            {/*
              Ovládání kreslí appka, ne prohlížeč: systémové se v celé obrazovce
              tluče s lištami a nejde do něj přidat nic vlastního. Klepnutí do
              obrazu ho schová, jak je u přehrávačů zvykem.
            */}
            {controlsVisible ? (
              <div className="mw-safe-bottom absolute inset-x-0 bottom-0 flex flex-col gap-2 bg-gradient-to-t from-black/80 to-transparent px-4 pb-3 pt-8">
                <div className="flex items-center gap-3">
                  <span className="w-14 text-right text-xs tabular-nums text-white/80">{formatTime(position)}</span>
                  <input
                    type="range"
                    min="0"
                    max={length || current.durationSeconds || 0}
                    step="0.1"
                    value={Math.min(position, length || current.durationSeconds || 0)}
                    onChange={(event) => {
                      const value = Number(event.target.value);
                      if (videoRef.current) videoRef.current.currentTime = value;
                      setPosition(value);
                    }}
                    className="player-range"
                    aria-label="Pozice ve videu"
                    style={{
                      "--range-progress": `${length ? Math.min(100, (position / length) * 100) : 0}%`,
                    } as React.CSSProperties}
                  />
                  <span className="w-14 text-xs tabular-nums text-white/80">
                    {formatTime(length || current.durationSeconds)}
                  </span>
                </div>

                <div className="flex items-center justify-center gap-8 pb-1">
                  <button
                    type="button"
                    onClick={() => {
                      if (videoRef.current) videoRef.current.currentTime = Math.max(0, position - 10);
                    }}
                    aria-label="O deset vteřin zpět"
                    className="text-white/85 transition-colors hover:text-white"
                  >
                    <RotateCcw className="size-6" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const element = videoRef.current;
                      if (!element) return;
                      if (element.paused) void element.play().catch(() => {});
                      else element.pause();
                    }}
                    aria-label={playing ? "Pozastavit" : "Přehrát"}
                    className="text-white"
                  >
                    {playing ? <Pause className="size-10 fill-current" /> : <Play className="size-10 fill-current" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (videoRef.current) videoRef.current.currentTime = Math.min(length || 0, position + 10);
                    }}
                    aria-label="O deset vteřin vpřed"
                    className="text-white/85 transition-colors hover:text-white"
                  >
                    <RotateCw className="size-6" />
                  </button>
                </div>
              </div>
            ) : null}
            {failed === current.id ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/85 px-6 text-center">
                <p className="text-sm font-medium text-white">Tohle video se nepodařilo přehrát</p>
                <p className="max-w-xs text-xs leading-relaxed text-white/70">
                  {failedReason ??
                    "Tenhle přehrávač umí jen to, co zvládne prohlížeč — MP4 s H.264. Filmy jinak jedou přes nativní přehrávač."}
                </p>
                <Button size="sm" variant="secondary" onClick={() => setCurrentId(null)}>
                  Zavřít
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {/*
        Nativní přehrávač je v APK, ne v balíku živé aktualizace. Když appka
        v telefonu pochází z doby před ním, filmy se přes prohlížeč nerozjedou
        a bez tohohle upozornění to vypadá jako záhadná porucha.
      */}
      {nativePlayer === false && permission !== "unavailable" ? (
        <div className="rounded-xl border border-dashed border-amber-500/40 bg-amber-500/5 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">Chybí nativní přehrávač.</span> Tahle
          instalace appky je starší než on a živá aktualizace ho nedoveze — je v APK. Filmy
          (MKV, HEVC, AC3) půjdou přehrát až po instalaci novějšího APK; zatím se zkusí
          přehrávač prohlížeče, který umí jen MP4 s H.264.
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
          <VideoGallery layout={layout} videos={shown} onPlay={(id) => void play(id)} />
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

/**
 * Galerie ve třech podobách.
 *
 * Náhled ze všeho nejvíc napoví, o jaké video jde - proto je i v seznamu, jen
 * menší. Rozdíl je v tom, čeho je víc: mřížka nabízí nejvíc videí naráz,
 * seznam nejvíc textu (celý název, délka, velikost) a plátna největší obrázek.
 */
function VideoGallery({
  layout,
  videos,
  onPlay,
}: {
  layout: VideoLayout;
  videos: VideoItem[];
  onPlay: (id: string) => void;
}) {
  if (layout === "list") {
    return (
      <div className="flex flex-col gap-1.5">
        {videos.map((video) => (
          <button
            key={video.id}
            type="button"
            onClick={() => onPlay(video.id)}
            className="group flex items-center gap-3 rounded-xl px-1.5 py-1.5 text-left transition-colors hover:bg-white/[0.05]"
          >
            <span className="relative block aspect-video w-24 shrink-0 overflow-hidden rounded-lg bg-white/[0.06]">
              <VideoThumbnail video={video} />
              <span className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 transition-opacity group-hover:opacity-100">
                <Play className="size-5 fill-white text-white" />
              </span>
            </span>
            <span className="min-w-0 flex-1">
              {/* Název na dva řádky: soubory z telefonu se jmenují dlouze a v jednom řádku z nich zbude "VID_2026083…". */}
              <span className="line-clamp-2 text-sm font-medium leading-snug">{video.title}</span>
              <span className="mt-0.5 block text-[11px] tabular-nums text-muted-foreground">
                {formatTime(video.durationSeconds)}
                {video.sizeBytes ? ` · ${formatSize(video.sizeBytes)}` : ""}
              </span>
            </span>
          </button>
        ))}
      </div>
    );
  }

  if (layout === "cinema") {
    return (
      <div className="flex flex-col gap-3">
        {videos.map((video) => (
          <button
            key={video.id}
            type="button"
            onClick={() => onPlay(video.id)}
            className="group relative block aspect-video w-full overflow-hidden rounded-2xl bg-white/[0.06] text-left"
          >
            <VideoThumbnail video={video} />
            {/* Popis leží v obrázku, ne pod ním - jinak by se z plátna stala dlaždice s velkou mezerou. */}
            <span className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 bg-gradient-to-t from-black/85 via-black/45 to-transparent px-4 pb-3 pt-10">
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-white">{video.title}</span>
                <span className="block text-[11px] tabular-nums text-white/70">
                  {formatTime(video.durationSeconds)}
                  {video.sizeBytes ? ` · ${formatSize(video.sizeBytes)}` : ""}
                </span>
              </span>
              <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-white/15 backdrop-blur-sm transition-colors group-hover:bg-white/25">
                <Play className="size-5 fill-white text-white" />
              </span>
            </span>
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {videos.map((video) => (
        <button key={video.id} type="button" onClick={() => onPlay(video.id)} className="group text-left">
          <span className="relative block aspect-video overflow-hidden rounded-xl bg-white/[0.06]">
            <VideoThumbnail video={video} />
            <span className="absolute bottom-1 right-1 rounded-md bg-black/75 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-white">
              {formatTime(video.durationSeconds)}
            </span>
            <span className="absolute inset-0 flex items-center justify-center bg-black/25 opacity-0 transition-opacity group-hover:opacity-100">
              <Play className="size-8 fill-white text-white" />
            </span>
          </span>
          <span className="mt-1.5 block truncate text-xs font-medium">{video.title}</span>
          <span className="block truncate text-[11px] text-muted-foreground">{formatSize(video.sizeBytes)}</span>
        </button>
      ))}
    </div>
  );
}
