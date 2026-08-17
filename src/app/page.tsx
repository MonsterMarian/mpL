"use client";

import * as React from "react";
import {
  ArrowDownUp,
  BookOpenText,
  Bookmark,
  BookmarkCheck,
  Check,
  ChevronLeft,
  ChevronRight,
  FileText,
  FileUp,
  Film,
  Heart,
  Library,
  ListMusic,
  Loader2,
  Music2,
  Pause,
  Play,
  Plus,
  Repeat2,
  Search,
  Settings,
  Shuffle,
  SkipBack,
  SkipForward,
  Timer,
  TimerReset,
  Upload,
  Volume2,
  VolumeX,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { SettingsDialog, loadAddons, type AddonId, type Addons } from "@/components/settings-dialog";
import { VideoLibrary } from "@/components/video-library";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/providers/toast-provider";
import { cn } from "@/lib/utils";
import { MediaLibrary, NativeAudioTrack, canReadDeviceMedia, playableMediaSource } from "@/lib/media-library";
import {
  buildTextPages,
  clampPage,
  documentId,
  isImageOnly,
  pageText,
  speechChunks,
  type DocumentPage,
  type StoredDocument,
} from "@/lib/documents";
import { listDocuments, removeDocument, saveDocument, saveProgress } from "@/lib/document-store";
import { createSpeaker, SPEECH_RATES, type Speaker } from "@/lib/speech";
import { readEmbeddedArtwork } from "@/lib/artwork";

type View = "library" | "reader" | "video";
type LibraryFilter = "all" | "liked" | "local";
type RepeatMode = "off" | "all" | "one";
type SortKey = "added" | "played" | "title" | "titleDesc" | "artist" | "duration";

interface Track {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: string;
  durationSeconds: number;
  src: string;
  /** Obal skladby, když nějaký má. Jinak `null` a nastoupí značka appky. */
  artwork: string | null;
  /** Kdy skladba přibyla do zařízení - podle toho řadí „Naposledy přidané". */
  addedAt: number;
  source: "device" | "local";
}

/** Kolikrát a kdy naposledy skladba hrála. Drží se na disku, přežije restart. */
interface PlayStat {
  count: number;
  at: number;
}

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "played", label: "Nejposlouchanější" },
  { key: "added", label: "Naposledy přidané" },
  { key: "title", label: "Název A–Z" },
  { key: "titleDesc", label: "Název Z–A" },
  { key: "artist", label: "Interpret A–Z" },
  { key: "duration", label: "Nejdelší" },
];

/** Volby časovače v minutách; 0 = dohrát rozjetou skladbu a skončit. */
const SLEEP_OPTIONS = [15, 30, 45, 60, 0];

const EMPTY_TRACK: Track = {
  id: "empty",
  title: "Nic se nepřehrává",
  artist: "Vyber skladbu ze seznamu",
  album: "",
  duration: "0:00",
  durationSeconds: 0,
  src: "",
  artwork: null,
  addedAt: 0,
  source: "device",
};

