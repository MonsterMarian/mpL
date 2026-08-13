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
  Heart,
  Home,
  Library,
  ListMusic,
  Loader2,
  Menu,
  MoreHorizontal,
  Music2,
  Pause,
  Play,
  Plus,
  Repeat2,
  Search,
  Settings2,
  Shuffle,
  SkipBack,
  SkipForward,
  Sparkles,
  Upload,
  Volume2,
  VolumeX,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { SettingsDialog } from "@/components/settings-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/providers/toast-provider";
import { cn } from "@/lib/utils";

type View = "home" | "library" | "reader";
type LibraryFilter = "all" | "liked" | "local";
type RepeatMode = "off" | "all" | "one";

interface Track {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: string;
  durationSeconds: number;
  src: string;
  coverClass: string;
  source: "demo" | "local" | "stream";
}

interface DocumentPage {
  text: string;
  label: string;
}

const DEFAULT_TRACKS: Track[] = [
  {
    id: "afterglow",
    title: "Afterglow",
    artist: "Lena Rowe",
    album: "Soft Focus",
    duration: "3:42",
    durationSeconds: 222,
    src: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
    coverClass: "from-orange-300 via-rose-500 to-violet-950",
    source: "demo",
  },
  {
    id: "neon-rooms",
    title: "Neon Rooms",
    artist: "Hana Bloom",
    album: "Late Signals",
    duration: "4:18",
    durationSeconds: 258,
    src: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3",
    coverClass: "from-cyan-300 via-blue-600 to-indigo-950",
    source: "demo",
  },
  {
    id: "low-tide",
    title: "Low Tide",
    artist: "Noah Vale",
    album: "Drift / Return",
    duration: "2:56",
    durationSeconds: 176,
    src: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3",
    coverClass: "from-emerald-300 via-teal-600 to-slate-950",
    source: "demo",
  },
  {
    id: "slow-motion",
    title: "Slow Motion",
    artist: "Mira K.",
    album: "The Quiet Parts",
    duration: "3:31",
    durationSeconds: 211,
    src: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3",
    coverClass: "from-amber-200 via-orange-600 to-red-950",
    source: "demo",
  },
  {
    id: "orbiting",
    title: "Orbiting",
    artist: "North / South",
    album: "Late Signals",
    duration: "5:02",
    durationSeconds: 302,
    src: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-5.mp3",
    coverClass: "from-fuchsia-300 via-purple-600 to-slate-950",
    source: "demo",
  },
];

