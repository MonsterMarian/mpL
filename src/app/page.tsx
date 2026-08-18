"use client";

import * as React from "react";
import {
  BookOpenText,
  Bookmark,
  BookmarkCheck,
  Check,
  ChevronLeft,
  ChevronRight,
  FileText,
  FileUp,
  Film,
  Library,
  Loader2,
  Pause,
  Play,
  Plus,
  Search,
  Settings,
  SkipBack,
  SkipForward,
  Timer,
  TimerReset,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { SettingsDialog, loadAddons, type AddonId, type Addons } from "@/components/settings-dialog";
import { VideoLibrary } from "@/components/video-library";
import { LibraryView, type Browse, type LibraryTab } from "@/components/music/library-view";
import { NowPlaying } from "@/components/music/now-playing";
import { PlayerDock } from "@/components/music/player-dock";
import { TrackMenu } from "@/components/music/track-menu";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/providers/toast-provider";
import { cn } from "@/lib/utils";
import { MediaLibrary, NativeAudioTrack, canReadDeviceMedia, playableMediaSource } from "@/lib/media-library";
import {
  EMPTY_QUEUE,
  appendToQueue,
  buildQueue,
  dropFromQueue,
  filterTracks,
  formatTime,
  insertNext,
  isSortKey,
  nextTrackId,
  previousTrackId,
  reshuffleQueue,
  sortTracks,
  trackCountLabel,
  upcomingIds,
  type LibraryFilter,
  type PlayStats,
  type Queue,
  type RepeatMode,
  type SortKey,
  type Track,
} from "@/lib/library";
import {
  addToPlaylist,
  createPlaylist,
  deletePlaylist,
  forgetTrack as forgetTrackInPlaylists,
  loadPlaylists,
  removeFromPlaylist,
  renamePlaylist,
  savePlaylists,
  type Playlist,
} from "@/lib/playlists";
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
import { applyPendingUpdate, checkForUpdate, markBootSucceeded } from "@/lib/live-update";
import { clearNowPlaying, onPlaybackCommand, updateNowPlaying } from "@/lib/playback-service";
import { installErrorCapture } from "@/lib/diagnostics";
import { BRAND_MARK } from "@/lib/brand";
import { hideSplash, registerBackButton, syncStatusBar } from "@/lib/native";

type View = "library" | "reader" | "video";

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
    artworkSource: track.artwork ?? null,
    addedAt: track.addedAt ?? 0,
    source: "device",
  };
}