function formatTime(value: number) {
  if (!Number.isFinite(value) || value < 0) return "0:00";
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

/** Souhrn délky celé knihovny - v hlavičce dává smysl v hodinách, ne v sekundách. */
function formatTotal(seconds: number) {
  if (seconds <= 0) return null;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  if (!hours) return `${minutes} min`;
  return minutes ? `${hours} h ${minutes} min` : `${hours} h`;
}

function mapNativeTrack(track: NativeAudioTrack): Track {
  return {
    id: `device-${track.id}`,
    title: track.title,
    artist: track.artist,
    album: track.album,
    duration: formatTime(track.durationSeconds),
    durationSeconds: track.durationSeconds,
    src: playableMediaSource(track.src),
    artwork: track.artwork ? playableMediaSource(track.artwork) : null,
    addedAt: track.addedAt ?? 0,
    source: "device",
  };
}

/**
 * Obal skladby. Když ho skladba má, je vidět on. Když ne, nastoupí u všech
 * skladeb stejně značka appky - tichá, aby v seznamu nepřebíjela názvy.
 */
function Cover({ track, className }: { track: Track | null; className?: string }) {
  const artwork = track?.artwork ?? null;
  const [broken, setBroken] = React.useState(false);

  // Obal alba nemusí jít načíst (soubor zmizel, prázdný záznam v MediaStore).
  // Nová adresa dostane novou šanci, jinak by značka zůstala i tam, kde obal je.
  React.useEffect(() => setBroken(false), [artwork]);

  if (!artwork || broken) {
    return (
      <div
        className={cn("flex shrink-0 items-center justify-center overflow-hidden bg-white/[0.05]", className)}
        aria-hidden="true"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- statická značka z public/, optimalizace Next.js tu nemá co dělat */}
        <img src="/logo-mark.png" alt="" className="size-[62%] opacity-90" />
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- blob:/content: adresy, optimalizace Next.js tu nemá co dělat
    <img
      src={artwork}
      alt=""
      aria-hidden="true"
      onError={() => setBroken(true)}
      className={cn("shrink-0 overflow-hidden bg-white/[0.05] object-cover", className)}
    />
  );
}

/**
 * Výběr řazení. Nabídka visí u tlačítka, ne v dialogu - řazení se přepíná
 * často a plné okno přes celý displej by kvůli jednomu kliknutí bylo moc.
 */
function SortMenu({
  value,
  open,
  onOpenChange,
  onChange,
}: {
  value: SortKey;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (key: SortKey) => void;
}) {
  const holder = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!holder.current?.contains(event.target as Node)) onOpenChange(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onOpenChange]);

  const active = SORT_OPTIONS.find((option) => option.key === value) ?? SORT_OPTIONS[0];

  return (
    <div ref={holder} className="relative shrink-0">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Řazení: ${active.label}`}
        title={`Řazení: ${active.label}`}
        className="flex h-9 items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowDownUp className="size-3.5 shrink-0" />
        <span className="hidden whitespace-nowrap sm:inline">{active.label}</span>
      </button>
      {open ? (
        <div role="listbox" className="animate-in-up absolute right-0 z-50 mt-2 w-52 overflow-hidden rounded-xl border bg-popover p-1 shadow-xl">
          {SORT_OPTIONS.map((option) => (
            <button
              key={option.key}
              type="button"
              role="option"
              aria-selected={option.key === value}
              onClick={() => {
                onChange(option.key);
                onOpenChange(false);
              }}
              className={cn(
                "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-white/[0.06]",
                option.key === value ? "text-brand" : "text-muted-foreground",
              )}
            >
              <Check className={cn("size-3.5 shrink-0", option.key === value ? "opacity-100" : "opacity-0")} />
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Equalizer({ active = false }: { active?: boolean }) {
  return (
    <span className={cn("flex h-4 items-end gap-0.5", active && "equalizer-active")} aria-hidden="true">
      <i className="h-2 w-0.5 rounded-full bg-brand" />
      <i className="h-4 w-0.5 rounded-full bg-brand" />
      <i className="h-3 w-0.5 rounded-full bg-brand" />
      <i className="h-1.5 w-0.5 rounded-full bg-brand" />
    </span>
  );
}

function TrackRow({
  track,
  active,
  liked,
  plays,
  onPlay,
  onLike,
}: {
  track: Track;
  active: boolean;
  liked: boolean;
  plays: number;
  onPlay: () => void;
  onLike: () => void;
}) {
  return (
    <div className="group flex min-w-0 items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-white/[0.04]">
      <button type="button" onClick={onPlay} className="relative shrink-0" aria-label={`Přehrát ${track.title}`}>
        <Cover track={track} className="size-12 rounded-xl" />
        <span className={cn("absolute inset-0 flex items-center justify-center rounded-xl bg-black/50 text-white transition-opacity", active ? "opacity-100" : "opacity-0 group-hover:opacity-100")}>
          {active ? <Pause className="size-4 fill-current" /> : <Play className="size-4 fill-current" />}
        </span>
      </button>
      <button type="button" onClick={onPlay} className="min-w-0 flex-1 text-left">
        <span className="flex min-w-0 items-center gap-2">
          <span className={cn("truncate text-sm", active ? "font-medium text-brand" : "font-medium")}>{track.title}</span>
          {active ? <Equalizer active /> : null}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {track.artist}
          {plays > 0 ? <span className="tabular-nums"> · {plays}× přehráno</span> : null}
        </span>
      </button>
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{track.duration}</span>
      <button
        type="button"
        onClick={onLike}
        className={cn(
          "shrink-0 rounded-lg p-2 transition-colors hover:text-brand",
          // Srdce se drží zpátky, dokud na něj uživatel nesáhne - v klidném
          // seznamu nemá co dělat řada stejných ikon.
          liked ? "text-brand" : "text-muted-foreground opacity-0 focus-visible:opacity-100 group-hover:opacity-100",
        )}
        aria-label={liked ? "Odebrat z oblíbených" : "Přidat do oblíbených"}
      >
        <Heart className={cn("size-4", liked && "fill-current")} />
      </button>
    </div>
  );
}

export default function HomePage() {
  const { toast } = useToast();
  const [activeView, setActiveView] = React.useState<View>("library");
  const [tracks, setTracks] = React.useState<Track[]>([]);
  const [currentTrackId, setCurrentTrackId] = React.useState<string | null>(null);
  const [isPlaying, setIsPlaying] = React.useState(false);
  const [currentTime, setCurrentTime] = React.useState(0);
  const [duration, setDuration] = React.useState(0);
  const [volume, setVolume] = React.useState(0.78);
  const [isMuted, setIsMuted] = React.useState(false);
  const [isShuffled, setIsShuffled] = React.useState(false);
  const [repeatMode, setRepeatMode] = React.useState<RepeatMode>("off");
  const [query, setQuery] = React.useState("");
  const [libraryFilter, setLibraryFilter] = React.useState<LibraryFilter>("all");
  const [sortKey, setSortKey] = React.useState<SortKey>("added");
  const [sortOpen, setSortOpen] = React.useState(false);
  const [liked, setLiked] = React.useState<Set<string>>(new Set());
  /** Statistika poslechu podle id skladby - živí řazení „Nejposlouchanější". */
  const [playStats, setPlayStats] = React.useState<Record<string, PlayStat>>({});
  const [storageReady, setStorageReady] = React.useState(false);
  /** Zapnuté addony. Seznam i klíče v úložišti drží `settings-dialog`. */
  const [addons, setAddons] = React.useState<Addons>({ reader: true, video: true });
  const [mediaPermission, setMediaPermission] = React.useState<"unknown" | "granted" | "denied" | "unavailable">("unknown");
  const [isLoadingMedia, setIsLoadingMedia] = React.useState(false);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  /** Čas, kdy má hudba usnout. `null` = časovač neběží. */
  const [sleepAt, setSleepAt] = React.useState<number | null>(null);
  /** Doběhnout rozjetou skladbu a teprve pak ztichnout. */
  const [sleepAfterTrack, setSleepAfterTrack] = React.useState(false);
  const [sleepOpen, setSleepOpen] = React.useState(false);
  const [sleepLeft, setSleepLeft] = React.useState(0);
  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const localObjectUrls = React.useRef<string[]>([]);
  /** Skladba a vteřina z minula - dosedne, až se knihovna načte. */
  const resumeRef = React.useRef<{ id: string; time: number } | null>(null);
  /** Vteřina, na kterou se má skočit, jakmile prohlížeč načte délku skladby. */
  const pendingSeek = React.useRef(0);
  /** Poslední verze ovladačů pro MediaSession, která se registruje jen jednou. */
  const controls = React.useRef({ next: () => {}, previous: () => {} });

  /** Knihovna dokumentů z disku - stejně jako knihovna hudby přežije restart. */
  const [documents, setDocuments] = React.useState<StoredDocument[]>([]);
  const [documentId_, setDocumentId] = React.useState<string | null>(null);
  const [documentPage, setDocumentPage] = React.useState(0);
  const [documentQuery, setDocumentQuery] = React.useState("");
  const [documentZoom, setDocumentZoom] = React.useState(100);
  const [documentBookmarks, setDocumentBookmarks] = React.useState<number[]>([]);
  const [isLoadingDocument, setIsLoadingDocument] = React.useState(false);
  const [isReadingDocument, setIsReadingDocument] = React.useState(false);
  const [documentError, setDocumentError] = React.useState<string | null>(null);
  /** Kus věty, u kterého řeč stojí - odtud se po pauze pokračuje. */
  const [speechChunk, setSpeechChunk] = React.useState(0);
  /** Žádost o čtení: `null` = ticho. Nový objekt spustí čtení znovu. */
  const [readRequest, setReadRequest] = React.useState<{ from: number } | null>(null);
  const [speechRate, setSpeechRate] = React.useState<number>(1);
  const speaker = React.useRef<Speaker | null>(null);

  const currentTrack = tracks.find((track) => track.id === currentTrackId) ?? EMPTY_TRACK;

  /**
   * Co je vidět v seznamu - a zároveň fronta přehrávání. Když si uživatel
   * pustí Oblíbené, „další skladba" musí zůstat v oblíbených; jinak by
   * tlačítko vpřed hrálo něco, co na obrazovce vůbec není.
   */
  const visibleTracks = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = tracks.filter((track) => {
      const matchesQuery = !needle || `${track.title} ${track.artist} ${track.album}`.toLowerCase().includes(needle);
      const matchesFilter =
        libraryFilter === "all" || (libraryFilter === "liked" ? liked.has(track.id) : track.source === "local");
      return matchesQuery && matchesFilter;
    });

    const byTitle = (a: Track, b: Track) => a.title.localeCompare(b.title, "cs");
    // Druhé kritérium je vždycky název, ať se seznam při shodě neházel sem tam.
    return filtered.sort((a, b) => {
      switch (sortKey) {
        case "played":
          return (playStats[b.id]?.count ?? 0) - (playStats[a.id]?.count ?? 0) || byTitle(a, b);
        case "added":
          return b.addedAt - a.addedAt || byTitle(a, b);
        case "titleDesc":
          return byTitle(b, a);
        case "artist":
          return a.artist.localeCompare(b.artist, "cs") || byTitle(a, b);
        case "duration":
          return b.durationSeconds - a.durationSeconds || byTitle(a, b);
        default:
          return byTitle(a, b);
      }
    });
  }, [tracks, query, libraryFilter, liked, sortKey, playStats]);

  // Hledání frontu zužuje jen zdánlivě - když je puštěná skladba mimo výběr,
  // pokračuje se celou knihovnou, aby přehrávání neuvázlo.
  const queue = visibleTracks.some((track) => track.id === currentTrackId) ? visibleTracks : tracks;

  const activeDoc = documents.find((doc) => doc.id === documentId_) ?? null;
  const documentPages: DocumentPage[] = activeDoc?.pages ?? [];
  const documentName = activeDoc?.name ?? null;
  const activeDocument = documentPages[documentPage];
  const readablePage = activeDoc !== null && !activeDoc.imageOnly && Boolean(activeDocument?.text);
  const chunks = React.useMemo(
    () => (readablePage ? speechChunks(activeDocument.text) : []),
    [readablePage, activeDocument],
  );

  const loadDeviceMusic = React.useCallback(async (requestPermission = false) => {
    if (!canReadDeviceMedia()) {
      setMediaPermission("unavailable");
      return;
    }

    setIsLoadingMedia(true);
    try {
      const permission = requestPermission
        ? await MediaLibrary.requestPermission()
        : await MediaLibrary.checkPermission();
      if (!permission.granted) {
        setMediaPermission("denied");
        if (requestPermission) toast({ tone: "warn", title: "Přístup k hudbě nebyl povolen", description: "Povol ho v systémovém nastavení aplikace." });
        return;
      }

      const result = await MediaLibrary.listAudio();
      const importedTracks = result.tracks.map(mapNativeTrack);
      setMediaPermission("granted");
      setTracks((previous) => [...importedTracks, ...previous.filter((track) => track.source === "local")]);
      setCurrentTrackId((previous) => previous ?? importedTracks[0]?.id ?? null);
      if (requestPermission) {
        toast({
          tone: importedTracks.length ? "win" : "info",
          title: importedTracks.length ? "Hudba načtena" : "Žádná hudba nenalezena",
          description: importedTracks.length ? `${importedTracks.length} skladeb ze zařízení.` : "Přidej MP3 do Hudby nebo Stažených souborů.",
        });
      }
    } catch (error) {
      console.error("Chyba při načítání hudby ze zařízení", error);
      setMediaPermission("denied");
      if (requestPermission) toast({ tone: "warn", title: "Hudbu se nepodařilo načíst", description: "Zkontroluj oprávnění aplikace v Androidu." });
    } finally {
      setIsLoadingMedia(false);
    }
  }, [toast]);

  const openMediaSettings = React.useCallback(async () => {
    if (!canReadDeviceMedia()) return;
    try {
      await MediaLibrary.openAppSettings();
    } catch (error) {
      console.error("Nepodařilo se otevřít nastavení oprávnění", error);
      toast({ tone: "warn", title: "Nastavení se nepodařilo otevřít", description: "Otevři Android Nastavení a najdi P/_ayer ručně." });
    }
  }, [toast]);

  const requestMediaAccess = React.useCallback(async () => {
    if (mediaPermission === "denied") {
      await openMediaSettings();
      return;
    }
    await loadDeviceMusic(true);
  }, [loadDeviceMusic, mediaPermission, openMediaSettings]);

  React.useEffect(() => {
    const savedLikes = localStorage.getItem("microwins:liked_tracks");
    if (savedLikes) {
      try {
        const ids = JSON.parse(savedLikes);
        if (Array.isArray(ids)) setLiked(new Set(ids.filter((id): id is string => typeof id === "string")));
      } catch {
        // Ignore old or malformed local state.
      }
    }

    const savedStats = localStorage.getItem("microwins:play_stats");
    if (savedStats) {
      try {
        const parsed: unknown = JSON.parse(savedStats);
        if (parsed && typeof parsed === "object") setPlayStats(parsed as Record<string, PlayStat>);
      } catch {
        // Rozbitá statistika se zahodí, poslech kvůli ní stát nebude.
      }
    }

    const savedSort = localStorage.getItem("microwins:sort");
    if (SORT_OPTIONS.some((option) => option.key === savedSort)) setSortKey(savedSort as SortKey);

    // Kde uživatel skončil. Skladba se jen připraví a nastaví čas - hrát začne
    // až na jeho pokyn, prohlížeč sám od sebe zvuk stejně nepustí.
    const savedResume = localStorage.getItem("microwins:resume");
    if (savedResume) {
      try {
        const parsed = JSON.parse(savedResume);
        if (parsed && typeof parsed.id === "string") {
          resumeRef.current = { id: parsed.id, time: Number(parsed.time) || 0 };
        }
      } catch {
        // Bez návratu se prostě začne od začátku.
      }
    }

    setAddons(loadAddons());
    setStorageReady(true);
    void loadDeviceMusic();

    // Knihovna dokumentů z disku. Naposledy otevřený se rovnou nabídne
    // a otevře se na stránce, kde uživatel skončil.
    void listDocuments().then((stored) => {
      if (!stored.length) return;
      setDocuments(stored);
      setDocumentId(stored[0].id);
      setDocumentPage(stored[0].page);
      setDocumentBookmarks(stored[0].bookmarks);
    });
  }, [loadDeviceMusic]);

  React.useEffect(() => {
    if (storageReady) localStorage.setItem("microwins:liked_tracks", JSON.stringify([...liked]));
  }, [liked, storageReady]);

  React.useEffect(() => {
    if (storageReady) localStorage.setItem("microwins:play_stats", JSON.stringify(playStats));
  }, [playStats, storageReady]);

  React.useEffect(() => {
    if (storageReady) localStorage.setItem("microwins:sort", sortKey);
  }, [sortKey, storageReady]);

  /** Návrat tam, kde se skončilo. Jde jen o skladby, které v zařízení pořád jsou. */
  React.useEffect(() => {
    const resume = resumeRef.current;
    if (!resume || !tracks.length) return;
    resumeRef.current = null;
    if (!tracks.some((track) => track.id === resume.id)) return;
    setCurrentTrackId(resume.id);
    pendingSeek.current = resume.time;
  }, [tracks]);

  /**
   * Pozice se zapisuje průběžně, ne až při zavření. Appku umí Android sestřelit
   * na pozadí kdykoliv a poslední minuta poslechu by se ztratila.
   */
  React.useEffect(() => {
    if (!storageReady || !currentTrackId || currentTrackId === EMPTY_TRACK.id) return;
    const save = () => {
      localStorage.setItem(
        "microwins:resume",
        JSON.stringify({ id: currentTrackId, time: audioRef.current?.currentTime ?? 0 }),
      );
    };
    save();
    const timer = window.setInterval(save, 5000);
    return () => {
      save();
      window.clearInterval(timer);
    };
  }, [currentTrackId, storageReady]);

  React.useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentTrack) return;
    audio.load();
    setCurrentTime(0);
    setDuration(currentTrack.durationSeconds);
    if (isPlaying) {
      audio.play().catch(() => setIsPlaying(false));
    }
  }, [currentTrackId]);

  /** Odpočet časovače. Vteřinový tik stačí - vyšší přesnost by nikdo nepoznal. */
  React.useEffect(() => {
    if (sleepAt === null) {
      setSleepLeft(0);
      return;
    }
    const tick = () => {
      const left = sleepAt - Date.now();
      setSleepLeft(Math.max(0, left));
      if (left > 0) return;
      audioRef.current?.pause();
      setIsPlaying(false);
      setSleepAt(null);
      toast({ tone: "info", title: "Časovač doběhl", description: "Hudba usnula." });
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [sleepAt, toast]);

  /**
   * Ovládání ze zámku a z notifikace. Bez tohohle je z appky na telefonu jen
   * webová stránka - hudba sice hraje, ale sluchátka ani zamčený displej ji
   * neumí přeskočit a v notifikaci není vidět, co vlastně běží.
   */
  React.useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    const session = navigator.mediaSession;

    if (currentTrack.id === EMPTY_TRACK.id) {
      session.metadata = null;
      session.playbackState = "none";
      return;
    }

    session.metadata = new MediaMetadata({
      title: currentTrack.title,
      artist: currentTrack.artist,
      album: currentTrack.album,
      // Bez obalu jde do notifikace značka appky, ne prázdné místo.
      artwork: [{ src: currentTrack.artwork ?? "/logo-mark.png", sizes: "512x512", type: "image/png" }],
    });
    session.playbackState = isPlaying ? "playing" : "paused";
  }, [currentTrack, isPlaying]);

  React.useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    const actions: [MediaSessionAction, MediaSessionActionHandler][] = [
      ["play", () => void audioRef.current?.play().then(() => setIsPlaying(true)).catch(() => {})],
      ["pause", () => audioRef.current?.pause()],
      // Přes ref, aby se ovladače nepřepisovaly při každém překreslení.
      ["previoustrack", () => controls.current.previous()],
      ["nexttrack", () => controls.current.next()],
      [
        "seekto",
        (details) => {
          if (details.seekTime === undefined || !audioRef.current) return;
          audioRef.current.currentTime = details.seekTime;
          setCurrentTime(details.seekTime);
        },
      ],
    ];

    for (const [action, handler] of actions) {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {
        // Starší WebView některou akci nezná - zbytek funguje dál.
      }
    }
    return () => {
      for (const [action] of actions) {
        try {
          navigator.mediaSession.setActionHandler(action, null);
        } catch {
          // Odhlášení může selhat jen tam, kde se registrace nepovedla.
        }
      }
    };
  }, []);

  React.useEffect(() => {
    if (audioRef.current) audioRef.current.volume = isMuted ? 0 : volume;
  }, [volume, isMuted]);

  React.useEffect(() => {
    return () => {
      localObjectUrls.current.forEach((url) => URL.revokeObjectURL(url));
      speaker.current?.stop();
    };
  }, []);

  /**
   * Klávesy na počítači. Mezerník a šipky umí každý přehrávač a bez nich se
   * na klávesnici ovládá appka mizerně. Psaní do polí se nepřerušuje.
   */
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true'], [role='dialog']")) return;

      const audio = audioRef.current;
      if (event.code === "Space") {
        event.preventDefault();
        playTrack(currentTrack.id);
        return;
      }
      if (!audio || currentTrack.id === EMPTY_TRACK.id) return;
      if (event.key === "ArrowRight") {
        event.preventDefault();
        const next = Math.min(audio.duration || 0, audio.currentTime + 5);
        audio.currentTime = next;
        setCurrentTime(next);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        const next = Math.max(0, audio.currentTime - 5);
        audio.currentTime = next;
        setCurrentTime(next);
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const toggleLike = (trackId: string) => {
    setLiked((previous) => {
      const next = new Set(previous);
      if (next.has(trackId)) next.delete(trackId);
      else next.add(trackId);
      return next;
    });
  };

  /** Nová skladba se počítá do statistiky - z ní žije řazení podle poslechu. */
  const startTrack = (trackId: string) => {
    setCurrentTrackId(trackId);
    setIsPlaying(true);
    setPlayStats((previous) => ({
      ...previous,
      [trackId]: { count: (previous[trackId]?.count ?? 0) + 1, at: Date.now() },
    }));
  };

  const playTrack = (trackId: string) => {
    if (trackId === EMPTY_TRACK.id) return;
    // Hudba a předčítání se v jednom přehrávači nepřekřikují.
    stopReading();
    if (trackId === currentTrackId) {
      if (isPlaying) {
        audioRef.current?.pause();
        setIsPlaying(false);
      } else {
        audioRef.current?.play().then(() => setIsPlaying(true)).catch(() => {
          toast({ tone: "warn", title: "Skladbu se nepodařilo spustit", description: "Soubor už nemusí být dostupný v zařízení." });
        });
      }
      return;
    }
    startTrack(trackId);
  };

  const playNext = () => {
    if (!queue.length) return;
    stopReading();
    const index = queue.findIndex((track) => track.id === currentTrackId);
    const nextIndex = isShuffled ? Math.floor(Math.random() * queue.length) : (index + 1) % queue.length;
    startTrack(queue[nextIndex].id);
  };

  const playPrevious = () => {
    if (!queue.length) return;
    stopReading();
    if (audioRef.current && currentTime > 4) {
      audioRef.current.currentTime = 0;
      setCurrentTime(0);
      return;
    }
    const index = queue.findIndex((track) => track.id === currentTrackId);
    startTrack(queue[(index - 1 + queue.length) % queue.length].id);
  };

  const handleEnded = () => {
    // Časovač „do konce skladby" se vybírá právě tady - ne po vteřinách.
    if (sleepAfterTrack) {
      setSleepAfterTrack(false);
      setIsPlaying(false);
      setCurrentTime(0);
      toast({ tone: "info", title: "Časovač doběhl", description: "Hudba usnula po dohrání skladby." });
      return;
    }
    if (repeatMode === "one") {
      if (audioRef.current) {
        audioRef.current.currentTime = 0;
        audioRef.current.play().catch(() => setIsPlaying(false));
      }
      return;
    }
    if (repeatMode === "off" && queue.findIndex((track) => track.id === currentTrackId) === queue.length - 1) {
      setIsPlaying(false);
      setCurrentTime(0);
      return;
    }
    playNext();
  };

  controls.current = { next: playNext, previous: playPrevious };

  const startSleepTimer = (minutes: number) => {
    setSleepOpen(false);
    if (minutes > 0) {
      setSleepAfterTrack(false);
      setSleepAt(Date.now() + minutes * 60_000);
      toast({ tone: "info", title: `Časovač na ${minutes} minut`, description: "Pak hudba sama ztichne." });
      return;
    }
    setSleepAt(null);
    setSleepAfterTrack(true);
    toast({ tone: "info", title: "Časovač do konce skladby", description: "Po dohrání se přehrávání zastaví." });
  };

  const cancelSleepTimer = () => {
    setSleepOpen(false);
    setSleepAt(null);
    setSleepAfterTrack(false);
  };

  const handleAudioUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length) return;

    const addedTracks = await Promise.all(
      files.map(async (file, index) => {
        const url = URL.createObjectURL(file);
        localObjectUrls.current.push(url);
        // Obal je schovaný v tagu souboru - vytáhne se rovnou při přidání,
        // ať se seznam nepřekresluje pokaždé, když skladba probleskne kolem.
        const artwork = await readEmbeddedArtwork(file);
        if (artwork) localObjectUrls.current.push(artwork);
        return {
          id: `local-${Date.now()}-${index}`,
          title: file.name.replace(/\.[^/.]+$/, ""),
          artist: "Místní soubor",
          album: "Moje zařízení",
          duration: "--:--",
          durationSeconds: 0,
          src: url,
          artwork,
          // Ručně vybraný soubor je z pohledu knihovny čerstvý přírůstek.
          addedAt: Date.now(),
          source: "local" as const,
        };
      }),
    );

    setTracks((previous) => [...addedTracks, ...previous]);
    // Přes startTrack, ať se i tenhle poslech počítá do statistiky.
    startTrack(addedTracks[0].id);
    toast({ tone: "win", title: `${addedTracks.length} ${addedTracks.length === 1 ? "skladba přidána" : "skladby přidány"}`, description: "Najdeš je mezi skladbami." });
  };

  const openDocument = (doc: StoredDocument) => {
    stopReading();
    setDocumentId(doc.id);
    setDocumentPage(clampPage(doc.page, doc.pages.length));
    setDocumentBookmarks(doc.bookmarks);
    setDocumentError(
      doc.imageOnly
        ? `${doc.name} je obrázkový dokument - jsou v něm jen naskenované stránky bez textu. Přečíst nahlas ani prohledat ho nejde.`
        : null,
    );
  };

  const handleDocumentUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setIsLoadingDocument(true);
    setDocumentError(null);
    try {
      let pages: DocumentPage[] = [];
      if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
        const pdfjsLib = await import("pdfjs-dist");
        // Worker se vozí v public/ a odkazuje se absolutně z kořene - jediná
        // adresa, která sedí v prohlížeči i v appce. Viz scripts/copy-pdf-worker.mjs.
        pdfjsLib.GlobalWorkerOptions.workerSrc = `${window.location.origin}/pdf.worker.min.mjs`;
        const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
        for (let index = 1; index <= pdf.numPages; index += 1) {
          const page = await pdf.getPage(index);
          const content = await page.getTextContent();
          const text = content.items
            .map((item) => ("str" in item ? item.str : ""))
            .filter(Boolean)
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();
          pages.push({ text: pageText(text), label: `Strana ${index}` });
        }
      } else {
        pages = buildTextPages(await file.text());
      }
      if (!pages.length) throw new Error("Soubor je prázdný.");

      const doc: StoredDocument = {
        id: documentId(file.name, file.size),
        name: file.name,
        pages,
        // Naskenovaná kniha se pozná hned tady, ne až u tlačítka „Číst nahlas".
        imageOnly: isImageOnly(pages),
        addedAt: new Date().toISOString(),
        page: 0,
        bookmarks: [],
      };

      await saveDocument(doc);
      setDocuments((previous) => [doc, ...previous.filter((d) => d.id !== doc.id)]);
      openDocument(doc);

      toast(
        doc.imageOnly
          ? {
              tone: "warn",
              title: "Dokument je obrázkový",
              description: "Stránky jsou naskenované, text v nich není. Čtení nahlas nepůjde.",
            }
          : {
              tone: "win",
              title: "Dokument je připravený",
              description: `${pages.length} ${pages.length === 1 ? "stránka" : "stránek"} pro čtení offline.`,
            },
      );
    } catch (error) {
      console.error("Chyba při načítání dokumentu", error);
      setDocumentError("Soubor se nepodařilo otevřít. Čtečka umí PDF a textové soubory (TXT, MD).");
    } finally {
      setIsLoadingDocument(false);
      event.target.value = "";
    }
  };

  const forgetDocument = async (id: string) => {
    stopReading();
    await removeDocument(id);
    const rest = documents.filter((doc) => doc.id !== id);
    setDocuments(rest);
    if (documentId_ !== id) return;
    setDocumentError(null);
    if (rest[0]) openDocument(rest[0]);
    else setDocumentId(null);
  };

  // --- čtení nahlas ----------------------------------------------------------

  const stopReading = () => setReadRequest(null);

  /**
   * Zapnout čtení znamená říct, od kterého kusu - samotné mluvení obstará
   * efekt níž. Přes stav, ne přímým voláním: text stránky se mění (obrácený
   * list, jiný dokument) a čtení musí vždycky jet z toho, co je na obrazovce.
   */
  const toggleDocumentReading = () => {
    if (readRequest) {
      // Pauza, ne konec: index rozečteného kusu zůstává, takže se pokračuje
      // odtud, ne od začátku stránky.
      stopReading();
      return;
    }
    if (!readablePage) return;
    setReadRequest({ from: speechChunk });
  };

  const changeSpeechRate = (rate: number) => {
    setSpeechRate(rate);
    // Nová rychlost se chytne na rozečteném místě, ne na začátku stránky.
    if (readRequest) setReadRequest({ from: speechChunk });
  };

  /** Obrátí stránku. Když se zrovna čte, čte se dál na nové stránce od začátku. */
  const goToPage = (page: number) => {
    const next = clampPage(page, documentPages.length);
    if (next === documentPage) return;
    setDocumentPage(next);
    setSpeechChunk(0);
    if (readRequest) setReadRequest({ from: 0 });
  };

  /**
   * Vlastní mluvení. Řeč a hudba se nikdy nepřekrývají - dva zvuky přes sebe
   * nedávají smysl a přehrávač je jeden, i když má dva zdroje.
   */
  React.useEffect(() => {
    if (!readRequest) {
      setIsReadingDocument(false);
      return;
    }
    if (!chunks.length) {
      setReadRequest(null);
      return;
    }

    audioRef.current?.pause();
    setIsPlaying(false);
    setIsReadingDocument(true);

    const engine = createSpeaker({
      onChunk: setSpeechChunk,
      onDone: () => {
        setSpeechChunk(0);
        // Konec stránky = obrátit list, stejně jako skladba přejde na další.
        if (documentPage < documentPages.length - 1) {
          setDocumentPage(documentPage + 1);
          setReadRequest({ from: 0 });
        } else {
          setReadRequest(null);
        }
      },
      onError: (message) => {
        setReadRequest(null);
        toast({ tone: "warn", title: "Čtení nahlas selhalo", description: message });
      },
    });
    speaker.current = engine;
    engine.speak(chunks, readRequest.from, speechRate);

    return () => {
      engine.stop();
      if (speaker.current === engine) speaker.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readRequest, chunks, speechRate, documentPage, documentPages.length]);

  // Postup ve čtení patří na disk: appka se zavírá i uprostřed stránky.
  React.useEffect(() => {
    if (!documentId_) return;
    void saveProgress(documentId_, documentPage, documentBookmarks);
  }, [documentId_, documentPage, documentBookmarks]);

  const toggleBookmark = () => {
    setDocumentBookmarks((previous) => previous.includes(documentPage) ? previous.filter((page) => page !== documentPage) : [...previous, documentPage]);
  };

  /**
   * Ztiší všechno ostatní. Volá se, když se rozjíždí video - hudba, předčítání
   * a video jsou tři zdroje zvuku v jedné appce a přes sebe nedávají smysl.
   */
  const silenceEverything = () => {
    stopReading();
    audioRef.current?.pause();
    setIsPlaying(false);
  };

  const handleAddonChange = (id: AddonId, enabled: boolean) => {
    setAddons((previous) => ({ ...previous, [id]: enabled }));
    // Vypnutý addon nesmí zůstat na obrazovce, na kterou se pak nedá vrátit.
    if (!enabled && activeView === id) setActiveView("library");
  };

  /** Záložky nad obsahem. Addon bez svojí položky ze seznamu vypadne. */
  const views: { id: View; label: string; icon: typeof Library }[] = [
    { id: "library", label: "Skladby", icon: Library },
    ...(addons.reader ? [{ id: "reader" as const, label: "Dokumenty", icon: BookOpenText }] : []),
    ...(addons.video ? [{ id: "video" as const, label: "Video", icon: Film }] : []),
  ];

  const progress = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;
  const librarySeconds = tracks.reduce((total, track) => total + track.durationSeconds, 0);
  const sleepActive = sleepAt !== null || sleepAfterTrack;

  const goToView = (view: View) => {
    if (!views.some((v) => v.id === view)) return;
    setActiveView(view);
  };

  const renderDocumentText = (text: string) => {
    if (!documentQuery) return text;
    const escaped = documentQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return text.split(new RegExp(`(${escaped})`, "ig")).map((part, index) => part.toLowerCase() === documentQuery.toLowerCase() ? <mark key={index} className="rounded bg-brand/35 px-0.5 text-inherit">{part}</mark> : part);
  };

  return (
    <div className="flex min-h-screen flex-col select-none text-foreground bg-background">
      <header className="mw-safe-top mw-safe-x sticky top-0 z-40 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-4xl items-center gap-3 px-4">
          <button type="button" onClick={() => goToView("library")} className="mr-2 flex items-center gap-2.5 text-lg font-semibold tracking-tight">
            {/* eslint-disable-next-line @next/next/no-img-element -- statická značka z public/ */}
            <img src="/logo-brand.png" alt="" aria-hidden="true" className="size-8 shrink-0" />
            P/_AYER
          </button>

          <nav className="hidden items-center gap-1 sm:flex">
            {views.map((item) => {
              const Icon = item.icon;
              const active = activeView === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => goToView(item.id)}
                  className={cn(
                    "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm transition-colors",
                    active
                      ? "bg-secondary font-medium text-secondary-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                  )}
                >
                  <Icon className="size-4" />
                  <span>{item.label}</span>
                  {item.id === "reader" && documentName && <span className="ml-1 size-1.5 rounded-full bg-brand" />}
                </button>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={() => setSleepOpen(true)}
              aria-label="Časovač spánku"
              title="Časovač spánku"
              className={cn(
                "flex h-10 items-center gap-1.5 rounded-full px-3 text-sm transition-colors hover:bg-accent",
                sleepActive ? "text-brand" : "text-muted-foreground",
              )}
            >
              {sleepActive ? <TimerReset className="size-5" /> : <Timer className="size-5" />}
              {sleepAt !== null ? <span className="tabular-nums text-xs">{Math.ceil(sleepLeft / 60000)}′</span> : null}
            </button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Nastavení"
              title="Nastavení"
              onClick={() => setSettingsOpen(true)}
              className="size-10 rounded-full"
            >
              <Settings className="size-5" />
            </Button>
          </div>
        </div>
      </header>

      <main className="mw-pad-nav mx-auto w-full max-w-4xl flex-1 px-4 pt-6 pb-32">
        {activeView === "library" ? (
          <section className="animate-in-up">
            <div className="mb-6">
              <h1 className="text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">Skladby</h1>
              <p className="mt-1.5 text-sm text-muted-foreground">
                {tracks.length} {tracks.length === 1 ? "skladba" : "skladeb"}
                {formatTotal(librarySeconds) ? ` · ${formatTotal(librarySeconds)}` : ""}
              </p>
              <div className="mt-5 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => visibleTracks[0] && startTrack(visibleTracks[0].id)}
                  disabled={!visibleTracks.length}
                  className="flex h-11 items-center gap-2 rounded-full bg-brand px-5 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                  <Play className="size-4 fill-current" /> Přehrát
                </button>
                <label className="flex h-11 cursor-pointer items-center gap-2 rounded-full border px-5 text-sm font-medium transition-colors hover:bg-accent">
                  <Plus className="size-4" /> Přidat
                  <input type="file" accept="audio/*" multiple onChange={handleAudioUpload} className="hidden" />
                </label>
                {mediaPermission !== "unavailable" ? (
                  <button
                    type="button"
                    onClick={requestMediaAccess}
                    disabled={isLoadingMedia}
                    aria-label={mediaPermission === "denied" ? "Otevřít nastavení oprávnění" : "Obnovit knihovnu"}
                    title={mediaPermission === "denied" ? "Otevřít nastavení oprávnění" : "Obnovit knihovnu"}
                    className="flex size-11 items-center justify-center rounded-full border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
                  >
                    {isLoadingMedia ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                  </button>
                ) : null}
              </div>
            </div>

            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex gap-1 rounded-full bg-white/[0.04] p-1">
                {(["all", "liked", "local"] as const).map((filter) => (
                  <button
                    key={filter}
                    type="button"
                    onClick={() => setLibraryFilter(filter)}
                    className={cn(
                      "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                      libraryFilter === filter ? "bg-white/10 text-foreground" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {filter === "all" ? "Vše" : filter === "liked" ? "Oblíbené" : "Moje soubory"}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <div className="relative flex-1 sm:w-56">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Hledat" className="h-9 rounded-full border-white/10 bg-white/[0.04] pl-9 text-xs" />
                </div>
                <SortMenu value={sortKey} open={sortOpen} onOpenChange={setSortOpen} onChange={setSortKey} />
              </div>
            </div>
            {visibleTracks.length ? (
              <div className="-mx-2">{visibleTracks.map((track) => <TrackRow key={track.id} track={track} active={track.id === currentTrackId && isPlaying} liked={liked.has(track.id)} plays={playStats[track.id]?.count ?? 0} onPlay={() => playTrack(track.id)} onLike={() => toggleLike(track.id)} />)}</div>
            ) : (
              <div className="flex min-h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 px-6 text-center">
                <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-white/[0.05] text-muted-foreground">
                  {/* eslint-disable-next-line @next/next/no-img-element -- statická značka z public/ */}
                  {tracks.length ? <Heart className="size-5" /> : <img src="/logo-mark.png" alt="" className="size-8 opacity-90" />}
                </div>
                <p className="font-medium">{tracks.length ? "Tady je zatím ticho." : mediaPermission === "denied" ? "Přístup k hudbě je vypnutý" : "Zatím tu nejsou žádné skladby"}</p>
                <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                  {tracks.length
                    ? "Zkus změnit filtr nebo přidat vlastní hudbu."
                    : mediaPermission === "denied"
                      ? "Android ho zamítl. Otevři nastavení aplikace a povol Hudbu a audio."
                      : mediaPermission === "unavailable"
                        ? "V prohlížeči hudbu v telefonu nevidím - vyber soubory ručně."
                        : "Přehrávač načte hudbu z telefonu, včetně složky Stažené."}
                </p>
                {/* Bez skladeb je tohle jediná cesta dál - proto tu obě tlačítka zůstávají. */}
                {tracks.length ? null : (
                  <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                    {mediaPermission !== "unavailable" ? (
                      <button type="button" onClick={requestMediaAccess} className="inline-flex h-9 items-center gap-2 rounded-lg bg-brand px-3 text-xs font-semibold text-black transition-opacity hover:opacity-90">{mediaPermission === "denied" ? "Otevřít nastavení" : "Povolit přístup"}</button>
                    ) : null}
                    <label className="flex h-9 cursor-pointer items-center gap-2 rounded-lg border px-3 text-xs font-medium hover:bg-accent"><Upload className="size-3.5" /> Vybrat soubory<input type="file" accept="audio/*" multiple onChange={handleAudioUpload} className="hidden" /></label>
                  </div>
                )}
              </div>
            )}
          </section>
        ) : null}

        {activeView === "reader" && addons.reader ? (
          <section className="animate-in-up">
            <div className="mb-6">
              <h1 className="text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">Dokumenty</h1>
              <p className="mt-1.5 max-w-lg text-sm text-muted-foreground">Nahraj PDF nebo text a čti bez rozptylování. Dokument zůstane v knihovně i po zavření appky.</p>
              <label className="mt-5 flex h-11 w-fit cursor-pointer items-center gap-2 rounded-full bg-brand px-5 text-sm font-semibold text-black transition-opacity hover:opacity-90"><FileUp className="size-4" /> Otevřít dokument<input type="file" accept=".pdf,.txt,.md,.text,application/pdf,text/plain,text/markdown" onChange={handleDocumentUpload} className="hidden" /></label>
            </div>

            {documents.length > 0 ? (
              <div className="mb-5 flex flex-wrap gap-2">
                {documents.map((doc) => (
                  <div
                    key={doc.id}
                    className={cn(
                      "flex items-center gap-2 rounded-xl border px-3 py-2 text-xs transition-colors",
                      doc.id === documentId_ ? "border-brand/40 bg-brand/10 text-brand" : "border-white/[0.08] text-muted-foreground hover:bg-white/[0.05]",
                    )}
                  >
                    <button type="button" onClick={() => openDocument(doc)} className="flex min-w-0 items-center gap-2 text-left">
                      <FileText className="size-3.5 shrink-0" />
                      <span className="max-w-[180px] truncate">{doc.name}</span>
                      <span className="shrink-0 tabular-nums opacity-60">{clampPage(doc.page, doc.pages.length) + 1}/{doc.pages.length}</span>
                    </button>
                    <button type="button" onClick={() => void forgetDocument(doc.id)} className="shrink-0 rounded-md p-0.5 opacity-50 hover:opacity-100" aria-label={`Odebrat ${doc.name} z knihovny`}>
                      <X className="size-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            ) : null}

            {!activeDoc ? (
              <div className="reader-empty rounded-[1.75rem] border border-dashed border-brand/20 p-8 text-center sm:p-16">
                <div className="mx-auto flex size-16 items-center justify-center rounded-3xl bg-brand/10 text-brand"><BookOpenText className="size-7" /></div>
                <h2 className="mt-5 text-xl font-semibold">Tvoje klidná čítárna</h2>
                <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">Nahraj první dokument. Zůstane jen v tomto zařízení, bez účtu a bez cloudu.</p>
                <label className="mx-auto mt-6 flex h-10 w-fit cursor-pointer items-center gap-2 rounded-xl border border-white/10 bg-white/[0.06] px-4 text-sm font-medium hover:bg-white/10"><Plus className="size-4" /> Vybrat soubor<input type="file" accept=".pdf,.txt,.md,.text,application/pdf,text/plain,text/markdown" onChange={handleDocumentUpload} className="hidden" /></label>
                <div className="mx-auto mt-8 flex max-w-md items-center justify-center gap-5 text-[10px] uppercase tracking-[0.14em] text-muted-foreground"><span><Check className="mr-1 inline size-3 text-brand" /> lokálně</span><span><Check className="mr-1 inline size-3 text-brand" /> bez účtu</span><span><Check className="mr-1 inline size-3 text-brand" /> PDF / TXT</span></div>
              </div>
            ) : (
              <div className="grid gap-5 xl:grid-cols-[210px_minmax(0,1fr)]">
                <aside className="order-2 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-3 xl:order-1">
                  <div className="flex items-start justify-between gap-3 px-2 pb-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{documentName}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{documentPages.length} {documentPages.length === 1 ? "stránka" : "stránek"}</p>
                    </div>
                    <FileText className="size-4 shrink-0 text-brand" />
                  </div>
                  <div className="space-y-1 border-t border-white/[0.07] pt-3">
                    {documentPages.map((page, index) => (
                      <button
                        key={index}
                        type="button"
                        onClick={() => goToPage(index)}
                        className={cn("flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-xs transition-colors", index === documentPage ? "bg-brand/15 text-brand" : "text-muted-foreground hover:bg-white/[0.05] hover:text-foreground")}
                      >
                        <span className="w-5 text-[10px] tabular-nums opacity-60">{String(index + 1).padStart(2, "0")}</span>
                        <span className="truncate">{page.label}</span>
                        {documentBookmarks.includes(index) ? <BookmarkCheck className="ml-auto size-3 shrink-0 text-brand" /> : null}
                      </button>
                    ))}
                  </div>
                </aside>

                <div className="order-1 min-w-0 xl:order-2">
                  <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-center gap-2">
                      <FileText className="size-4 shrink-0 text-brand" />
                      <span className="truncate text-sm font-medium">{documentName}</span>
                      <span className="hidden rounded-md bg-white/[0.06] px-2 py-1 text-[10px] text-muted-foreground sm:block">{activeDocument?.label}</span>
                    </div>
                    <div className="relative sm:w-56">
                      <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                      <Input value={documentQuery} onChange={(event) => setDocumentQuery(event.target.value)} placeholder="Hledat v dokumentu" className="h-9 rounded-xl border-white/10 bg-white/[0.04] pl-9 text-xs" />
                    </div>
                  </div>

                  {activeDoc.imageOnly ? (
                    <div className="mb-3 flex items-start gap-2 rounded-xl border border-brand/25 bg-brand/10 px-4 py-3 text-xs text-brand">
                      <BookOpenText className="mt-0.5 size-4 shrink-0" />
                      <span>Tenhle dokument je obrázkový - stránky jsou naskenované a text v nich není. Listovat jde, číst nahlas ani hledat ne. Pomůže PDF s textovou vrstvou.</span>
                    </div>
                  ) : null}

                  <div className="reader-toolbar flex flex-wrap items-center justify-between gap-2 rounded-t-2xl border border-white/[0.08] bg-white/[0.045] px-3 py-2">
                    <div className="flex items-center gap-1">
                      <button type="button" className="reader-tool" onClick={() => setDocumentZoom((value) => Math.max(75, value - 10))} aria-label="Zmenšit"><ZoomOut className="size-4" /></button>
                      <span className="w-12 text-center text-xs tabular-nums text-muted-foreground">{documentZoom}%</span>
                      <button type="button" className="reader-tool" onClick={() => setDocumentZoom((value) => Math.min(140, value + 10))} aria-label="Zvětšit"><ZoomIn className="size-4" /></button>
                    </div>

                    <div className="flex items-center gap-1">
                      <button type="button" className={cn("reader-tool", documentBookmarks.includes(documentPage) && "text-brand")} onClick={toggleBookmark} aria-label="Záložka">
                        {documentBookmarks.includes(documentPage) ? <BookmarkCheck className="size-4" /> : <Bookmark className="size-4" />}
                      </button>
                      {readablePage || isReadingDocument ? (
                        <>
                          <button type="button" className="reader-tool disabled:opacity-30" disabled={documentPage === 0} onClick={() => goToPage(documentPage - 1)} aria-label="Stránka zpět"><SkipBack className="size-4 fill-current" /></button>
                          <button
                            type="button"
                            onClick={toggleDocumentReading}
                            className={cn("flex h-8 items-center gap-2 rounded-lg px-3 text-xs font-medium transition-colors", isReadingDocument ? "bg-brand text-black" : "hover:bg-white/10")}
                            aria-label={isReadingDocument ? "Pozastavit čtení" : "Číst nahlas"}
                          >
                            {isReadingDocument ? <Pause className="size-3.5 fill-current" /> : <Play className="size-3.5 fill-current" />}
                            {isReadingDocument ? "Pauza" : speechChunk > 0 ? "Pokračovat" : "Číst nahlas"}
                          </button>
                          <button type="button" className="reader-tool disabled:opacity-30" disabled={documentPage >= documentPages.length - 1} onClick={() => goToPage(documentPage + 1)} aria-label="Stránka vpřed"><SkipForward className="size-4 fill-current" /></button>
                          <select
                            value={speechRate}
                            onChange={(event) => changeSpeechRate(Number(event.target.value))}
                            aria-label="Rychlost čtení"
                            className="h-8 rounded-lg border border-white/10 bg-transparent px-1.5 text-xs text-muted-foreground outline-none"
                          >
                            {SPEECH_RATES.map((rate) => (
                              <option key={rate} value={rate} className="bg-black">{rate}×</option>
                            ))}
                          </select>
                        </>
                      ) : (
                        <span className="px-2 text-[11px] text-muted-foreground">čtení nahlas nejde</span>
                      )}
                    </div>
                  </div>

                  <div className="reader-paper min-h-[520px] overflow-auto rounded-b-2xl border-x border-b border-white/[0.08] p-6 shadow-2xl sm:p-12">
                    <article className="mx-auto max-w-2xl origin-top transition-transform" style={{ transform: `scale(${documentZoom / 100})`, transformOrigin: "top center", marginBottom: `${(documentZoom - 100) * 3}px` }}>
                      <p className="mb-8 text-xs font-semibold uppercase tracking-[0.18em] text-brand">{activeDocument?.label}</p>
                      <div className="whitespace-pre-wrap font-serif text-[1.04rem] leading-[1.9] text-white/90">{activeDocument ? renderDocumentText(activeDocument.text) : ""}</div>
                    </article>
                  </div>

                  <div className="mt-4 flex items-center justify-between">
                    <button type="button" disabled={documentPage === 0} onClick={() => goToPage(documentPage - 1)} className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs text-muted-foreground hover:bg-white/[0.05] hover:text-foreground disabled:opacity-30"><ChevronLeft className="size-4" /> Předchozí</button>
                    <span className="text-xs tabular-nums text-muted-foreground">{documentPage + 1} / {documentPages.length}</span>
                    <button type="button" disabled={documentPage === documentPages.length - 1} onClick={() => goToPage(documentPage + 1)} className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs text-muted-foreground hover:bg-white/[0.05] hover:text-foreground disabled:opacity-30">Další <ChevronRight className="size-4" /></button>
                  </div>
                </div>
              </div>
            )}

            {isLoadingDocument ? <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/35 backdrop-blur-sm"><div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-popover px-5 py-4 text-sm shadow-xl"><Loader2 className="size-4 animate-spin text-brand" /> Zpracovávám dokument…</div></div> : null}
            {documentError ? <div className="mt-4 flex items-center gap-2 rounded-xl border border-brand/30 bg-brand/10 px-4 py-3 text-xs text-brand"><X className="size-4" /> {documentError}</div> : null}
          </section>
        ) : null}

        {activeView === "video" && addons.video ? (
          <VideoLibrary onBeforePlay={silenceEverything} onToast={toast} />
        ) : null}
      </main>

      <nav className="mw-safe-bottom mw-safe-x fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur sm:hidden">
        <div className="mx-auto flex w-full max-w-4xl">
          {views.map((item) => {
            const Icon = item.icon;
            const active = activeView === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => goToView(item.id)}
                aria-label={item.label}
                className={cn(
                  "flex flex-1 items-center justify-center py-3 transition-colors",
                  active ? "text-foreground" : "text-muted-foreground",
                )}
              >
                <span
                  className={cn(
                    "flex h-9 w-16 items-center justify-center rounded-full transition-colors",
                    active && "bg-secondary text-secondary-foreground",
                  )}
                >
                  <Icon className="size-5" />
                </span>
              </button>
            );
          })}
        </div>
      </nav>

      <audio ref={audioRef} src={currentTrack.src || undefined} preload="metadata" loop={repeatMode === "one"} onPlay={() => setIsPlaying(true)} onPause={() => setIsPlaying(false)} onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)} onLoadedMetadata={(event) => { const nextDuration = event.currentTarget.duration; if (Number.isFinite(nextDuration)) { setDuration(nextDuration); setTracks((previous) => previous.map((track) => track.id === currentTrackId ? { ...track, durationSeconds: nextDuration, duration: formatTime(nextDuration) } : track)); } if (pendingSeek.current > 0) { const seekTo = Math.min(pendingSeek.current, nextDuration || pendingSeek.current); pendingSeek.current = 0; event.currentTarget.currentTime = seekTo; setCurrentTime(seekTo); } }} onEnded={handleEnded} onError={() => { if (currentTrack.id !== EMPTY_TRACK.id) toast({ tone: "warn", title: "Audio soubor není dostupný", description: "Zkontroluj, jestli je skladba stále v zařízení." }); }} className="hidden" />

      <div className="player-dock fixed inset-x-3 bottom-16 z-30 mx-auto max-w-4xl rounded-2xl border border-white/[0.11] shadow-2xl shadow-black/30 backdrop-blur-xl sm:inset-x-5 sm:bottom-5">
        <div className="flex flex-wrap items-center gap-3 px-3 py-3 sm:px-4"><div className="flex min-w-0 flex-1 items-center gap-3 sm:min-w-[190px]"><Cover track={currentTrack} className="size-11 rounded-xl" /><div className="min-w-0"><p className="truncate text-sm font-medium">{currentTrack.title}</p><p className="truncate text-xs text-muted-foreground">{currentTrack.artist}</p></div><button type="button" onClick={() => toggleLike(currentTrack.id)} className={cn("ml-1 hidden rounded-lg p-1.5 text-muted-foreground hover:text-brand sm:block", liked.has(currentTrack.id) && "text-brand")} aria-label="Oblíbené"><Heart className={cn("size-4", liked.has(currentTrack.id) && "fill-current")} /></button></div><div className="order-3 w-full sm:order-none sm:flex sm:flex-1 sm:flex-col sm:gap-1.5"><div className="hidden items-center justify-center gap-5 sm:flex"><button type="button" onClick={() => setIsShuffled((value) => !value)} className={cn("p-1 text-muted-foreground hover:text-foreground", isShuffled && "text-brand")} aria-label="Náhodné pořadí"><Shuffle className="size-4" /></button><button type="button" onClick={playPrevious} className="p-1 text-muted-foreground hover:text-foreground" aria-label="Předchozí"><SkipBack className="size-4 fill-current" /></button><button type="button" onClick={() => playTrack(currentTrack.id)} className="flex size-9 items-center justify-center rounded-full bg-foreground text-background transition-transform hover:scale-105" aria-label={isPlaying ? "Pozastavit" : "Přehrát"}>{isPlaying ? <Pause className="size-4 fill-current" /> : <Play className="ml-0.5 size-4 fill-current" />}</button><button type="button" onClick={playNext} className="p-1 text-muted-foreground hover:text-foreground" aria-label="Další"><SkipForward className="size-4 fill-current" /></button><button type="button" onClick={() => setRepeatMode((mode) => mode === "off" ? "all" : mode === "all" ? "one" : "off")} className={cn("p-1 text-muted-foreground hover:text-foreground", repeatMode !== "off" && "text-brand")} aria-label="Opakování"><Repeat2 className="size-4" /></button></div><div className="flex items-center gap-2"><span className="hidden w-9 text-right text-[10px] tabular-nums text-muted-foreground sm:block">{formatTime(currentTime)}</span><input type="range" min="0" max={duration || 0} step="0.1" value={Math.min(currentTime, duration || 0)} onChange={(event) => { const value = Number(event.target.value); if (audioRef.current) audioRef.current.currentTime = value; setCurrentTime(value); }} className="player-range" aria-label="Pozice ve skladbě" style={{ "--range-progress": `${progress}%` } as React.CSSProperties} /><span className="w-9 text-[10px] tabular-nums text-muted-foreground">{formatTime(duration)}</span></div></div><div className="flex items-center gap-1 sm:min-w-[190px] sm:justify-end"><button type="button" className="flex size-9 items-center justify-center rounded-full bg-foreground text-background sm:hidden" onClick={() => playTrack(currentTrack.id)} aria-label={isPlaying ? "Pozastavit" : "Přehrát"}>{isPlaying ? <Pause className="size-4 fill-current" /> : <Play className="ml-0.5 size-4 fill-current" />}</button><button type="button" onClick={() => setIsMuted((value) => !value)} className="rounded-lg p-2 text-muted-foreground hover:text-foreground" aria-label={isMuted ? "Zapnout zvuk" : "Ztlumit"}>{isMuted || volume === 0 ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}</button><input type="range" min="0" max="1" step="0.01" value={isMuted ? 0 : volume} onChange={(event) => { setVolume(Number(event.target.value)); setIsMuted(false); }} className="volume-range hidden w-20 sm:block" aria-label="Hlasitost" style={{ "--range-progress": `${(isMuted ? 0 : volume) * 100}%` } as React.CSSProperties} /><button type="button" onClick={() => goToView("library")} className="hidden rounded-lg p-2 text-muted-foreground hover:text-foreground sm:block" aria-label="Skladby"><ListMusic className="size-4" /></button></div></div><div className="absolute left-0 right-0 top-0 h-0.5 overflow-hidden rounded-full"><div className="h-full bg-brand transition-[width]" style={{ width: `${progress}%` }} /></div>
      </div>

      <Dialog
        open={sleepOpen}
        onOpenChange={setSleepOpen}
        title="Časovač spánku"
        description="Hudba po nastaveném čase sama ztichne."
      >
        <div className="flex flex-col gap-2">
          {SLEEP_OPTIONS.map((minutes) => (
            <button
              key={minutes}
              type="button"
              onClick={() => startSleepTimer(minutes)}
              className="flex h-11 items-center gap-3 rounded-lg border px-4 text-sm transition-colors hover:bg-accent"
            >
              <Timer className="size-4 shrink-0 text-muted-foreground" />
              {minutes > 0 ? `Za ${minutes} minut` : "Po dohrání skladby"}
            </button>
          ))}
          {sleepActive ? (
            <button
              type="button"
              onClick={cancelSleepTimer}
              className="mt-1 flex h-11 items-center gap-3 rounded-lg bg-brand px-4 text-sm font-semibold text-black transition-opacity hover:opacity-90"
            >
              <TimerReset className="size-4 shrink-0" />
              {sleepAt !== null ? `Zrušit časovač (${Math.ceil(sleepLeft / 60000)} min)` : "Zrušit časovač"}
            </button>
          ) : null}
        </div>
      </Dialog>

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        addons={addons}
        onAddonChange={handleAddonChange}
        mediaPermission={mediaPermission}
        onRequestMediaAccess={requestMediaAccess}
      />
    </div>
  );
}