function formatTime(value: number) {
  if (!Number.isFinite(value) || value < 0) return "0:00";
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function Cover({ track, className }: { track: Track; className?: string }) {
  return (
    <div
      className={cn(
        "relative shrink-0 overflow-hidden bg-gradient-to-br shadow-lg",
        track.coverClass,
        className,
      )}
      aria-hidden="true"
    >
      <div className="absolute -right-5 -top-5 size-20 rounded-full border border-white/25" />
      <div className="absolute -bottom-7 -left-4 size-24 rounded-full border border-white/20" />
      <div className="absolute bottom-2 left-2 flex items-end gap-0.5 opacity-70">
        <span className="h-3 w-0.5 rounded-full bg-white" />
        <span className="h-5 w-0.5 rounded-full bg-white" />
        <span className="h-2 w-0.5 rounded-full bg-white" />
        <span className="h-4 w-0.5 rounded-full bg-white" />
      </div>
    </div>
  );
}

function Equalizer({ active = false }: { active?: boolean }) {
  return (
    <span className={cn("flex h-4 items-end gap-0.5", active && "equalizer-active")} aria-hidden="true">
      <i className="h-2 w-0.5 rounded-full bg-orange-400" />
      <i className="h-4 w-0.5 rounded-full bg-orange-400" />
      <i className="h-3 w-0.5 rounded-full bg-orange-400" />
      <i className="h-1.5 w-0.5 rounded-full bg-orange-400" />
    </span>
  );
}

function TrackRow({
  track,
  active,
  liked,
  onPlay,
  onLike,
  compact = false,
}: {
  track: Track;
  active: boolean;
  liked: boolean;
  onPlay: () => void;
  onLike: () => void;
  compact?: boolean;
}) {
  return (
    <div className="group flex min-w-0 items-center gap-3 rounded-2xl p-2 transition-colors hover:bg-white/[0.045]">
      <button type="button" onClick={onPlay} className="relative shrink-0" aria-label={`Přehrát ${track.title}`}>
        <Cover track={track} className={compact ? "size-10 rounded-lg" : "size-12 rounded-xl"} />
        <span className={cn("absolute inset-0 flex items-center justify-center rounded-xl bg-black/45 text-white transition-opacity", active ? "opacity-100" : "opacity-0 group-hover:opacity-100")}>
          {active ? <Pause className="size-4 fill-current" /> : <Play className="size-4 fill-current" />}
        </span>
      </button>
      <button type="button" onClick={onPlay} className="min-w-0 flex-1 text-left">
        <span className="flex min-w-0 items-center gap-2">
          <span className={cn("truncate text-sm font-medium", active && "text-orange-300")}>{track.title}</span>
          {active ? <Equalizer active /> : null}
        </span>
        <span className="block truncate text-xs text-muted-foreground">{track.artist} <span className="mx-1 opacity-40">/</span> {track.album}</span>
      </button>
      {!compact ? <span className="hidden text-xs tabular-nums text-muted-foreground sm:block">{track.duration}</span> : null}
      <button
        type="button"
        onClick={onLike}
        className={cn("rounded-lg p-2 text-muted-foreground transition-colors hover:bg-white/10 hover:text-orange-300", liked && "text-orange-400")}
        aria-label={liked ? "Odebrat z oblíbených" : "Přidat do oblíbených"}
      >
        <Heart className={cn("size-4", liked && "fill-current")} />
      </button>
      {!compact ? <button type="button" className="hidden rounded-lg p-2 text-muted-foreground hover:bg-white/10 hover:text-foreground sm:block" aria-label="Další možnosti"><MoreHorizontal className="size-4" /></button> : null}
    </div>
  );
}

export default function HomePage() {
  const { toast } = useToast();
  const [activeView, setActiveView] = React.useState<View>("home");
  const [tracks, setTracks] = React.useState<Track[]>(DEFAULT_TRACKS);
  const [currentTrackId, setCurrentTrackId] = React.useState(DEFAULT_TRACKS[0].id);
  const [isPlaying, setIsPlaying] = React.useState(false);
  const [currentTime, setCurrentTime] = React.useState(0);
  const [duration, setDuration] = React.useState(DEFAULT_TRACKS[0].durationSeconds);
  const [volume, setVolume] = React.useState(0.78);
  const [isMuted, setIsMuted] = React.useState(false);
  const [isShuffled, setIsShuffled] = React.useState(false);
  const [repeatMode, setRepeatMode] = React.useState<RepeatMode>("off");
  const [query, setQuery] = React.useState("");
  const [libraryFilter, setLibraryFilter] = React.useState<LibraryFilter>("all");
  const [liked, setLiked] = React.useState<Set<string>>(new Set());
  const [storageReady, setStorageReady] = React.useState(false);
  const [readerAddon, setReaderAddon] = React.useState(true);
  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const localObjectUrls = React.useRef<string[]>([]);

  const [documentName, setDocumentName] = React.useState<string | null>(null);
  const [documentPages, setDocumentPages] = React.useState<DocumentPage[]>([]);
  const [documentPage, setDocumentPage] = React.useState(0);
  const [documentQuery, setDocumentQuery] = React.useState("");
  const [documentZoom, setDocumentZoom] = React.useState(100);
  const [documentBookmarks, setDocumentBookmarks] = React.useState<number[]>([]);
  const [isLoadingDocument, setIsLoadingDocument] = React.useState(false);
  const [isReadingDocument, setIsReadingDocument] = React.useState(false);
  const [documentError, setDocumentError] = React.useState<string | null>(null);

  const currentTrack = tracks.find((track) => track.id === currentTrackId) ?? tracks[0];
  const activeDocument = documentPages[documentPage];

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
    const savedAudioUrl = localStorage.getItem("microwins:audio_url")?.trim();
    const savedAutoPlay = localStorage.getItem("microwins:audio_autoplay") === "true";
    if (savedAudioUrl) {
      const streamTrack: Track = {
        id: "settings-stream",
        title: "Vlastní stream",
        artist: "Stream z Nastavení",
        album: "Živý zdroj",
        duration: "--:--",
        durationSeconds: 0,
        src: savedAudioUrl,
        coverClass: "from-orange-300 via-red-500 to-purple-950",
        source: "stream",
      };
      setTracks((previous) => [streamTrack, ...previous.filter((track) => track.id !== streamTrack.id)]);
      setCurrentTrackId(streamTrack.id);
      setIsPlaying(savedAutoPlay);
    }
    setReaderAddon(localStorage.getItem("microwins:reader_addon") !== "false");
    setStorageReady(true);
  }, []);

  React.useEffect(() => {
    if (storageReady) localStorage.setItem("microwins:liked_tracks", JSON.stringify([...liked]));
  }, [liked, storageReady]);

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

  React.useEffect(() => {
    if (audioRef.current) audioRef.current.volume = isMuted ? 0 : volume;
  }, [volume, isMuted]);

  React.useEffect(() => {
    return () => {
      localObjectUrls.current.forEach((url) => URL.revokeObjectURL(url));
      window.speechSynthesis?.cancel();
    };
  }, []);

  const toggleLike = (trackId: string) => {
    setLiked((previous) => {
      const next = new Set(previous);
      if (next.has(trackId)) next.delete(trackId);
      else next.add(trackId);
      return next;
    });
  };

  const playTrack = (trackId: string) => {
    if (trackId === currentTrackId) {
      if (isPlaying) {
        audioRef.current?.pause();
        setIsPlaying(false);
      } else {
        audioRef.current?.play().then(() => setIsPlaying(true)).catch(() => {
          toast({ tone: "warn", title: "Skladbu se nepodařilo spustit", description: "Zkontroluj připojení nebo vyber vlastní soubor." });
        });
      }
      return;
    }
    setCurrentTrackId(trackId);
    setIsPlaying(true);
  };

  const playNext = () => {
    if (!tracks.length) return;
    const index = tracks.findIndex((track) => track.id === currentTrackId);
    const nextIndex = isShuffled ? Math.floor(Math.random() * tracks.length) : (index + 1) % tracks.length;
    setCurrentTrackId(tracks[nextIndex].id);
    setIsPlaying(true);
  };

  const playPrevious = () => {
    if (audioRef.current && currentTime > 4) {
      audioRef.current.currentTime = 0;
      setCurrentTime(0);
      return;
    }
    const index = tracks.findIndex((track) => track.id === currentTrackId);
    setCurrentTrackId(tracks[(index - 1 + tracks.length) % tracks.length].id);
    setIsPlaying(true);
  };

  const handleEnded = () => {
    if (repeatMode === "one") {
      if (audioRef.current) {
        audioRef.current.currentTime = 0;
        audioRef.current.play().catch(() => setIsPlaying(false));
      }
      return;
    }
    if (repeatMode === "off" && tracks.findIndex((track) => track.id === currentTrackId) === tracks.length - 1) {
      setIsPlaying(false);
      setCurrentTime(0);
      return;
    }
    playNext();
  };

  const handleAudioUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (!files.length) return;
    const addedTracks = files.map((file, index) => {
      const url = URL.createObjectURL(file);
      localObjectUrls.current.push(url);
      const palettes = ["from-orange-300 via-red-500 to-purple-950", "from-sky-300 via-blue-600 to-indigo-950", "from-lime-300 via-emerald-600 to-teal-950", "from-yellow-200 via-amber-600 to-orange-950"];
      return {
        id: `local-${Date.now()}-${index}`,
        title: file.name.replace(/\.[^/.]+$/, ""),
        artist: "Místní soubor",
        album: "Moje zařízení",
        duration: "--:--",
        durationSeconds: 0,
        src: url,
        coverClass: palettes[index % palettes.length],
        source: "local" as const,
      };
    });
    setTracks((previous) => [...addedTracks, ...previous]);
    setCurrentTrackId(addedTracks[0].id);
    setIsPlaying(true);
    toast({ tone: "win", title: `${addedTracks.length} ${addedTracks.length === 1 ? "skladba přidána" : "skladby přidány"}`, description: "Najdeš je v knihovně." });
    event.target.value = "";
  };

  const handleAudioSettingsChange = (url: string, autoPlay: boolean) => {
    if (!url) {
      setTracks((previous) => previous.filter((track) => track.id !== "settings-stream"));
      if (currentTrackId === "settings-stream") {
        setCurrentTrackId(DEFAULT_TRACKS[0].id);
        setIsPlaying(false);
      }
      return;
    }
    const streamTrack: Track = {
      id: "settings-stream",
      title: "Vlastní stream",
      artist: "Stream z Nastavení",
      album: "Živý zdroj",
      duration: "--:--",
      durationSeconds: 0,
      src: url,
      coverClass: "from-orange-300 via-red-500 to-purple-950",
      source: "stream",
    };
    setTracks((previous) => [streamTrack, ...previous.filter((track) => track.id !== streamTrack.id)]);
    setCurrentTrackId(streamTrack.id);
    setIsPlaying(autoPlay);
  };

  const handleDocumentUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setIsLoadingDocument(true);
    setDocumentError(null);
    setDocumentName(file.name);
    setDocumentPage(0);
    setDocumentBookmarks([]);
    try {
      let pages: DocumentPage[] = [];
      if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
        const pdfjsLib = await import("pdfjs-dist");
        pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
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
          pages.push({ text: text || "Tato stránka neobsahuje strojově čitelný text.", label: `Strana ${index}` });
        }
      } else {
        const rawText = await file.text();
        const pageSize = 3000;
        for (let index = 0; index < rawText.length; index += pageSize) {
          pages.push({ text: rawText.slice(index, index + pageSize).trim(), label: `Část ${pages.length + 1}` });
        }
      }
      if (!pages.length || !pages.some((page) => page.text)) throw new Error("Dokument neobsahuje čitelný text.");
      setDocumentPages(pages);
      toast({ tone: "win", title: "Dokument je připravený", description: `${pages.length} ${pages.length === 1 ? "stránka" : "stránky"} pro čtení offline.` });
    } catch (error) {
      console.error("Chyba při načítání dokumentu", error);
      setDocumentPages([]);
      setDocumentName(null);
      setDocumentError("Dokument se nepodařilo načíst. Zkus PDF s textovou vrstvou nebo TXT soubor.");
    } finally {
      setIsLoadingDocument(false);
      event.target.value = "";
    }
  };

  const stopDocumentReading = async () => {
    window.speechSynthesis?.cancel();
    setIsReadingDocument(false);
    try {
      const { TextToSpeech } = await import("@capacitor-community/text-to-speech");
      await TextToSpeech.stop();
    } catch {
      // The browser fallback does not expose the Capacitor plugin.
    }
  };

  const toggleDocumentReading = async () => {
    if (isReadingDocument) {
      await stopDocumentReading();
      return;
    }
    if (!activeDocument?.text) return;
    setIsReadingDocument(true);
    try {
      const { TextToSpeech } = await import("@capacitor-community/text-to-speech");
      await TextToSpeech.speak({ text: activeDocument.text, lang: "cs-CZ", rate: 1, pitch: 1, volume: 1 });
      setIsReadingDocument(false);
    } catch {
      if ("speechSynthesis" in window) {
        const utterance = new SpeechSynthesisUtterance(activeDocument.text);
        utterance.lang = "cs-CZ";
        utterance.rate = 0.95;
        utterance.onend = () => setIsReadingDocument(false);
        utterance.onerror = () => setIsReadingDocument(false);
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utterance);
      } else {
        setIsReadingDocument(false);
        toast({ tone: "warn", title: "Čtení nahlas není dostupné", description: "Zařízení nemá nainstalovaný hlasový modul." });
      }
    }
  };

  const toggleBookmark = () => {
    setDocumentBookmarks((previous) => previous.includes(documentPage) ? previous.filter((page) => page !== documentPage) : [...previous, documentPage]);
  };

  const handleAddonChange = (enabled: boolean) => {
    setReaderAddon(enabled);
    if (!enabled && activeView === "reader") setActiveView("home");
  };

  const visibleTracks = tracks.filter((track) => {
    const matchesQuery = !query || `${track.title} ${track.artist} ${track.album}`.toLowerCase().includes(query.toLowerCase());
    const matchesFilter = libraryFilter === "all" || (libraryFilter === "liked" ? liked.has(track.id) : track.source === "local");
    return matchesQuery && matchesFilter;
  });
  const progress = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;

  const goToView = (view: View) => {
    if (view === "reader" && !readerAddon) return;
    setActiveView(view);
  };

  const renderDocumentText = (text: string) => {
    if (!documentQuery) return text;
    const escaped = documentQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return text.split(new RegExp(`(${escaped})`, "ig")).map((part, index) => part.toLowerCase() === documentQuery.toLowerCase() ? <mark key={index} className="rounded bg-orange-400/35 px-0.5 text-inherit">{part}</mark> : part);
  };

  return (
    <div className="app-shell min-h-screen text-foreground">
      <div className="mx-auto flex min-h-screen max-w-[1540px]">
        <aside className="hidden w-64 shrink-0 flex-col border-r border-white/[0.07] px-5 py-7 lg:flex">
          <div className="flex items-center gap-3 px-2">
            <div className="brand-mark"><span /></div>
            <div>
              <div className="font-black tracking-[0.22em] text-foreground">SONORA</div>
              <div className="text-[9px] uppercase tracking-[0.2em] text-muted-foreground">quietly yours</div>
            </div>
          </div>

          <div className="mt-12 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Procházet</div>
          <nav className="mt-3 space-y-1">
            {[
              { id: "home" as const, label: "Přehled", icon: Home },
              { id: "library" as const, label: "Knihovna", icon: Library },
              ...(readerAddon ? [{ id: "reader" as const, label: "Dokumenty", icon: BookOpenText }] : []),
            ].map((item) => {
              const Icon = item.icon;
              const active = activeView === item.id;
              return (
                <button key={item.id} type="button" onClick={() => goToView(item.id)} className={cn("sidebar-link", active && "sidebar-link-active")}>
                  <Icon className="size-[18px]" />
                  {item.label}
                  {item.id === "reader" && documentName ? <span className="ml-auto size-1.5 rounded-full bg-orange-400" /> : null}
                </button>
              );
            })}
          </nav>

          <div className="mt-10 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Tvoje hudba</div>
          <nav className="mt-3 space-y-1">
            <button type="button" onClick={() => { setLibraryFilter("liked"); goToView("library"); }} className={cn("sidebar-link", activeView === "library" && libraryFilter === "liked" && "sidebar-link-active")}><Heart className="size-[18px]" /> Oblíbené <span className="ml-auto text-xs text-muted-foreground">{liked.size}</span></button>
            <button type="button" onClick={() => { setLibraryFilter("local"); goToView("library"); }} className={cn("sidebar-link", activeView === "library" && libraryFilter === "local" && "sidebar-link-active")}><ListMusic className="size-[18px]" /> Moje soubory</button>
          </nav>

          <div className="mt-auto space-y-2">
            <div className="mb-6 rounded-2xl border border-orange-400/15 bg-orange-400/[0.06] p-4">
              <div className="mb-3 flex size-8 items-center justify-center rounded-xl bg-orange-400/15 text-orange-300"><Sparkles className="size-4" /></div>
              <p className="text-sm font-semibold">Hudba bez šumu.</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Tvoje knihovna. Tvoje tempo. Všechno lokálně.</p>
            </div>
            <SettingsDialog
              addonEnabled={readerAddon}
              onAddonEnabledChange={handleAddonChange}
              onAudioSettingsChange={handleAudioSettingsChange}
              trigger={<button type="button" className="sidebar-link w-full"><Settings2 className="size-[18px]" /> Nastavení</button>}
            />
            <div className="px-3 pt-2 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Sonora 1.4.0 · offline ready</div>
          </div>
        </aside>

        <main className="min-w-0 flex-1 pb-32">
          <header className="flex items-center justify-between px-5 pb-2 pt-6 sm:px-8 lg:hidden">
            <button type="button" onClick={() => goToView("home")} className="flex items-center gap-2">
              <div className="brand-mark brand-mark-small"><span /></div>
              <span className="text-sm font-black tracking-[0.2em]">SONORA</span>
            </button>
            <div className="flex items-center gap-1">
              <button type="button" className="rounded-xl p-2.5 text-muted-foreground hover:bg-white/10" onClick={() => setQuery("")} aria-label="Menu"><Menu className="size-5" /></button>
              <SettingsDialog
                addonEnabled={readerAddon}
                onAddonEnabledChange={handleAddonChange}
                onAudioSettingsChange={handleAudioSettingsChange}
                trigger={<button type="button" className="rounded-xl p-2.5 text-muted-foreground hover:bg-white/10" aria-label="Nastavení"><Settings2 className="size-5" /></button>}
              />
            </div>
          </header>

          <div className="mx-auto max-w-[1240px] px-5 pt-8 sm:px-8 lg:px-10 lg:pt-12">
            {activeView === "home" ? (
              <>
                <div className="mb-8 flex flex-col justify-between gap-5 md:flex-row md:items-end">
                  <div>
                    <p className="mb-3 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-orange-300"><span className="size-1.5 rounded-full bg-orange-400" /> Čtvrtek · 13. srpna</p>
                    <h1 className="max-w-xl text-3xl font-semibold tracking-[-0.04em] text-balance sm:text-4xl lg:text-[2.9rem]">Dobrý večer.<br /><span className="text-muted-foreground">Co dnes zní?</span></h1>
                  </div>
                  <div className="relative w-full md:max-w-[280px]">
                    <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input value={query} onChange={(event) => { setQuery(event.target.value); if (event.target.value) goToView("library"); }} placeholder="Hledat v knihovně" className="h-11 rounded-2xl border-white/10 bg-white/[0.045] pl-10 pr-4" />
                  </div>
                </div>

                <section className="hero-card relative overflow-hidden rounded-[1.75rem] border border-white/10 p-6 sm:p-8 lg:p-10">
                  <div className="pointer-events-none absolute -right-24 -top-40 size-[30rem] rounded-full bg-orange-500/20 blur-3xl" />
                  <div className="pointer-events-none absolute -bottom-44 left-1/3 size-[25rem] rounded-full bg-fuchsia-600/15 blur-3xl" />
                  <div className="relative flex flex-col gap-7 md:flex-row md:items-end md:justify-between">
                    <div className="max-w-lg">
                      <div className="mb-6 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-orange-200/80"><Music2 className="size-3.5" /> Právě hraješ</div>
                      <div className="flex items-center gap-5">
                        <Cover track={currentTrack} className="size-20 rounded-2xl shadow-2xl sm:size-24" />
                        <div className="min-w-0">
                          <h2 className="truncate text-2xl font-semibold tracking-[-0.04em] sm:text-3xl">{currentTrack.title}</h2>
                          <p className="mt-1 text-sm text-white/60">{currentTrack.artist} <span className="mx-1 text-white/30">·</span> {currentTrack.album}</p>
                        </div>
                      </div>
                      <div className="mt-8 flex items-center gap-4">
                        <button type="button" onClick={() => playTrack(currentTrack.id)} className="flex size-12 items-center justify-center rounded-full bg-white text-slate-950 shadow-xl transition-transform hover:scale-105" aria-label={isPlaying ? "Pozastavit" : "Přehrát"}>{isPlaying ? <Pause className="size-5 fill-current" /> : <Play className="ml-0.5 size-5 fill-current" />}</button>
                        <div className="flex items-end gap-1 opacity-75">
                          {[14, 23, 10, 30, 18, 26, 13, 33, 19, 28, 11, 24, 17, 31, 14, 22, 10, 27].map((height, index) => <span key={index} className="w-1 rounded-full bg-white/75" style={{ height }} />)}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-end gap-8 md:pr-4">
                      <div><p className="text-3xl font-semibold tracking-[-0.05em]">3h 42</p><p className="mt-1 text-[10px] uppercase tracking-[0.16em] text-white/50">poslechu tento týden</p></div>
                      <div className="hidden text-right sm:block"><p className="text-3xl font-semibold tracking-[-0.05em]">24</p><p className="mt-1 text-[10px] uppercase tracking-[0.16em] text-white/50">uložených skladeb</p></div>
                    </div>
                  </div>
                </section>

                <div className="mt-10 grid gap-10 xl:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.65fr)]">
                  <section>
                    <div className="mb-4 flex items-center justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-orange-300">Tvoje tempo</p><h2 className="mt-1 text-xl font-semibold tracking-[-0.03em]">Pokračovat v poslechu</h2></div><button type="button" className="text-xs font-medium text-muted-foreground hover:text-foreground" onClick={() => goToView("library")}>Zobrazit vše <ChevronRight className="ml-1 inline size-3.5" /></button></div>
                    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-2 sm:p-3">
                      {tracks.slice(0, 4).map((track) => <TrackRow key={track.id} track={track} active={track.id === currentTrackId && isPlaying} liked={liked.has(track.id)} onPlay={() => playTrack(track.id)} onLike={() => toggleLike(track.id)} />)}
                    </div>
                  </section>

                  <section>
                    <div className="mb-4 flex items-center justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-orange-300">Kurátor dne</p><h2 className="mt-1 text-xl font-semibold tracking-[-0.03em]">Pozdní světla</h2></div><Sparkles className="size-4 text-orange-300" /></div>
                    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-5">
                      <div className="flex items-center gap-4"><div className="relative flex size-16 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-orange-300 via-fuchsia-500 to-indigo-950"><div className="size-7 rounded-full border-2 border-white/70" /><div className="absolute h-10 w-px rotate-45 bg-white/50" /></div><div><p className="font-medium">Večer v pohybu</p><p className="mt-1 text-xs text-muted-foreground">12 skladeb · 48 min</p></div></div>
                      <p className="mt-6 text-sm leading-relaxed text-muted-foreground">Měkké synťáky, pomalé basy a přesně tolik světla, kolik potřebuješ.</p>
                      <button type="button" onClick={() => playTrack(tracks[1]?.id ?? currentTrack.id)} className="mt-6 flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-orange-500 text-sm font-semibold text-white transition-colors hover:bg-orange-400"><Play className="size-4 fill-current" /> Přehrát mix</button>
                    </div>
                  </section>
                </div>

                <section className="mt-10"><div className="mb-4 flex items-end justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-orange-300">Z knihovny</p><h2 className="mt-1 text-xl font-semibold tracking-[-0.03em]">Naposledy přidané</h2></div><button type="button" onClick={() => { setLibraryFilter("all"); goToView("library"); }} className="text-xs text-muted-foreground hover:text-foreground">Knihovna <ChevronRight className="ml-1 inline size-3.5" /></button></div><div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{tracks.slice(0, 4).map((track) => <button key={track.id} type="button" onClick={() => playTrack(track.id)} className="group min-w-0 text-left"><div className="relative"><Cover track={track} className="aspect-square w-full rounded-2xl transition-transform duration-300 group-hover:-translate-y-1" /><span className="absolute bottom-2 right-2 flex size-9 translate-y-1 items-center justify-center rounded-full bg-orange-500 text-white opacity-0 shadow-lg transition-all group-hover:translate-y-0 group-hover:opacity-100"><Play className="size-4 fill-current" /></span></div><p className="mt-3 truncate text-sm font-medium">{track.title}</p><p className="mt-1 truncate text-xs text-muted-foreground">{track.artist}</p></button>)}</div></section>
              </>
            ) : null}

            {activeView === "library" ? (
              <section className="animate-in-up">
                <div className="mb-8 flex flex-col justify-between gap-5 sm:flex-row sm:items-end"><div><p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-orange-300">Tvoje kolekce</p><h1 className="text-4xl font-semibold tracking-[-0.05em]">Knihovna</h1><p className="mt-2 text-sm text-muted-foreground">{tracks.length} skladeb · připraveno k poslechu offline</p></div><label className="flex h-11 cursor-pointer items-center justify-center gap-2 rounded-2xl bg-orange-500 px-4 text-sm font-semibold text-white transition-colors hover:bg-orange-400"><Upload className="size-4" /> Přidat hudbu<input type="file" accept="audio/*" multiple onChange={handleAudioUpload} className="hidden" /></label></div>
                <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="flex gap-1 rounded-xl bg-white/[0.04] p-1">{(["all", "liked", "local"] as const).map((filter) => <button key={filter} type="button" onClick={() => setLibraryFilter(filter)} className={cn("rounded-lg px-3 py-1.5 text-xs font-medium transition-colors", libraryFilter === filter ? "bg-white/10 text-foreground" : "text-muted-foreground hover:text-foreground")}>{filter === "all" ? "Vše" : filter === "liked" ? "Oblíbené" : "Moje soubory"}</button>)}</div><div className="relative sm:w-64"><Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Hledat skladbu nebo interpreta" className="h-9 rounded-xl border-white/10 bg-white/[0.04] pl-9 text-xs" /></div></div>
                {visibleTracks.length ? <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-2 sm:p-3">{visibleTracks.map((track) => <TrackRow key={track.id} track={track} active={track.id === currentTrackId && isPlaying} liked={liked.has(track.id)} onPlay={() => playTrack(track.id)} onLike={() => toggleLike(track.id)} />)}</div> : <div className="flex min-h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 text-center"><div className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-white/[0.05] text-muted-foreground"><Heart className="size-5" /></div><p className="font-medium">Tady je zatím ticho.</p><p className="mt-1 text-sm text-muted-foreground">Zkus změnit filtr nebo přidat vlastní hudbu.</p></div>}
                <div className="mt-8 grid gap-3 sm:grid-cols-3"><div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4"><p className="text-2xl font-semibold">{tracks.length}</p><p className="mt-1 text-xs text-muted-foreground">celkem skladeb</p></div><div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4"><p className="text-2xl font-semibold">{liked.size}</p><p className="mt-1 text-xs text-muted-foreground">v oblíbených</p></div><div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4"><p className="text-2xl font-semibold">{tracks.filter((track) => track.source === "local").length}</p><p className="mt-1 text-xs text-muted-foreground">z tvého zařízení</p></div></div>
              </section>
            ) : null}

            {activeView === "reader" && readerAddon ? (
              <section className="animate-in-up">
                <div className="mb-8 flex flex-col justify-between gap-5 sm:flex-row sm:items-end"><div><p className="mb-3 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-orange-300"><BookOpenText className="size-3.5" /> Addon · offline čtení</p><h1 className="text-4xl font-semibold tracking-[-0.05em]">Dokumenty</h1><p className="mt-2 max-w-lg text-sm text-muted-foreground">Nahraj PDF nebo text a čti bez rozptylování. Pro dlouhé cesty může Sonora text i předčítat.</p></div><label className="flex h-11 cursor-pointer items-center justify-center gap-2 rounded-2xl bg-orange-500 px-4 text-sm font-semibold text-white transition-colors hover:bg-orange-400"><FileUp className="size-4" /> Otevřít dokument<input type="file" accept=".pdf,.txt,.md,.text,application/pdf,text/plain,text/markdown" onChange={handleDocumentUpload} className="hidden" /></label></div>
                {!documentName ? <div className="reader-empty rounded-[1.75rem] border border-dashed border-orange-300/20 p-8 text-center sm:p-16"><div className="mx-auto flex size-16 items-center justify-center rounded-3xl bg-orange-400/10 text-orange-300"><BookOpenText className="size-7" /></div><h2 className="mt-5 text-xl font-semibold">Tvoje klidná čítárna</h2><p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">Nahraj první dokument. Zůstane jen v tomto zařízení, bez účtu a bez cloudu.</p><label className="mx-auto mt-6 flex h-10 w-fit cursor-pointer items-center gap-2 rounded-xl border border-white/10 bg-white/[0.06] px-4 text-sm font-medium hover:bg-white/10"><Plus className="size-4" /> Vybrat soubor<input type="file" accept=".pdf,.txt,.md,.text,application/pdf,text/plain,text/markdown" onChange={handleDocumentUpload} className="hidden" /></label><div className="mx-auto mt-8 flex max-w-md items-center justify-center gap-5 text-[10px] uppercase tracking-[0.14em] text-muted-foreground"><span><Check className="mr-1 inline size-3 text-orange-300" /> lokálně</span><span><Check className="mr-1 inline size-3 text-orange-300" /> bez účtu</span><span><Check className="mr-1 inline size-3 text-orange-300" /> PDF / TXT</span></div></div> : <div className="grid gap-5 xl:grid-cols-[210px_minmax(0,1fr)]"><aside className="order-2 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-3 xl:order-1"><div className="flex items-start justify-between gap-3 px-2 pb-3"><div className="min-w-0"><p className="truncate text-sm font-medium">{documentName}</p><p className="mt-1 text-xs text-muted-foreground">{documentPages.length} {documentPages.length === 1 ? "stránka" : "stránek"}</p></div><FileText className="size-4 shrink-0 text-orange-300" /></div><div className="space-y-1 border-t border-white/[0.07] pt-3">{documentPages.map((page, index) => <button key={index} type="button" onClick={() => setDocumentPage(index)} className={cn("flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-xs transition-colors", index === documentPage ? "bg-orange-500/15 text-orange-200" : "text-muted-foreground hover:bg-white/[0.05] hover:text-foreground")}><span className="w-5 text-[10px] tabular-nums opacity-60">{String(index + 1).padStart(2, "0")}</span><span className="truncate">{page.label}</span>{documentBookmarks.includes(index) ? <BookmarkCheck className="ml-auto size-3 shrink-0 text-orange-300" /> : null}</button>)}</div></aside><div className="order-1 min-w-0 xl:order-2"><div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="flex min-w-0 items-center gap-2"><FileText className="size-4 shrink-0 text-orange-300" /><span className="truncate text-sm font-medium">{documentName}</span><span className="hidden rounded-md bg-white/[0.06] px-2 py-1 text-[10px] text-muted-foreground sm:block">{activeDocument?.label}</span></div><div className="relative sm:w-56"><Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" /><Input value={documentQuery} onChange={(event) => setDocumentQuery(event.target.value)} placeholder="Hledat v dokumentu" className="h-9 rounded-xl border-white/10 bg-white/[0.04] pl-9 text-xs" /></div></div><div className="reader-toolbar flex flex-wrap items-center justify-between gap-2 rounded-t-2xl border border-white/[0.08] bg-white/[0.045] px-3 py-2"><div className="flex items-center gap-1"><button type="button" className="reader-tool" onClick={() => setDocumentZoom((value) => Math.max(75, value - 10))} aria-label="Zmenšit"><ZoomOut className="size-4" /></button><span className="w-12 text-center text-xs tabular-nums text-muted-foreground">{documentZoom}%</span><button type="button" className="reader-tool" onClick={() => setDocumentZoom((value) => Math.min(140, value + 10))} aria-label="Zvětšit"><ZoomIn className="size-4" /></button></div><div className="flex items-center gap-1"><button type="button" className={cn("reader-tool", documentBookmarks.includes(documentPage) && "text-orange-300")} onClick={toggleBookmark} aria-label="Záložka">{documentBookmarks.includes(documentPage) ? <BookmarkCheck className="size-4" /> : <Bookmark className="size-4" />}</button><button type="button" onClick={toggleDocumentReading} className={cn("flex h-8 items-center gap-2 rounded-lg px-3 text-xs font-medium transition-colors", isReadingDocument ? "bg-orange-500 text-white" : "hover:bg-white/10")}><Volume2 className="size-3.5" /> {isReadingDocument ? "Zastavit čtení" : "Číst nahlas"}</button></div></div><div className="reader-paper min-h-[520px] overflow-auto rounded-b-2xl border-x border-b border-white/[0.08] p-6 shadow-2xl sm:p-12"><article className="mx-auto max-w-2xl origin-top transition-transform" style={{ transform: `scale(${documentZoom / 100})`, transformOrigin: "top center", marginBottom: `${(documentZoom - 100) * 3}px` }}><p className="mb-8 text-xs font-semibold uppercase tracking-[0.18em] text-orange-700/70">{activeDocument?.label}</p><div className="whitespace-pre-wrap font-serif text-[1.04rem] leading-[1.9] text-slate-800">{activeDocument ? renderDocumentText(activeDocument.text) : ""}</div></article></div><div className="mt-4 flex items-center justify-between"><button type="button" disabled={documentPage === 0} onClick={() => setDocumentPage((page) => Math.max(0, page - 1))} className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs text-muted-foreground hover:bg-white/[0.05] hover:text-foreground disabled:opacity-30"><ChevronLeft className="size-4" /> Předchozí</button><span className="text-xs tabular-nums text-muted-foreground">{documentPage + 1} / {documentPages.length}</span><button type="button" disabled={documentPage === documentPages.length - 1} onClick={() => setDocumentPage((page) => Math.min(documentPages.length - 1, page + 1))} className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs text-muted-foreground hover:bg-white/[0.05] hover:text-foreground disabled:opacity-30">Další <ChevronRight className="size-4" /></button></div></div></div>}
                {isLoadingDocument ? <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/35 backdrop-blur-sm"><div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-card px-5 py-4 text-sm shadow-xl"><Loader2 className="size-4 animate-spin text-orange-300" /> Zpracovávám dokument…</div></div> : null}
                {documentError ? <div className="mt-4 flex items-center gap-2 rounded-xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-xs text-red-200"><X className="size-4" /> {documentError}</div> : null}
              </section>
            ) : null}
          </div>
        </main>
      </div>

      <audio ref={audioRef} src={currentTrack?.src} preload="metadata" loop={repeatMode === "one"} onPlay={() => setIsPlaying(true)} onPause={() => setIsPlaying(false)} onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)} onLoadedMetadata={(event) => { const nextDuration = event.currentTarget.duration; if (Number.isFinite(nextDuration)) { setDuration(nextDuration); setTracks((previous) => previous.map((track) => track.id === currentTrackId ? { ...track, durationSeconds: nextDuration, duration: formatTime(nextDuration) } : track)); } }} onEnded={handleEnded} onError={() => toast({ tone: "warn", title: "Audio zdroj není dostupný", description: "Nahraj vlastní soubor nebo nastav nový stream v Nastavení." })} className="hidden" />

      <div className="player-dock fixed inset-x-3 bottom-3 z-30 mx-auto max-w-[1170px] rounded-2xl border border-white/[0.11] bg-[#1e1d22]/[0.94] shadow-2xl shadow-black/30 backdrop-blur-xl sm:inset-x-5 lg:bottom-5">
        <div className="flex flex-wrap items-center gap-3 px-3 py-3 sm:px-4"><div className="flex min-w-0 flex-1 items-center gap-3 sm:min-w-[190px]"><Cover track={currentTrack} className="size-11 rounded-xl" /><div className="min-w-0"><p className="truncate text-sm font-medium">{currentTrack.title}</p><p className="truncate text-xs text-muted-foreground">{currentTrack.artist}</p></div><button type="button" onClick={() => toggleLike(currentTrack.id)} className={cn("ml-1 hidden rounded-lg p-1.5 text-muted-foreground hover:text-orange-300 sm:block", liked.has(currentTrack.id) && "text-orange-400")} aria-label="Oblíbené"><Heart className={cn("size-4", liked.has(currentTrack.id) && "fill-current")} /></button></div><div className="order-3 w-full sm:order-none sm:flex sm:flex-1 sm:flex-col sm:gap-1.5"><div className="hidden items-center justify-center gap-5 sm:flex"><button type="button" onClick={() => setIsShuffled((value) => !value)} className={cn("p-1 text-muted-foreground hover:text-foreground", isShuffled && "text-orange-300")} aria-label="Náhodné pořadí"><Shuffle className="size-4" /></button><button type="button" onClick={playPrevious} className="p-1 text-muted-foreground hover:text-foreground" aria-label="Předchozí"><SkipBack className="size-4 fill-current" /></button><button type="button" onClick={() => playTrack(currentTrack.id)} className="flex size-9 items-center justify-center rounded-full bg-foreground text-background transition-transform hover:scale-105" aria-label={isPlaying ? "Pozastavit" : "Přehrát"}>{isPlaying ? <Pause className="size-4 fill-current" /> : <Play className="ml-0.5 size-4 fill-current" />}</button><button type="button" onClick={playNext} className="p-1 text-muted-foreground hover:text-foreground" aria-label="Další"><SkipForward className="size-4 fill-current" /></button><button type="button" onClick={() => setRepeatMode((mode) => mode === "off" ? "all" : mode === "all" ? "one" : "off")} className={cn("p-1 text-muted-foreground hover:text-foreground", repeatMode !== "off" && "text-orange-300")} aria-label="Opakování"><Repeat2 className="size-4" /></button></div><div className="flex items-center gap-2"><span className="hidden w-9 text-right text-[10px] tabular-nums text-muted-foreground sm:block">{formatTime(currentTime)}</span><input type="range" min="0" max={duration || 0} step="0.1" value={Math.min(currentTime, duration || 0)} onChange={(event) => { const value = Number(event.target.value); if (audioRef.current) audioRef.current.currentTime = value; setCurrentTime(value); }} className="player-range" aria-label="Pozice ve skladbě" style={{ "--range-progress": `${progress}%` } as React.CSSProperties} /><span className="w-9 text-[10px] tabular-nums text-muted-foreground">{formatTime(duration)}</span></div></div><div className="flex items-center gap-1 sm:min-w-[190px] sm:justify-end"><button type="button" className="flex size-9 items-center justify-center rounded-full bg-foreground text-background sm:hidden" onClick={() => playTrack(currentTrack.id)} aria-label={isPlaying ? "Pozastavit" : "Přehrát"}>{isPlaying ? <Pause className="size-4 fill-current" /> : <Play className="ml-0.5 size-4 fill-current" />}</button><button type="button" onClick={() => setIsMuted((value) => !value)} className="rounded-lg p-2 text-muted-foreground hover:text-foreground" aria-label={isMuted ? "Zapnout zvuk" : "Ztlumit"}>{isMuted || volume === 0 ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}</button><input type="range" min="0" max="1" step="0.01" value={isMuted ? 0 : volume} onChange={(event) => { setVolume(Number(event.target.value)); setIsMuted(false); }} className="volume-range hidden w-20 sm:block" aria-label="Hlasitost" style={{ "--range-progress": `${(isMuted ? 0 : volume) * 100}%` } as React.CSSProperties} /><button type="button" onClick={() => goToView("library")} className="hidden rounded-lg p-2 text-muted-foreground hover:text-foreground sm:block" aria-label="Knihovna"><ListMusic className="size-4" /></button></div></div><div className="absolute left-0 right-0 top-0 h-0.5 overflow-hidden rounded-full"><div className="h-full bg-orange-400 transition-[width]" style={{ width: `${progress}%` }} /></div>
      </div>
    </div>
  );
}