export default function HomePage() {
  const { toast } = useToast();
  const [activeView, setActiveView] = React.useState<View>("library");
  const [tracks, setTracks] = React.useState<Track[]>([]);
  const [currentTrackId, setCurrentTrackId] = React.useState<string | null>(null);
  const [isPlaying, setIsPlaying] = React.useState(false);
  const [currentTime, setCurrentTime] = React.useState(0);
  const [duration, setDuration] = React.useState(0);
  const [isShuffled, setIsShuffled] = React.useState(false);
  const [repeatMode, setRepeatMode] = React.useState<RepeatMode>("off");
  const [query, setQuery] = React.useState("");
  const [libraryFilter, setLibraryFilter] = React.useState<LibraryFilter>("all");
  const [sortKey, setSortKey] = React.useState<SortKey>("added");
  const [liked, setLiked] = React.useState<Set<string>>(new Set());
  /** Statistika poslechu podle id skladby - živí řazení „Nejposlouchanější". */
  const [playStats, setPlayStats] = React.useState<PlayStats>({});
  const [storageReady, setStorageReady] = React.useState(false);
  /**
   * Fronta přehrávání. Vzniká z toho, na co uživatel klepl - ze seznamu,
   * z alba, z playlistu - a dál žije vlastním životem: „přehrát jako další"
   * ji mění, aniž by se pod tím musel měnit seznam na obrazovce.
   */
  const [queue, setQueue] = React.useState<Queue>(EMPTY_QUEUE);
  const [playlists, setPlaylists] = React.useState<Playlist[]>([]);
  /** Skladba přes celou obrazovku - otevírá ji klepnutí na to, co hraje. */
  const [nowPlayingOpen, setNowPlayingOpen] = React.useState(false);
  /** Skladby, kterých se týká otevřená nabídka; prázdné pole = zavřená. */
  const [menuTracks, setMenuTracks] = React.useState<Track[]>([]);
  /** Vybrané skladby pro hromadné akce; `null` = režim výběru neběží. */
  const [selected, setSelected] = React.useState<Set<string> | null>(null);
  const [deleting, setDeleting] = React.useState(false);
  const [libraryTab, setLibraryTab] = React.useState<LibraryTab>("tracks");
  /** Otevřené album, interpret nebo playlist. */
  const [browse, setBrowse] = React.useState<Browse | null>(null);
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
  /**
   * Poslední verze ovladačů. Přes ref, aby se posluchači (MediaSession
   * v prohlížeči, notifikace a zámek v telefonu) registrovali jen jednou
   * a přesto sahali na aktuální stav.
   */
  const controls = React.useRef({
    next: () => {},
    previous: () => {},
    play: () => {},
    pause: () => {},
    seek: (_seconds: number) => {},
  });

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
  const hasTrack = currentTrack.id !== EMPTY_TRACK.id;

  /** Co je vidět v seznamu skladeb - po hledání, filtru a řazení. */
  const visibleTracks = React.useMemo(
    () => sortTracks(filterTracks(tracks, query, libraryFilter, liked), sortKey, playStats),
    [tracks, query, libraryFilter, liked, sortKey, playStats],
  );

  /** Co ve frontě čeká. Skladby, které mezitím ze zařízení zmizely, se přeskočí. */
  const upcoming = React.useMemo(() => {
    const byId = new Map(tracks.map((track) => [track.id, track]));
    return upcomingIds(queue, currentTrackId)
      .map((id) => byId.get(id))
      .filter((track): track is Track => Boolean(track));
  }, [queue, currentTrackId, tracks]);

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
        if (parsed && typeof parsed === "object") setPlayStats(parsed as PlayStats);
      } catch {
        // Rozbitá statistika se zahodí, poslech kvůli ní stát nebude.
      }
    }

    const savedSort = localStorage.getItem("microwins:sort");
    if (isSortKey(savedSort)) setSortKey(savedSort);

    setPlaylists(loadPlaylists());

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

  React.useEffect(() => {
    if (storageReady) savePlaylists(playlists);
  }, [playlists, storageReady]);

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

  /**
   * Dokud hraje hudba, drží appku naživu služba v popředí. Bez ní Android
   * proces na pozadí sestřelí a poslech skončí uprostřed skladby.
   */
  /**
   * Co má systém ukazovat v notifikaci a na zámku. Pozice se čte přímo
   * z přehrávače, ne ze stavu - jinak by se tohle volalo několikrát za vteřinu.
   */
  // Přes ref, ne přes závislost: `currentTrack` je nový objekt při každé změně
  // pole skladeb (třeba když se dopočítá délka), a hlásit systému stav při
  // každém takovém překreslení znamená pokaždé restartovat službu.
  const nowPlayingTrack = React.useRef(currentTrack);
  nowPlayingTrack.current = currentTrack;

  const pushNowPlaying = React.useCallback((playing: boolean) => {
    const track = nowPlayingTrack.current;
    if (track.id === EMPTY_TRACK.id) return;
    void updateNowPlaying({
      title: track.title,
      artist: track.artist,
      album: track.album,
      artwork: track.artworkSource ?? null,
      durationMs: Math.round((audioRef.current?.duration || track.durationSeconds || 0) * 1000),
      positionMs: Math.round((audioRef.current?.currentTime ?? 0) * 1000),
      playing,
    });
  }, []);

  React.useEffect(() => {
    if (!hasTrack) {
      void clearNowPlaying();
      return;
    }
    // Se zpožděním schválně: Android hlídá, že služba naskočí do popředí do
    // pěti vteřin, a rozklepané pauza/přehrát by ji spouštělo a rušilo naráz.
    // Čtvrt vteřiny nikdo nepozná a všechny takové dvojice se srazí do jedné.
    const timer = window.setTimeout(() => pushNowPlaying(isPlaying), 250);
    return () => window.clearTimeout(timer);
  }, [hasTrack, isPlaying, currentTrack.id, pushNowPlaying]);

  React.useEffect(() => () => void clearNowPlaying(), []);

  /** Tlačítka z notifikace, ze zámku a ze sluchátek. */
  React.useEffect(() => {
    return onPlaybackCommand((command) => {
      switch (command.action) {
        case "play":
          controls.current.play();
          break;
        case "pause":
        case "stop":
          controls.current.pause();
          break;
        case "next":
          controls.current.next();
          break;
        case "previous":
          controls.current.previous();
          break;
        case "seek":
          controls.current.seek(command.positionMs / 1000);
          break;
      }
    });
  }, []);

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
      artwork: [{ src: currentTrack.artwork ?? BRAND_MARK, sizes: "192x192", type: "image/png" }],
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
        togglePlayback();
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

  /**
   * Nativní start appky: splash pryč, lišta v barvě appky a živá aktualizace.
   * Nejdřív se nasadí balík stažený minule, teprve pak se kouká po novém -
   * po nasazení se stejně překresluje celé WebView.
   */
  React.useEffect(() => {
    // Odchyt chyb jako první: cokoliv, co spadne pod ním, má být kde přečíst.
    installErrorCapture();
    void hideSplash();
    void syncStatusBar();
    markBootSucceeded();
    void applyPendingUpdate().then((result) => {
      if (!result.applied) void checkForUpdate();
    });
  }, []);

  /**
   * Hardwarové Zpět zavírá to, co je zrovna navrchu. Na knihovně se nechá
   * systém appku ukončit - tak se chová každá Android appka.
   */
  const handleBack = React.useRef<() => boolean>(() => false);
  handleBack.current = () => {
    if (menuTracks.length) {
      setMenuTracks([]);
      return true;
    }
    if (selected) {
      setSelected(null);
      return true;
    }
    if (sleepOpen) {
      setSleepOpen(false);
      return true;
    }
    if (settingsOpen) {
      setSettingsOpen(false);
      return true;
    }
    if (nowPlayingOpen) {
      setNowPlayingOpen(false);
      return true;
    }
    if (browse) {
      setBrowse(null);
      return true;
    }
    if (activeView !== "library") {
      setActiveView("library");
      return true;
    }
    return false;
  };

  React.useEffect(() => {
    let cleanup = () => {};
    void registerBackButton(() => handleBack.current()).then((fn) => {
      cleanup = fn;
    });
    return () => cleanup();
  }, []);

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
    // Hudba a předčítání se v jednom přehrávači nepřekřikují.
    stopReading();
    setCurrentTrackId(trackId);
    setIsPlaying(true);
    setPlayStats((previous) => ({
      ...previous,
      [trackId]: { count: (previous[trackId]?.count ?? 0) + 1, at: Date.now() },
    }));
  };

  const togglePlayback = () => {
    if (!hasTrack) return;
    if (isPlaying) {
      audioRef.current?.pause();
      setIsPlaying(false);
      return;
    }
    stopReading();
    audioRef.current
      ?.play()
      .then(() => setIsPlaying(true))
      .catch(() => {
        toast({ tone: "warn", title: "Skladbu se nepodařilo spustit", description: "Soubor už nemusí být dostupný v zařízení." });
      });
  };

  /**
   * Klepnutí na řádek v seznamu. Cizí skladba se pustí a seznam se stane
   * frontou; ta rozehraná se místo toho otevře přes celou obrazovku - jinak
   * by klepnutí na to, co zrovna hraje, nemělo kam vést.
   */
  const pressTrack = (trackId: string, queueIds: string[]) => {
    if (selected) {
      toggleSelected(trackId);
      return;
    }
    if (trackId === currentTrackId) {
      setNowPlayingOpen(true);
      return;
    }
    setQueue(buildQueue(queueIds, trackId, isShuffled));
    startTrack(trackId);
  };

  /** Přehrát celé album, interpreta nebo playlist. */
  const playCollection = (trackIds: string[], shuffle: boolean) => {
    if (!trackIds.length) return;
    const startId = shuffle ? trackIds[Math.floor(Math.random() * trackIds.length)] : trackIds[0];
    if (shuffle) setIsShuffled(true);
    setQueue(buildQueue(trackIds, startId, shuffle || isShuffled));
    startTrack(startId);
  };

  /**
   * Fronta je prázdná jen do prvního kliknutí - do té doby (a po restartu, kdy
   * se vrací jen poslední skladba) zastoupí seznam na obrazovce. Přes `useMemo`
   * schválně: náhradní frontu při zapnutém náhodném pořadí míchá `buildQueue`
   * a při každém překreslení by vyšla jinak.
   */
  const activeQueue = React.useMemo(
    () => (queue.ids.length ? queue : buildQueue(visibleTracks.map((track) => track.id), currentTrackId ?? "", isShuffled)),
    [queue, visibleTracks, currentTrackId, isShuffled],
  );

  const playNext = () => {
    const next = nextTrackId(activeQueue, currentTrackId, true);
    if (!next) return;
    if (!queue.ids.length) setQueue(activeQueue);
    startTrack(next);
  };

  const playPrevious = () => {
    // Po pár vteřinách znamená „zpět" skok na začátek skladby, ne o skladbu dřív.
    if (audioRef.current && currentTime > 4) {
      audioRef.current.currentTime = 0;
      setCurrentTime(0);
      return;
    }
    const previous = previousTrackId(activeQueue, currentTrackId);
    if (!previous) return;
    if (!queue.ids.length) setQueue(activeQueue);
    startTrack(previous);
  };

  const toggleShuffle = () => {
    const next = !isShuffled;
    setIsShuffled(next);
    setQueue((previous) => reshuffleQueue(previous, currentTrackId, next));
  };

  const seekTo = (seconds: number) => {
    if (audioRef.current) audioRef.current.currentTime = seconds;
    setCurrentTime(seconds);
    // Bez tohohle by pruh na zámku běžel od staré pozice dál.
    pushNowPlaying(isPlaying);
  };

  const skipBy = (seconds: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    seekTo(Math.min(Math.max(0, audio.currentTime + seconds), audio.duration || duration || 0));
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
    // Doběhnutá skladba se ptá opakování: na konci fronty se bez něj končí.
    const next = nextTrackId(activeQueue, currentTrackId, repeatMode === "all");
    if (!next) {
      setIsPlaying(false);
      setCurrentTime(0);
      return;
    }
    if (!queue.ids.length) setQueue(activeQueue);
    startTrack(next);
  };

  controls.current = {
    next: playNext,
    previous: playPrevious,
    play: () => {
      if (!isPlaying) togglePlayback();
    },
    pause: () => {
      if (isPlaying) togglePlayback();
    },
    seek: seekTo,
  };

  // --- fronta, playlisty a mazání --------------------------------------------

  /** Popisek pro hlášku: jedna skladba jménem, víc počtem. */
  const label = (tracks_: Track[]) => (tracks_.length === 1 ? tracks_[0].title : trackCountLabel(tracks_.length));

  const closeMenu = () => {
    setMenuTracks([]);
    setSelected(null);
  };

  const queueAction = (target: Track[], where: "next" | "end") => {
    if (!target.length) return;
    const ids = target.map((track) => track.id);
    setQueue((previous) => {
      const base = previous.ids.length ? previous : activeQueue;
      return where === "next" ? insertNext(base, ids, currentTrackId) : appendToQueue(base, ids, currentTrackId);
    });
    closeMenu();
    toast({
      tone: "info",
      title: where === "next" ? "Zařazeno jako další" : "Přidáno do fronty",
      description: label(target),
    });
  };

  const addTracksToPlaylist = (playlistId: string, target: Track[]) => {
    setPlaylists((previous) => addToPlaylist(previous, playlistId, target.map((track) => track.id)));
    closeMenu();
    const name = playlists.find((playlist) => playlist.id === playlistId)?.name;
    toast({ tone: "win", title: "Přidáno do playlistu", description: name ?? label(target) });
  };

  const createPlaylistWith = (name: string, target: Track[] = []) => {
    setPlaylists((previous) => createPlaylist(previous, name, target.map((track) => track.id)));
    if (target.length) closeMenu();
    toast({ tone: "win", title: "Playlist založen", description: name });
  };

  /** Srdce pro celý výběr: když ho má každý, sundá se všem, jinak se přidá. */
  const toggleLikeAll = (target: Track[]) => {
    const everyLiked = target.every((track) => liked.has(track.id));
    setLiked((previous) => {
      const next = new Set(previous);
      for (const track of target) {
        if (everyLiked) next.delete(track.id);
        else next.add(track.id);
      }
      return next;
    });
    closeMenu();
  };

  const toggleSelected = (trackId: string) => {
    setSelected((previous) => {
      if (!previous) return new Set([trackId]);
      const next = new Set(previous);
      if (next.has(trackId)) next.delete(trackId);
      else next.add(trackId);
      // Prázdný výběr nemá co držet obrazovku - vypne se sám.
      return next.size ? next : null;
    });
  };

  /**
   * Skladba pryč z knihovny.
   *
   * Rozehraná skladba nejdřív předá štafetu další ve frontě - kdyby se jen
   * vymazala, přehrávač by zůstal viset na něčem, co už neexistuje.
   */
  const forgetTrack = (trackId: string) => {
    if (trackId === currentTrackId) {
      const next = nextTrackId(activeQueue, currentTrackId, false);
      if (next) startTrack(next);
      else {
        audioRef.current?.pause();
        setIsPlaying(false);
        setCurrentTrackId(null);
        setNowPlayingOpen(false);
      }
    }
    setTracks((previous) => previous.filter((track) => track.id !== trackId));
    setQueue((previous) => dropFromQueue(previous, trackId));
    setPlaylists((previous) => forgetTrackInPlaylists(previous, trackId));
    setLiked((previous) => {
      if (!previous.has(trackId)) return previous;
      const next = new Set(previous);
      next.delete(trackId);
      return next;
    });
    setPlayStats((previous) => {
      if (!previous[trackId]) return previous;
      const next = { ...previous };
      delete next[trackId];
      return next;
    });
  };

  /**
   * Smazání souboru ze zařízení. Od Androidu 11 se ptá systém vlastním oknem,
   * takže odmítnutí není chyba - skladba prostě zůstane, kde byla.
   */
  const deleteTracks = async (target: Track[]) => {
    if (!target.length) return;
    const deviceIds = canReadDeviceMedia()
      ? target.filter((track) => track.source === "device").map((track) => track.id.replace(/^device-/, ""))
      : [];
    setDeleting(true);
    try {
      if (deviceIds.length) {
        // Všechna id naráz: systém se pak zeptá jednou, ne u každé skladby zvlášť.
        const result = await MediaLibrary.deleteAudio({ ids: deviceIds });
        if (!result?.deleted) {
          toast({ tone: "info", title: "Skladby zůstávají", description: "Mazání nebylo potvrzené." });
          return;
        }
      }
      for (const track of target) forgetTrack(track.id);
      toast({
        tone: "win",
        title: deviceIds.length ? "Smazáno ze zařízení" : "Odebráno z knihovny",
        description: label(target),
      });
    } catch (error) {
      console.error("Skladby se nepodařilo smazat", error);
      toast({ tone: "warn", title: "Smazání selhalo", description: "Soubor se nepodařilo odstranit ze zařízení." });
    } finally {
      setDeleting(false);
      closeMenu();
    }
  };

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
    setQueue(buildQueue(addedTracks.map((track) => track.id), addedTracks[0].id, isShuffled));
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
    { id: "library", label: "Knihovna", icon: Library },
    ...(addons.reader ? [{ id: "reader" as const, label: "Dokumenty", icon: BookOpenText }] : []),
    ...(addons.video ? [{ id: "video" as const, label: "Video", icon: Film }] : []),
  ];

  const sleepActive = sleepAt !== null || sleepAfterTrack;
  const sleepLabel = sleepAt !== null ? `${Math.ceil(sleepLeft / 60000)} min` : sleepAfterTrack ? "do konce" : null;

  // Hlášky musí vědět, jak vysoký je spodní pruh - viz `.mw-above-dock`.
  React.useEffect(() => {
    document.documentElement.dataset.bottomBar = views.length > 1 ? "nav" : "dock";
  }, [views.length]);

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
            {/* eslint-disable-next-line @next/next/no-img-element -- značka je data URI */}
            <img src={BRAND_MARK} alt="" aria-hidden="true" className="size-8 shrink-0" />
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

      <main className={cn("mx-auto w-full max-w-4xl flex-1 px-4 pt-6", views.length > 1 ? "mw-pad-nav" : "mw-pad-dock")}>
        {activeView === "library" ? (
          <LibraryView
            tracks={tracks}
            visibleTracks={visibleTracks}
            liked={liked}
            playStats={playStats}
            currentTrackId={currentTrackId}
            isPlaying={isPlaying}
            query={query}
            onQueryChange={setQuery}
            sortKey={sortKey}
            onSortChange={setSortKey}
            filter={libraryFilter}
            onFilterChange={setLibraryFilter}
            tab={libraryTab}
            onTabChange={setLibraryTab}
            browse={browse}
            onBrowseChange={setBrowse}
            playlists={playlists}
            mediaPermission={mediaPermission}
            isLoadingMedia={isLoadingMedia}
            onRequestMediaAccess={() => void requestMediaAccess()}
            onUpload={handleAudioUpload}
            onPressTrack={pressTrack}
            onToggleTrack={togglePlayback}
            onMenu={(track) => setMenuTracks([track])}
            selected={selected}
            onStartSelection={(trackId) => setSelected(new Set([trackId]))}
            onSelectAll={(trackIds) => setSelected(new Set(trackIds))}
            onEndSelection={() => setSelected(null)}
            onSelectionMenu={() => setMenuTracks(tracks.filter((track) => selected?.has(track.id)))}
            onPlayCollection={playCollection}
            onCreatePlaylist={(name) => createPlaylistWith(name)}
            onRenamePlaylist={(id, name) => setPlaylists((previous) => renamePlaylist(previous, id, name))}
            onDeletePlaylist={(id) => setPlaylists((previous) => deletePlaylist(previous, id))}
            onRemoveFromPlaylist={(playlistId, trackId) =>
              setPlaylists((previous) => removeFromPlaylist(previous, playlistId, trackId))
            }
          />
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

      {/*
        Lišta přehrávače a přepínač sekcí jsou jeden ukotvený pruh, ne dvě věci
        nad sebou: dokud se každá kotvila zvlášť, zbýval mezi nimi vlásek
        pozadí, který při scrolování probleskoval.

        Přepínač se kreslí, jen když je mezi čím přepínat - s vypnutými addony
        zbyde jediné tlačítko a to je jen pruh navíc.
      */}
      <div className="mw-safe-x fixed inset-x-0 bottom-0 z-40 bg-background">
        <PlayerDock
          track={currentTrack}
          hasTrack={hasTrack}
          isPlaying={isPlaying}
          currentTime={currentTime}
          duration={duration}
          shuffle={isShuffled}
          repeat={repeatMode}
          onOpen={() => setNowPlayingOpen(true)}
          onToggle={togglePlayback}
          onNext={playNext}
          onPrevious={playPrevious}
          onSeek={seekTo}
          onShuffle={toggleShuffle}
          onRepeat={() => setRepeatMode((mode) => (mode === "off" ? "all" : mode === "all" ? "one" : "off"))}
        />

        {views.length > 1 ? (
          <nav className="border-t border-white/[0.07] sm:hidden">
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
        ) : null}

        {/* Pruh gest na dně displeje - obsah pod něj nesmí. */}
        <div className="mw-safe-bottom" />
      </div>

      <audio ref={audioRef} src={currentTrack.src || undefined} preload="metadata" loop={repeatMode === "one"} onPlay={() => setIsPlaying(true)} onPause={() => setIsPlaying(false)} onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)} onLoadedMetadata={(event) => { const nextDuration = event.currentTarget.duration; if (Number.isFinite(nextDuration)) { setDuration(nextDuration); setTracks((previous) => previous.map((track) => track.id === currentTrackId ? { ...track, durationSeconds: nextDuration, duration: formatTime(nextDuration) } : track)); } if (pendingSeek.current > 0) { const seekTo = Math.min(pendingSeek.current, nextDuration || pendingSeek.current); pendingSeek.current = 0; event.currentTarget.currentTime = seekTo; setCurrentTime(seekTo); } }} onEnded={handleEnded} onError={() => { if (currentTrack.id !== EMPTY_TRACK.id) toast({ tone: "warn", title: "Audio soubor není dostupný", description: "Zkontroluj, jestli je skladba stále v zařízení." }); }} className="hidden" />

      <NowPlaying
        open={nowPlayingOpen && hasTrack}
        track={currentTrack}
        isPlaying={isPlaying}
        currentTime={currentTime}
        duration={duration}
        liked={liked.has(currentTrack.id)}
        shuffle={isShuffled}
        repeat={repeatMode}
        upcoming={upcoming}
        sleepActive={sleepActive}
        sleepLabel={sleepLabel}
        onClose={() => setNowPlayingOpen(false)}
        onToggle={togglePlayback}
        onNext={playNext}
        onPrevious={playPrevious}
        onSeek={seekTo}
        onSkip={skipBy}
        onLike={() => toggleLike(currentTrack.id)}
        onShuffle={toggleShuffle}
        onRepeat={() => setRepeatMode((mode) => (mode === "off" ? "all" : mode === "all" ? "one" : "off"))}
        onMenu={() => setMenuTracks([currentTrack])}
        onSleep={() => setSleepOpen(true)}
        onPlayFromQueue={(trackId) => startTrack(trackId)}
        onRemoveFromQueue={(trackId) => setQueue((previous) => dropFromQueue(previous, trackId))}
      />

      <TrackMenu
        tracks={menuTracks}
        liked={menuTracks.length > 0 && menuTracks.every((track) => liked.has(track.id))}
        playlists={playlists}
        fromDevice={canReadDeviceMedia() && menuTracks.some((track) => track.source === "device")}
        deleting={deleting}
        canSelect={selected === null && menuTracks.length === 1}
        onClose={() => setMenuTracks([])}
        onPlayNext={() => queueAction(menuTracks, "next")}
        onQueue={() => queueAction(menuTracks, "end")}
        onLike={() => toggleLikeAll(menuTracks)}
        onSelect={() => {
          setSelected(new Set(menuTracks.map((track) => track.id)));
          setMenuTracks([]);
        }}
        onAddToPlaylist={(playlistId) => addTracksToPlaylist(playlistId, menuTracks)}
        onCreatePlaylist={(name) => createPlaylistWith(name, menuTracks)}
        onDelete={() => void deleteTracks(menuTracks)}
      />

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
