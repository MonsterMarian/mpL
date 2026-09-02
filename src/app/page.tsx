"use client";

import * as React from "react";
import {
  BookOpen,
  BookOpenText,
  Bookmark,
  BookmarkCheck,
  ChevronLeft,
  ChevronRight,
  FileText,
  FileUp,
  FolderOpen,
  Loader2,
  Music2,
  Pause,
  Play,
  Search,
  Settings,
  SkipBack,
  SkipForward,
  Timer,
  TimerReset,
  Trash2,
  Video,
  Volume2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { SettingsDialog, loadAddons, type AddonId, type Addons } from "@/components/settings-dialog";
import { VideoLibrary } from "@/components/video-library";
import { DownloadView } from "@/components/download-view";
import { LibraryView, type Browse, type LibraryTab } from "@/components/music/library-view";
import { NowPlaying } from "@/components/music/now-playing";
import { PlayerDock } from "@/components/music/player-dock";
import { TrackMenu } from "@/components/music/track-menu";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Sheet } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/providers/toast-provider";
import { cn } from "@/lib/utils";
import {
  MediaLibrary,
  NativeAudioTrack,
  canReadDeviceMedia,
  playableMediaSource,
  type NativeDocument,
} from "@/lib/media-library";
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
  speechSegments,
  type DocumentOrigin,
  type DocumentPage,
  type StoredDocument,
} from "@/lib/documents";
import { listDocuments, removeDocument, saveDocument, saveProgress } from "@/lib/document-store";
import {
  MAX_STORED_BYTES,
  readDocumentFile,
  readFileByUri,
  removeDocumentFile,
  saveDocumentFile,
} from "@/lib/document-file";
import { openPdf, TEXT_LAYOUT_VERSION, textFromContent } from "@/lib/pdf";
import { PdfReader } from "@/components/reader/pdf-reader";
import { SpeechSettings } from "@/components/speech-settings";
import { createSpeaker, SPEECH_RATES, type Speaker } from "@/lib/speech";
import { readEmbeddedArtwork } from "@/lib/artwork";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import { applyPendingUpdate, checkForUpdate, markBootSucceeded } from "@/lib/live-update";
import {
  currentNativePlayback,
  listenToNativePlayback,
  nativePlaybackAvailable,
  pauseNative,
  playNative,
  resumeNative,
  seekNative,
} from "@/lib/playback-service";
import { installErrorCapture, logPlayback } from "@/lib/diagnostics";
import { SectionIcon } from "@/components/ui/section-icon";
import { DocumentCover } from "@/components/document-cover";
import { loadSectionIcons, defaultSectionIcons, type SectionIcons } from "@/lib/section-icons";
import { loadVideoLayout, type VideoLayout } from "@/lib/video-layout";
import { BRAND_MARK } from "@/lib/brand";
import { hideSplash, onAppResume, registerBackButton, syncStatusBar } from "@/lib/native";

type View = "library" | "reader" | "video" | "downloads";

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

/**
 * Jak dlouho se čeká na obálku, než se na ni zapomene.
 *
 * `page.render` umí uvíznout - třeba když se nedaří stáhnout náhradní písmo -
 * a nic to neohlásí. Bez stropu na to čekal celý import: kniha se nikdy
 * neuložila do knihovny a uživatel koukal na okno, které nikam nevede.
 */
const THUMBNAIL_TIMEOUT_MS = 8000;

/**
 * Náhled stránky PDF.
 *
 * Kreslí se do plátna v paměti a ukládá jako JPEG - jinak by knihovna
 * dokumentů byla řádka stejných šedých obdélníků a nešlo by v nich poznat,
 * co je co.
 *
 * Obálka je ozdoba, ne podmínka: když se nepovede nebo se do osmi vteřin
 * nestihne, kniha se uloží bez ní.
 */
async function renderPageThumbnail(page: PDFPageProxy): Promise<string | null> {
  try {
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(1.5, 320 / base.width);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const context = canvas.getContext("2d");
    if (!context) return null;
    const task = page.render({ canvasContext: context, viewport, canvas });
    const drawn = await Promise.race([
      task.promise.then(() => true),
      new Promise<boolean>((resolve) => window.setTimeout(() => resolve(false), THUMBNAIL_TIMEOUT_MS)),
    ]);
    if (!drawn) {
      // Rozkreslené plátno by dalo do knihovny půlku stránky. Radši nic.
      task.cancel();
      return null;
    }
    return canvas.toDataURL("image/jpeg", 0.7);
  } catch {
    // Náhled je ozdoba - bez něj se dokument otevře stejně.
    return null;
  }
}

/**
 * Text všech stránek dokumentu.
 *
 * Skládá se stejným pravidlem jako textová vrstva nad vykreslenou stránkou
 * (viz `lib/pdf.ts`). Jen díky tomu jde větu, kterou zrovna čte hlas, obtáhnout
 * přesně tam, kde na stránce je - jinak by zvýraznění ukazovalo vedle.
 */
async function extractPages(
  pdf: PDFDocumentProxy,
  onProgress?: (percent: number) => void,
): Promise<DocumentPage[]> {
  const pages: DocumentPage[] = [];
  for (let index = 1; index <= pdf.numPages; index += 1) {
    const page = await pdf.getPage(index);
    const content = await page.getTextContent();
    pages.push({ text: pageText(textFromContent(content).text), label: `Strana ${index}` });
    page.cleanup();
    onProgress?.(Math.round((index / pdf.numPages) * 100));
  }
  return pages;
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
    uri: track.src,
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
  const [addons, setAddons] = React.useState<Addons>({ reader: true, video: true, downloads: true });
  /** Ikony sekcí si vybírá uživatel v Nastavení. */
  const [sectionIcons, setSectionIcons] = React.useState<SectionIcons>(defaultSectionIcons);
  const [videoLayout, setVideoLayout] = React.useState<VideoLayout>("grid");
  const [mediaPermission, setMediaPermission] = React.useState<"unknown" | "granted" | "denied" | "unavailable">("unknown");
  const [isLoadingMedia, setIsLoadingMedia] = React.useState(false);
  /**
   * Knihovna se nekreslí, dokud se nenačte.
   *
   * Bez toho appka po otevření na okamžik ukázala prázdný stav („žádné
   * skladby"), pak seznam bez obalů a teprve pak hotovou obrazovku. Tři různé
   * obrazy během půl vteřiny vypadají jako chyba, i když jde jen o načítání.
   */
  const [libraryReady, setLibraryReady] = React.useState(false);
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
  /** Poslední známá pozice - ukládá se na disk i mimo překreslení. */
  const currentTimeRef = React.useRef(0);
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
    ended: () => {},
  });

  /** Knihovna dokumentů z disku - stejně jako knihovna hudby přežije restart. */
  const [documents, setDocuments] = React.useState<StoredDocument[]>([]);
  const [documentId_, setDocumentId] = React.useState<string | null>(null);
  const [documentPage, setDocumentPage] = React.useState(0);
  const [documentQuery, setDocumentQuery] = React.useState("");
  const [documentZoom, setDocumentZoom] = React.useState(100);
  const [documentBookmarks, setDocumentBookmarks] = React.useState<number[]>([]);
  const [isLoadingDocument, setIsLoadingDocument] = React.useState(false);
  /** Volba hlasu u textového dokumentu. Ve vykreslené čtečce sedí ve své liště. */
  const [voiceOpen, setVoiceOpen] = React.useState(false);
  /** Kniha čekající na potvrzení, že se má smazat. Mazání je bez návratu. */
  const [docToDelete, setDocToDelete] = React.useState<StoredDocument | null>(null);
  /**
   * Dokumentu chybí soubor, takže z něj zbyl jen vytažený text.
   *
   * Týká se to knih přidaných dřív, než čtečka uměla kreslit stránky - těm se
   * ukládal jen text. Dřív se v takovém případě prostě ukázal text a nikde
   * nestálo proč; teď se soubor nejdřív zkusí najít v telefonu a když se
   * nenajde, řekne si o něj.
   */
  const [missingFile, setMissingFile] = React.useState(false);
  /**
   * Co se s dokumentem zrovna děje.
   *
   * U velké knihy trvá otevření vteřiny a zamlžené okno bez čísla vypadá jako
   * zaseknutá appka. `percent` je `null`, dokud se nedá spočítat - třeba než
   * pdf.js zjistí velikost souboru.
   */
  const [documentProgress, setDocumentProgress] = React.useState<{ label: string; percent: number | null }>({
    label: "Otevírám dokument…",
    percent: null,
  });
  /** Otevřené PDF, ze kterého se kreslí stránky. `null` = jen holý text. */
  const [pdfDoc, setPdfDoc] = React.useState<PDFDocumentProxy | null>(null);
  /** Přehled stránek - otevírá se číslem stránky pod textem. */
  const [pagesOpen, setPagesOpen] = React.useState(false);
  /** Dokumenty nalezené v telefonu a složka, ve které se zrovna listuje. */
  const [deviceDocs, setDeviceDocs] = React.useState<NativeDocument[]>([]);
  const [allFiles, setAllFiles] = React.useState<boolean | null>(null);
  const [docFolder, setDocFolder] = React.useState<string | null>(null);
  const [isReadingDocument, setIsReadingDocument] = React.useState(false);
  const [documentError, setDocumentError] = React.useState<string | null>(null);
  /** Kus věty, u kterého řeč stojí - odtud se po pauze pokračuje. */
  const [speechChunk, setSpeechChunk] = React.useState(0);
  /**
   * Stránka, na které se čte. `null` = ještě se nikde nezačalo.
   *
   * Schválně zvlášť od stránky, na kterou se čtenář dívá. Do teď to bylo
   * jedno číslo, takže odrolování o kus níž přeneslo i čtení - hlas skočil na
   * začátek stránky, kterou měl čtenář zrovna před očima. Listovat v knize,
   * kterou zrovna posloucháš, tím bylo k ničemu. Místo čtení se posune jedině
   * čtením samotným nebo tím, že si ho čtenář sám přesune (`readFromSpot`).
   */
  const [speechPage, setSpeechPage] = React.useState<number | null>(null);
  /** Rozečtená věta na stránce - drží se v zorném poli, ať čtenář stačí. */
  const activeChunk = React.useRef<HTMLSpanElement | null>(null);
  /** Žádost o čtení: `null` = ticho. Nový objekt spustí čtení znovu. */
  const [readRequest, setReadRequest] = React.useState<{ from: number } | null>(null);
  const [speechRate, setSpeechRate] = React.useState<number>(1);
  const speaker = React.useRef<Speaker | null>(null);
  /** Otevřené PDF i mimo překreslení - zavírá se ručně, ne úklidem paměti. */
  const pdfRef = React.useRef<PDFDocumentProxy | null>(null);
  /** Kolikáté otevření dokumentu běží; starší se cestou zahodí. */
  const openedAt = React.useRef(0);

  const currentTrack = tracks.find((track) => track.id === currentTrackId) ?? EMPTY_TRACK;
  const hasTrack = currentTrack.id !== EMPTY_TRACK.id;

  /**
   * Kdo zvuk doopravdy přehrává.
   *
   * Skladbu ze zařízení pouští nativní služba - jen tak hraje dál, když je
   * appka zavřená. Ručně vybraný soubor (blob adresa) nativní přehrávač
   * otevřít neumí, ten zůstává značce `<audio>` ve stránce, stejně jako celý
   * prohlížeč a starší balík bez pluginu.
   */
  const nativeReady = React.useMemo(() => nativePlaybackAvailable(), []);
  const playsNatively = React.useCallback(
    (track: Track) => nativeReady && Boolean(track.uri),
    [nativeReady],
  );
  /** Co má služba načtené - aby „přehrát" po restartu appky vědělo, co pustit. */
  const nativeLoaded = React.useRef<string | null>(null);
  /**
   * Hrálo se v tomhle spuštění?
   *
   * Appka si pamatuje, kde uživatel posledně skončil, ale lišta dole nemá po
   * otevření hlásit skladbu, kterou nikdo nepustil. Objeví se, až se přehrává
   * doopravdy - nebo když se převezme hudba běžící na pozadí.
   */
  const [playbackStarted, setPlaybackStarted] = React.useState(false);

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

  currentTimeRef.current = currentTime;

  /**
   * Složky z toho, co se v telefonu našlo.
   *
   * Bere se celá cesta, ne jen poslední úsek: `Download` a `Documents/skripta`
   * jsou dvě různá místa a splynout nemají.
   */
  const documentFolders = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const doc of deviceDocs) {
      const key = doc.folder || "Jinde";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([name, count]) => ({
        name,
        count,
        label: name.split("/").filter(Boolean).pop() ?? name,
      }))
      .sort((a, b) => b.count - a.count);
  }, [deviceDocs]);

  const activeDoc = documents.find((doc) => doc.id === documentId_) ?? null;
  const documentPages: DocumentPage[] = activeDoc?.pages ?? [];
  const documentName = activeDoc?.name ?? null;
  const activeDocument = documentPages[documentPage];
  /** Dokument jde číst nahlas (naskenovaná kniha ne). */
  const documentReadable = activeDoc !== null && !activeDoc.imageOnly;
  const readablePage = documentReadable && Boolean(activeDocument?.text);
  /** Stránka, ze které bere text hlas. Dokud se nezačalo, ta na obrazovce. */
  const readingPage = speechPage ?? documentPage;
  const readingDocument = documentPages[readingPage];
  const readingReadable = documentReadable && Boolean(readingDocument?.text);
  /*
    Kusy k předčítání i s tím, kde na stránce leží. Pozice jsou to podstatné:
    bez nich by šlo říct jen „čte se pátý kus", ale ne který to je v textu -
    a zvýraznit rozečtenou větu ani klepnutím posunout, odkud se má číst, by
    nešlo vůbec.

    Bere se stránka, na které se **čte**, ne ta na obrazovce. Jinak by se při
    rolování hlasu měnil text pod rukama.
  */
  const segments = React.useMemo(
    () => (readingReadable ? speechSegments(readingDocument.text) : []),
    [readingReadable, readingDocument],
  );
  const chunks = React.useMemo(() => segments.map((segment) => segment.text), [segments]);
  /** Text stránek pro hledání v celém dokumentu. */
  const documentTexts = React.useMemo(() => documentPages.map((item) => item.text), [documentPages]);

  const loadDeviceMusic = React.useCallback(async (requestPermission = false) => {
    if (!canReadDeviceMedia()) {
      setMediaPermission("unavailable");
      setLibraryReady(true);
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
      setLibraryReady(true);
    }
  }, [toast]);

  /**
   * Co leží v telefonu.
   *
   * Bez „přístupu ke všem souborům" Android PDF neukáže - povolení k hudbě
   * na ně nestačí, protože dokumenty za média nepovažuje.
   */
  const loadDeviceDocuments = React.useCallback(async () => {
    if (!canReadDeviceMedia()) {
      setAllFiles(false);
      return;
    }
    try {
      const result = await MediaLibrary.listDocuments();
      setAllFiles(Boolean(result?.granted));
      setDeviceDocs(result?.documents ?? []);
    } catch (error) {
      console.error("Dokumenty se nepodařilo načíst", error);
      setAllFiles(false);
    }
  }, []);

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
    setSectionIcons(loadSectionIcons());
    setVideoLayout(loadVideoLayout());
    void loadDeviceDocuments();
    setStorageReady(true);
    void loadDeviceMusic();

    // Knihovna dokumentů z disku. Naposledy otevřený se rovnou nabídne
    // a otevře se na stránce, kde uživatel skončil.
    void listDocuments().then((stored) => {
      if (!stored.length) return;
      setDocuments(stored);
      const last = stored[0];
      setDocumentId(last.id);
      setDocumentPage(last.page);
      setDocumentBookmarks(last.bookmarks);
      // Tohle je ten důvod, proč se kniha po startu appky ukazovala jako holý
      // text: obnovil se záznam z knihovny, ale soubor, ze kterého se kreslí
      // stránky, si nikdo nevyžádal. Čtečka pak neměla co vykreslit a spadla
      // na náhradní zobrazení - a vypadalo to, že vykreslování prostě nefunguje.
      void loadDocumentFile(last);
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

  /**
   * Srovnání s běžícím přehráváním.
   *
   * Hudba mohla hrát celou dobu, co byla appka zavřená - služba o ní ví
   * a appka se podle ní zařídí. Bez toho by se tvářila, že nehraje nic,
   * a prvním klepnutím by běžící skladbu přerazila.
   */
  const adopted = React.useRef(false);
  React.useEffect(() => {
    if (!nativeReady || !tracks.length || adopted.current) return;
    adopted.current = true;
    void currentNativePlayback().then((snapshot) => {
      if (!snapshot?.running || !snapshot.uri) return;
      const track = tracks.find((item) => item.uri === snapshot.uri);
      if (!track) return;
      logPlayback("služba: appka převzala běžící přehrávání");
      setPlaybackStarted(true);
      nativeLoaded.current = track.id;
      resumeRef.current = null;
      setCurrentTrackId(track.id);
      setIsPlaying(Boolean(snapshot.playing));
      setCurrentTime((snapshot.positionMs ?? 0) / 1000);
      if (snapshot.durationMs) setDuration(snapshot.durationMs / 1000);
    });
  }, [nativeReady, tracks]);

  /** Návrat tam, kde se skončilo. Jde jen o skladby, které v zařízení pořád jsou. */
  React.useEffect(() => {
    const resume = resumeRef.current;
    if (!resume || !tracks.length) return;
    resumeRef.current = null;
    if (!tracks.some((track) => track.id === resume.id)) return;
    setCurrentTrackId(resume.id);
    setCurrentTime(resume.time);
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
        JSON.stringify({ id: currentTrackId, time: currentTimeRef.current }),
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
    // Skladbu, kterou hraje služba, si prvek ve stránce nesmí nahrát - hrálo
    // by to dvakrát přes sebe.
    if (playsNatively(currentTrack)) return;
    const audio = audioRef.current;
    if (!audio || !currentTrack) return;
    audio.load();
    setCurrentTime(0);
    setDuration(currentTrack.durationSeconds);
    if (isPlaying) {
      audio.play().catch(() => setIsPlaying(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTrackId]);

  /**
   * Dokud hraje hudba, drží appku naživu služba v popředí. Bez ní Android
   * proces na pozadí sestřelí a poslech skončí uprostřed skladby.
   */
  /**
   * Co hlásí nativní přehrávač.
   *
   * Stav i pozice chodí odsud, ne z prvku ve stránce - službě totiž hudba
   * patří. Appka je proti ní jen okno: po otevření se srovná podle toho, co
   * zrovna hraje, místo aby přehrávání přerazila.
   */
  React.useEffect(() => {
    return listenToNativePlayback({
      onState: ({ playing, positionMs, durationMs }) => {
        setIsPlaying(playing);
        setCurrentTime(positionMs / 1000);
        if (durationMs > 0) setDuration(durationMs / 1000);
      },
      onCompleted: () => {
        logPlayback("služba: skladba dohrála");
        controls.current.ended();
      },
      onFailed: (message) => {
        logPlayback(`služba: ${message}`);
        toast({ tone: "warn", title: "Skladbu se nepodařilo přehrát", description: "Soubor už nemusí být v zařízení." });
      },
      onCommand: (command) => {
        logPlayback(`${command.source === "notification" ? "notifikace" : "systém"}: ${command.action}`);
        // Přehrát, pauzu i posun udělala služba sama a stav si vyžádá zpátky
        // vlastní hláškou. Appka řeší jen to, co umí rozhodnout jedině ona:
        // která skladba je na řadě.
        if (command.action === "next") controls.current.next();
        else if (command.action === "previous") controls.current.previous();
      },
    });
  }, [toast]);

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
      void pauseNative();
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
   *
   * Sekce s videem si sem zapíše, jak zavřít svůj přehrávač: rozhodovat, co je
   * navrchu, má jedno místo, ne každá sekce zvlášť.
   */
  const closeVideoPlayer = React.useRef<(() => void) | null>(null);
  const trackVideoPlayer = React.useCallback((close: (() => void) | null) => {
    closeVideoPlayer.current = close;
  }, []);

  const handleBack = React.useRef<() => boolean>(() => false);
  handleBack.current = () => {
    // Přehrávač videa je přes celou obrazovku, takže je navrchu vždycky on.
    if (closeVideoPlayer.current) {
      closeVideoPlayer.current();
      return true;
    }
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
    // Otevřená kniha je přes celou obrazovku, takže zpět zavírá napřed ji.
    if (documentId_) {
      closeDocument();
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

  /**
   * Návrat do appky knihovnu přečte znovu.
   *
   * Oprávnění se povolují v systémovém nastavení, tedy mimo appku. Bez tohohle
   * se povolený přístup projevil až po vypnutí a zapnutí appky, což vypadá
   * jako že povolení nefunguje.
   */
  React.useEffect(() => {
    let cleanup = () => {};
    void onAppResume(() => {
      void loadDeviceMusic();
      void loadDeviceDocuments();
    }).then((fn) => {
      cleanup = fn;
    });
    return () => cleanup();
  }, [loadDeviceMusic, loadDeviceDocuments]);

  const toggleLike = (trackId: string) => {
    setLiked((previous) => {
      const next = new Set(previous);
      if (next.has(trackId)) next.delete(trackId);
      else next.add(trackId);
      return next;
    });
  };

  /** Nová skladba se počítá do statistiky - z ní žije řazení podle poslechu. */
  const startTrack = (trackId: string, positionMs = 0) => {
    logPlayback("uživatel: spustil skladbu");
    setPlaybackStarted(true);
    startedAt.current = Date.now();
    // Hudba a předčítání se v jednom přehrávači nepřekřikují.
    stopReading();
    setCurrentTrackId(trackId);
    setIsPlaying(true);
    setPlayStats((previous) => ({
      ...previous,
      [trackId]: { count: (previous[trackId]?.count ?? 0) + 1, at: Date.now() },
    }));

    const track = tracks.find((item) => item.id === trackId);
    if (track && playsNatively(track)) {
      nativeLoaded.current = trackId;
      setCurrentTime(positionMs / 1000);
      setDuration(track.durationSeconds);
      void playNative({
        uri: track.uri as string,
        title: track.title,
        artist: track.artist,
        album: track.album,
        artwork: track.artworkSource ?? null,
        positionMs,
        playWhenReady: true,
      });
    }
  };

  /** Kdy naposledy pustil přehrávání uživatel - viz `ignoreEarlyPause`. */
  const startedAt = React.useRef(0);

  const togglePlayback = () => {
    if (!hasTrack) return;

    if (playsNatively(currentTrack)) {
      if (isPlaying) {
        logPlayback("uživatel: pauza");
        setIsPlaying(false);
        void pauseNative();
        return;
      }
      logPlayback("uživatel: přehrát");
      startedAt.current = Date.now();
      stopReading();
      setIsPlaying(true);
      // Po restartu appky služba nic načteného nemá - tehdy se skladba musí
      // podat znovu, i s pozicí, kde se posledně skončilo.
      if (nativeLoaded.current === currentTrack.id) void resumeNative();
      else startTrack(currentTrack.id, Math.round(currentTime * 1000));
      return;
    }

    if (isPlaying) {
      logPlayback("uživatel: pauza");
      audioRef.current?.pause();
      setIsPlaying(false);
      return;
    }
    logPlayback("uživatel: přehrát");
    startedAt.current = Date.now();
    stopReading();
    audioRef.current
      ?.play()
      .then(() => setIsPlaying(true))
      .catch((error) => {
        logPlayback(`element: play() odmítnut - ${String(error).slice(0, 80)}`);
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
    setCurrentTime(seconds);
    if (playsNatively(currentTrack)) {
      void seekNative(seconds * 1000);
      return;
    }
    if (audioRef.current) audioRef.current.currentTime = seconds;
  };

  const skipBy = (seconds: number) => {
    const limit = duration || currentTrack.durationSeconds || 0;
    seekTo(Math.min(Math.max(0, currentTime + seconds), limit));
  };

  const handleEnded = () => {
    // Časovač „do konce skladby" se vybírá právě tady - ne po vteřinách.
    if (sleepAfterTrack) {
      setSleepAfterTrack(false);
      void pauseNative();
      setIsPlaying(false);
      setCurrentTime(0);
      toast({ tone: "info", title: "Časovač doběhl", description: "Hudba usnula po dohrání skladby." });
      return;
    }
    if (repeatMode === "one") {
      if (playsNatively(currentTrack)) {
        startTrack(currentTrack.id);
      } else if (audioRef.current) {
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
    ended: handleEnded,
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

  /**
   * Přepne čtečku na dokument.
   *
   * `opened` je připravené PDF, když ho volající zrovna otevřel - načtený
   * soubor nemá smysl číst podruhé. Předchozí dokument se zavírá tady, ne až
   * v úklidu paměti: jeho worker drží desítky megabajtů obrázků.
   */
  const showDocument = (doc: StoredDocument, opened: PDFDocumentProxy | null) => {
    stopReading();
    // Jiná kniha, jiné místo čtení - přenášet ho mezi dokumenty nedává smysl.
    setSpeechPage(null);
    setSpeechChunk(0);
    setMissingFile(false);
    const previous = pdfRef.current;
    pdfRef.current = opened;
    if (previous && previous !== opened) void previous.loadingTask.destroy().catch(() => {});
    setPdfDoc(opened);
    setDocumentId(doc.id);
    setDocumentPage(clampPage(doc.page, doc.pages.length));
    setDocumentBookmarks(doc.bookmarks);
    setDocumentError(
      doc.imageOnly && !opened
        ? `${doc.name} je obrázkový dokument - jsou v něm jen naskenované stránky bez textu. Přečíst nahlas ani prohledat ho nejde.`
        : null,
    );
  };

  const openDocument = (doc: StoredDocument) => {
    showDocument(doc, null);
    void loadDocumentFile(doc);
  };

  /** Kniha stejného jména ležící v telefonu. Podle ní se dohledá ztracený soubor. */
  const findDeviceDocument = async (name: string): Promise<NativeDocument | null> => {
    const known = deviceDocs.find((item) => item.name === name);
    if (known) return known;
    if (!canReadDeviceMedia()) return null;
    try {
      const result = await MediaLibrary.listDocuments();
      const list = result?.documents ?? [];
      setDeviceDocs(list);
      return list.find((item) => item.name === name) ?? null;
    } catch {
      return null;
    }
  };

  /** Zapamatuje si, kde soubor dokumentu leží - podruhé se už hledat nemusí. */
  const rememberOrigin = async (doc: StoredDocument, origin: DocumentOrigin) => {
    const next: StoredDocument = { ...doc, origin };
    await saveDocument(next);
    setDocuments((previous) => previous.map((item) => (item.id === doc.id ? next : item)));
  };

  /**
   * Natáhne soubor, ze kterého se kreslí stránky.
   *
   * Knihy přidané dřív, než čtečka uměla kreslit stránky, mají v knihovně jen
   * vytažený text a žádnou adresu souboru. Dřív se u nich tahle funkce potichu
   * otočila ve dveřích: uživatel viděl holý text a nikde nestálo proč. Většina
   * takových knih přitom v telefonu pořád leží, takže se soubor napřed zkusí
   * najít podle jména - a když se nenajde, čtečka si o něj řekne.
   */
  const loadDocumentFile = async (doc: StoredDocument) => {
    // Rychlé přeskakování mezi knihami: platí vždycky jen poslední otevření.
    const token = openedAt.current + 1;
    openedAt.current = token;
    setMissingFile(false);
    setDocumentProgress({ label: "Hledám soubor…", percent: null });
    setIsLoadingDocument(true);
    try {
      let origin: DocumentOrigin = doc.origin ?? { kind: "none" };
      if (origin.kind === "none") {
        const found = await findDeviceDocument(doc.name);
        if (token !== openedAt.current) return;
        if (!found) {
          setMissingFile(true);
          return;
        }
        origin = { kind: "device", uri: found.uri };
        await rememberOrigin(doc, origin);
      }

      const bytes = origin.kind === "device" ? await readFileByUri(origin.uri) : await readDocumentFile(doc.id);
      if (token !== openedAt.current) return;
      if (!bytes) {
        setMissingFile(true);
        setDocumentError("Soubor dokumentu se nepodařilo najít. Zůstal jen vytažený text.");
        return;
      }

      setDocumentProgress({ label: "Otevírám dokument…", percent: 0 });
      const opened = await openPdf(bytes, (percent) => {
        if (token === openedAt.current) setDocumentProgress({ label: "Otevírám dokument…", percent });
      });
      if (token !== openedAt.current) {
        void opened.loadingTask.destroy().catch(() => {});
        return;
      }
      pdfRef.current = opened;
      setPdfDoc(opened);
      setDocumentError(null);

      // Dokument uložený starším pravidlem má text posunutý proti textové
      // vrstvě a zvýraznění čtené věty by ukazovalo vedle. Přečte se znovu.
      if ((doc.textVersion ?? 1) < TEXT_LAYOUT_VERSION) {
        setDocumentProgress({ label: "Připravuji text stránek…", percent: 0 });
        const pages = await extractPages(opened, (percent) => {
          if (token === openedAt.current) setDocumentProgress({ label: "Připravuji text stránek…", percent });
        });
        if (token !== openedAt.current || !pages.length) return;
        const next: StoredDocument = {
          ...doc,
          origin,
          pages,
          textVersion: TEXT_LAYOUT_VERSION,
          imageOnly: isImageOnly(pages),
        };
        await saveDocument(next);
        setDocuments((previous) => previous.map((item) => (item.id === doc.id ? next : item)));
      }
    } catch (error) {
      console.error("Stránky dokumentu se nepodařilo připravit", error);
      if (token === openedAt.current) {
        setMissingFile(true);
        setDocumentError("Stránky se nepodařilo vykreslit. Zůstal jen vytažený text.");
      }
    } finally {
      if (token === openedAt.current) setIsLoadingDocument(false);
    }
  };

  /**
   * Dodá soubor k dokumentu, který už v knihovně je.
   *
   * Nezakládá se nový záznam: stránka, na které uživatel skončil, i záložky
   * mají zůstat. Text se přečte znovu (v `loadDocumentFile`), protože starý
   * vznikl jiným pravidlem a zvýraznění čtené věty by ukazovalo vedle.
   */
  const attachDocumentFile = async (file: File) => {
    const doc = activeDoc;
    if (!doc) return;

    setMissingFile(false);
    setDocumentError(null);
    setDocumentProgress({ label: "Ukládám soubor…", percent: null });
    setIsLoadingDocument(true);
    let next: StoredDocument | null = null;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!(await saveDocumentFile(doc.id, bytes))) {
        setMissingFile(true);
        setDocumentError(
          `Soubor se nepodařilo uložit - čtečka si nechává knihy do ${Math.round(MAX_STORED_BYTES / (1024 * 1024))} MB. Otevři ho ze složky v telefonu.`,
        );
        return;
      }
      next = { ...doc, origin: { kind: "stored" } };
      await saveDocument(next);
      setDocuments((previous) => previous.map((item) => (item.id === doc.id ? next! : item)));
    } catch (error) {
      console.error("Soubor se nepodařilo přiložit k dokumentu", error);
      setMissingFile(true);
      setDocumentError("Soubor se nepodařilo přečíst.");
      return;
    } finally {
      setIsLoadingDocument(false);
    }

    await loadDocumentFile(next);
  };

  const handleDocumentUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    await importDocument(file);
  };

  /**
   * Otevře dokument nalezený v telefonu.
   *
   * Soubor se natáhne přes adresu, kterou WebView umí, a dál jde stejnou
   * cestou jako ručně vybraný - rozebrat na stránky se musí tak jako tak.
   */
  const openDeviceDocument = async (doc: NativeDocument) => {
    const known = documents.find((item) => item.name === doc.name);
    if (known) {
      openDocument(known);
      return;
    }
    setDocumentProgress({ label: "Stahuji dokument z telefonu…", percent: null });
    setIsLoadingDocument(true);
    try {
      const response = await fetch(playableMediaSource(doc.uri));
      const blob = await response.blob();
      // Adresa jde dál: kniha leží v telefonu a druhá kopie v datech appky by
      // jen sežrala místo.
      await importDocument(new File([blob], doc.name, { type: doc.mimeType }), { uri: doc.uri });
    } catch (error) {
      console.error("Dokument se nepodařilo otevřít", error);
      setDocumentError("Soubor se nepodařilo přečíst. Zkus ho otevřít ručně.");
      setIsLoadingDocument(false);
    }
  };

  /**
   * Načte soubor do knihovny.
   *
   * `device` je adresa knihy ležící v telefonu. Taková se nekopíruje - čte se
   * z místa, kde je, a v datech appky po ní zůstane jen záznam. Ručně vybraný
   * soubor jinou adresu nemá, takže se uloží k sobě.
   */
  const importDocument = async (file: File, device?: { uri: string }) => {
    setDocumentProgress({ label: "Čtu soubor…", percent: null });
    setIsLoadingDocument(true);
    setDocumentError(null);
    try {
      const id = documentId(file.name, file.size);
      let pages: DocumentPage[] = [];
      let thumbnail: string | null = null;
      let origin: DocumentOrigin = { kind: "none" };
      let aspect: number | null = null;
      let opened: PDFDocumentProxy | null = null;

      if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        setDocumentProgress({ label: "Otevírám dokument…", percent: 0 });
        opened = await openPdf(bytes, (percent) => setDocumentProgress({ label: "Otevírám dokument…", percent }));
        setDocumentProgress({ label: "Připravuji text stránek…", percent: 0 });
        pages = await extractPages(opened, (percent) =>
          setDocumentProgress({ label: "Připravuji text stránek…", percent }),
        );

        setDocumentProgress({ label: "Kreslím obálku…", percent: null });
        const first = await opened.getPage(1);
        const view = first.getViewport({ scale: 1 });
        aspect = view.height > 0 ? view.width / view.height : null;
        // Obálka knihovny: první stránka, jednou a nastálo.
        thumbnail = await renderPageThumbnail(first);
        first.cleanup();

        origin = device
          ? { kind: "device", uri: device.uri }
          : (await saveDocumentFile(id, bytes))
            ? { kind: "stored" }
            : { kind: "none" };
      } else {
        pages = buildTextPages(await file.text());
      }
      if (!pages.length) throw new Error("Soubor je prázdný.");

      const doc: StoredDocument = {
        id,
        name: file.name,
        pages,
        // Naskenovaná kniha se pozná hned tady, ne až u tlačítka „Číst nahlas".
        imageOnly: isImageOnly(pages),
        addedAt: new Date().toISOString(),
        page: 0,
        bookmarks: [],
        thumbnail,
        origin,
        textVersion: TEXT_LAYOUT_VERSION,
        aspect,
      };

      await saveDocument(doc);
      setDocuments((previous) => [doc, ...previous.filter((d) => d.id !== doc.id)]);
      openedAt.current += 1;
      showDocument(doc, opened);

      toast(
        doc.imageOnly
          ? {
              tone: "warn",
              title: "Dokument je obrázkový",
              description: opened
                ? "Stránky jsou naskenované. Listovat jde, čtení nahlas a hledání ne."
                : "Stránky jsou naskenované, text v nich není. Čtení nahlas nepůjde.",
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
    }
  };

  const forgetDocument = async (id: string) => {
    stopReading();
    await removeDocument(id);
    await removeDocumentFile(id);
    const rest = documents.filter((doc) => doc.id !== id);
    setDocuments(rest);
    if (documentId_ !== id) return;
    setDocumentError(null);
    if (rest[0]) {
      openDocument(rest[0]);
      return;
    }
    dropPdf();
    setDocumentId(null);
  };

  // --- čtení nahlas ----------------------------------------------------------

  const stopReading = () => setReadRequest(null);

  /**
   * Zapnout čtení znamená říct, od kterého kusu - samotné mluvení obstará
   * efekt níž. Přes stav, ne přímým voláním: text se mění (obrácený list,
   * jiný dokument) a čtení musí vždycky jet z toho, co je zrovna na řadě.
   *
   * Poprvé se začíná na stránce, kterou má čtenář před sebou. Podruhé už ne:
   * pauza a rozečtené místo patří k sobě a odrolovat o dvě strany níž není
   * pokyn „a teď čti odjinud".
   */
  const toggleDocumentReading = () => {
    if (readRequest) {
      // Pauza, ne konec: index rozečteného kusu zůstává, takže se pokračuje
      // odtud, ne od začátku stránky.
      stopReading();
      return;
    }
    if (speechPage === null) {
      // Poprvé se čte od stránky, na kterou se čtenář dívá. Od téhle chvíle
      // si místo čtení žije vlastním životem.
      if (!readablePage) return;
      setSpeechPage(documentPage);
      setSpeechChunk(0);
      setReadRequest({ from: 0 });
      return;
    }
    if (!readingReadable) return;
    setReadRequest({ from: speechChunk });
  };

  /**
   * Zavře dokument a vrátí se k policím.
   *
   * Postup se neztrácí - ten si drží `saveProgress`, takže se dá pokračovat
   * tam, kde se skončilo.
   */
  const closeDocument = () => {
    stopReading();
    setSpeechChunk(0);
    setSpeechPage(null);
    setDocumentId(null);
    setDocumentQuery("");
    setDocumentError(null);
    dropPdf();
  };

  /** Zavře otevřené PDF. Rozečtené načítání se tím zároveň zneplatní. */
  const dropPdf = () => {
    openedAt.current += 1;
    const previous = pdfRef.current;
    pdfRef.current = null;
    if (previous) void previous.loadingTask.destroy().catch(() => {});
    setPdfDoc(null);
  };

  /**
   * Přesune čtení na vybranou větu.
   *
   * Dřív se dala vybrat jen stránka, takže „pusť to odsud" znamenalo
   * poslouchat všechno od jejího začátku. Zvýraznění je proto zároveň ukazatel
   * i ovládání: kam se klepne, odtud se čte.
   */
  const jumpToChunk = (index: number) => {
    if (!chunks.length) return;
    const at = Math.min(Math.max(index, 0), chunks.length - 1);
    setSpeechPage(readingPage);
    setSpeechChunk(at);
    // Když se zrovna čte, navázat hned. Jinak si to jen zapamatovat na Přehrát.
    if (readRequest) setReadRequest({ from: at });
  };

  /**
   * „Číst odsud": čtenář si sám ukázal, kde se má pokračovat.
   *
   * Jediná cesta, jak místo čtení posunout ručně - a stojí za ní potvrzení
   * v čtečce, ne holé klepnutí. Omylem se do textu trefí kdekdo a přijít
   * klepnutím vedle o místo, kde člověk poslouchal, je horší než klepnout
   * dvakrát.
   */
  const readFromSpot = (page: number, offset: number) => {
    const target = documentPages[page];
    if (!target) return;
    const found = speechSegments(pageText(target.text));
    if (!found.length) return;
    const at = found.findIndex((segment) => offset >= segment.start && offset < segment.end);
    setSpeechPage(page);
    setSpeechChunk(Math.max(0, at));
    setReadRequest({ from: Math.max(0, at) });
  };

  const changeSpeechRate = (rate: number) => {
    setSpeechRate(rate);
    // Nová rychlost se chytne na rozečteném místě, ne na začátku stránky.
    if (readRequest) setReadRequest({ from: speechChunk });
  };

  /**
   * Obrátí stránku v holém textu. Tam je stránka celé zobrazení, takže se
   * s ní stěhuje i čtení - jiné místo, kam by hlas mohl ukazovat, není.
   */
  const goToPage = (page: number) => {
    const next = clampPage(page, documentPages.length);
    if (next === documentPage) return;
    setDocumentPage(next);
    setSpeechPage(next);
    setSpeechChunk(0);
    if (readRequest) setReadRequest({ from: 0 });
  };

  /**
   * Čtenář se jen dívá jinam.
   *
   * Rolování v čtečce, obsah, záložky, posuvník stránek - žádné z toho není
   * pokyn „čti odjinud". Do teď to tak bylo a hlas skákal za čtenářem: kdo se
   * chtěl při poslechu podívat o dvě strany dál, ztratil tím místo, kde
   * poslouchal.
   */
  const viewPage = (page: number) => {
    const next = clampPage(page, documentPages.length);
    if (next === documentPage) return;
    setDocumentPage(next);
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
        if (readingPage < documentPages.length - 1) {
          setSpeechPage(readingPage + 1);
          // V holém textu je stránka celé zobrazení, takže se musí přetočit
          // i ono. V čtečce se obraz veze za zvýrazněnou větou sám.
          if (!pdfRef.current) setDocumentPage(readingPage + 1);
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
    /*
      `documentPage` tu schválně není. Dokud v seznamu byl, znamenalo každé
      odrolování o stránku níž zastavení hlasu a jeho spuštění znovu - řeč se
      tím vracela na začátek a čtenář nemohl v poslouchané knize listovat.
    */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readRequest, chunks, speechRate, readingPage, documentPages.length]);

  // Odchod ze stránky nesmí nechat viset worker s obrázky celé knihy.
  React.useEffect(
    () => () => {
      const opened = pdfRef.current;
      pdfRef.current = null;
      if (opened) void opened.loadingTask.destroy().catch(() => {});
    },
    [],
  );

  /**
   * Postup ve čtení patří na disk: appka se zavírá i uprostřed stránky.
   *
   * Se zpožděním, ne z každé změny. Zápis přepisuje celý seznam knihovny -
   * u tlusté knihy jsou to megabajty textu - a při rolování by se to dělo
   * několikrát za vteřinu. Vteřina zpoždění se na ztrátě postupu neprojeví,
   * na plynulosti čtení ano.
   */
  React.useEffect(() => {
    if (!documentId_) return;
    const timer = window.setTimeout(() => {
      void saveProgress(documentId_, documentPage, documentBookmarks);
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [documentId_, documentPage, documentBookmarks]);

  /*
    Rozečtená věta se drží na obrazovce. Bez tohohle se zvýraznění po pár
    větách vyroluje pryč a poslouchající kouká na kus stránky, který se dávno
    přečetl. Posouvá se jen při čtení - když si někdo listuje sám, nemá mu nic
    skákat pod rukama.
  */
  React.useEffect(() => {
    if (!isReadingDocument) return;
    activeChunk.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [speechChunk, isReadingDocument]);

  const toggleBookmark = (page: number = documentPage) => {
    setDocumentBookmarks((previous) => previous.includes(page) ? previous.filter((item) => item !== page) : [...previous, page]);
  };

  /**
   * Ztiší všechno ostatní. Volá se, když se rozjíždí video - hudba, předčítání
   * a video jsou tři zdroje zvuku v jedné appce a přes sebe nedávají smysl.
   */
  const silenceEverything = () => {
    stopReading();
    audioRef.current?.pause();
    void pauseNative();
    setIsPlaying(false);
  };

  const handleAddonChange = (id: AddonId, enabled: boolean) => {
    setAddons((previous) => ({ ...previous, [id]: enabled }));
    // Vypnutý addon nesmí zůstat na obrazovce, na kterou se pak nedá vrátit.
    if (!enabled && activeView === id) setActiveView("library");
  };

  /** Záložky nad obsahem. Addon bez svojí položky ze seznamu vypadne. */
  const views: { id: View; label: string }[] = [
    { id: "library", label: "Knihovna" },
    ...(addons.reader ? [{ id: "reader" as const, label: "Dokumenty" }] : []),
    ...(addons.video ? [{ id: "video" as const, label: "Video" }] : []),
    ...(addons.downloads ? [{ id: "downloads" as const, label: "Stahování" }] : []),
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

  /**
   * Stránka s vyznačenou větou.
   *
   * Text se skládá po kusech k předčítání, ne jako jeden blok: jinak by nebylo
   * kam pověsit zvýraznění ani na co klepnout. Mezi kusy jsou jen mezery
   * a zalomení, takže se stránka vykreslí přesně jak vypadá v souboru.
   */
  const renderReadablePage = (text: string) => {
    if (!segments.length) return renderDocumentText(text);

    const out: React.ReactNode[] = [];
    let at = 0;

    segments.forEach((segment, index) => {
      if (segment.start > at) out.push(text.slice(at, segment.start));
      const active = index === speechChunk;
      out.push(
        <span
          key={`chunk-${index}`}
          ref={active ? activeChunk : undefined}
          role="button"
          tabIndex={0}
          onClick={() => jumpToChunk(index)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            jumpToChunk(index);
          }}
          title="Číst od téhle věty"
          className={cn(
            "cursor-pointer rounded-sm transition-colors",
            active
              ? isReadingDocument
                ? "bg-brand/30 text-white"
                : "bg-white/[0.14] text-white"
              : "hover:bg-white/[0.06]",
          )}
        >
          {renderDocumentText(text.slice(segment.start, segment.end))}
        </span>,
      );
      at = segment.end;
    });

    if (at < text.length) out.push(text.slice(at));
    return out;
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
                  <SectionIcon id={sectionIcons[item.id]} className="size-4" />
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
        {activeView === "library" && !libraryReady ? (
          <div className="flex min-h-[60vh] items-center justify-center">
            <Loader2 className="size-6 animate-spin text-muted-foreground" aria-label="Načítám knihovnu" />
          </div>
        ) : null}

        {activeView === "library" && libraryReady ? (
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
            {/*
              Otevřená kniha nahradí police, nezůstane pod nimi.
              Čtení je celá obrazovka: seznam souborů nad textem je při čtení
              jen překážka, ke které se navíc pořád rolovalo zpátky.
            */}
            {activeDoc ? null : (
            <div className="mb-5">
              <h1 className="text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">Dokumenty</h1>
              <p className="mt-1.5 max-w-lg text-sm text-muted-foreground">Nahraj PDF nebo text a čti bez rozptylování. Dokument zůstane v knihovně i po zavření appky.</p>
            </div>
            )}

            {/*
              Co leží v telefonu. Ruční výběr souboru zůstává, ale jako záloha -
              knihy a skripta jsou v telefonu už teď a hledat je přes systémový
              dialog je práce navíc.
            */}
            {allFiles === false && !activeDoc ? (
              <div className="mb-6 flex flex-col items-start gap-2 rounded-2xl border border-dashed border-white/10 px-4 py-4">
                <p className="text-sm font-medium">Dokumenty v telefonu appka nevidí</p>
                <p className="max-w-lg text-xs leading-relaxed text-muted-foreground">
                  PDF ani EPUB nejsou z pohledu Androidu média, takže je povolení k hudbě nekryje.
                  Přístup ke všem souborům se povoluje v systémovém nastavení.
                </p>
                <button
                  type="button"
                  onClick={() => void MediaLibrary.requestAllFilesAccess().catch(() => {})}
                  className="mt-1 flex h-9 items-center gap-2 rounded-lg bg-brand px-3 text-xs font-semibold text-black"
                >
                  <FolderOpen className="size-3.5" /> Povolit přístup
                </button>
              </div>
            ) : null}

            {!activeDoc ? (
              <div className="mb-6">
                {/*
                  Výběr souboru patří sem, ke složkám: na jednom místě je
                  všechno, odkud se dá kniha vzít - složky v telefonu i ruční
                  výběr. Dřív bylo tlačítko nahoře a druhé dole v uvítacím
                  bloku, takže se hledalo, které z nich vlastně dělá co.
                */}
                <div className="mb-3 flex items-center gap-2">
                  <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {docFolder ? docFolder : deviceDocs.length > 0 ? "Složky" : "Knihovna"}
                  </h2>
                  <div className="ml-auto flex items-center gap-2">
                    {docFolder ? (
                      <button
                        type="button"
                        onClick={() => setDocFolder(null)}
                        className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                      >
                        <ChevronLeft className="size-3.5" /> Zpět na složky
                      </button>
                    ) : null}
                    <label className="flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.06] px-3 text-xs font-medium transition-colors hover:bg-white/10">
                      <FileUp className="size-3.5" /> Vybrat soubor
                      <input
                        type="file"
                        accept=".pdf,.txt,.md,.text,application/pdf,text/plain,text/markdown"
                        onChange={handleDocumentUpload}
                        className="hidden"
                      />
                    </label>
                  </div>
                </div>

                {deviceDocs.length === 0 ? null : docFolder === null ? (
                  <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
                    {documentFolders.map((folder) => (
                      <button
                        key={folder.name}
                        type="button"
                        onClick={() => setDocFolder(folder.name)}
                        className="flex flex-col items-center gap-1.5 rounded-xl border border-white/[0.08] px-2 py-4 text-center transition-colors hover:bg-white/[0.04]"
                      >
                        <FolderOpen className="size-7 text-brand" />
                        <span className="w-full truncate text-xs font-medium">{folder.label}</span>
                        <span className="text-[11px] text-muted-foreground">{folder.count} souborů</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
                    {deviceDocs
                      .filter((doc) => (doc.folder || "Jinde") === docFolder)
                      .map((doc) => (
                        <button
                          key={doc.id}
                          type="button"
                          onClick={() => void openDeviceDocument(doc)}
                          className="text-left"
                        >
                          <DocumentCover document={doc} className="aspect-[3/4] w-full" />
                          <span className="mt-1.5 block truncate text-xs font-medium">{doc.name}</span>
                          <span className="block text-[11px] text-muted-foreground">
                            {Math.max(1, Math.round(doc.sizeBytes / 1024 / 1024))} MB
                          </span>
                        </button>
                      ))}
                  </div>
                )}
              </div>
            ) : null}

            {documents.length > 0 && !activeDoc ? (
              /*
                Police s náhledy, ne řádka štítků: podle obálky se pozná, co je
                co, dřív než podle názvu souboru. Pruh pod dlaždicí ukazuje, kam
                až je přečteno.
              */
              <div className="mb-6 grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
                {documents.map((doc) => {
                  const at = clampPage(doc.page, doc.pages.length);
                  const read = doc.pages.length > 1 ? (at / (doc.pages.length - 1)) * 100 : 0;
                  return (
                    <div key={doc.id} className="group relative">
                      <button type="button" onClick={() => openDocument(doc)} className="w-full text-left">
                        <span
                          className={cn(
                            "relative flex aspect-[3/4] items-center justify-center overflow-hidden rounded-xl border bg-white/[0.05]",
                            doc.id === documentId_ ? "border-brand/50" : "border-white/[0.08]",
                          )}
                        >
                          {doc.thumbnail ? (
                            // eslint-disable-next-line @next/next/no-img-element -- data URI z pdf.js
                            <img src={doc.thumbnail} alt="" aria-hidden="true" loading="lazy" className="size-full object-cover" />
                          ) : (
                            <FileText className="size-7 text-muted-foreground" />
                          )}
                          <span className="absolute inset-x-0 bottom-0 h-0.5 bg-white/10">
                            <span className="block h-full bg-brand" style={{ width: `${read}%` }} />
                          </span>
                        </span>
                        <span className="mt-1.5 block truncate text-xs font-medium">{doc.name}</span>
                        <span className="block text-[11px] tabular-nums text-muted-foreground">
                          {at + 1} / {doc.pages.length}
                        </span>
                      </button>
                      {/*
                        Vidět pořád, ne až pod myší: na telefonu se najet myší
                        nedá, takže mazání dřív nešlo vůbec.
                      */}
                      <button
                        type="button"
                        onClick={() => setDocToDelete(doc)}
                        className="absolute right-1 top-1 rounded-lg bg-black/70 p-1.5 text-white/80 transition-colors hover:bg-black/85 hover:text-white"
                        aria-label={`Smazat ${doc.name} z knihovny`}
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : null}

            {/*
              Prázdná police řekne jednou větou, co dál. Velký uvítací blok
              tu byl i ve chvíli, kdy knihovna nebyla prázdná, a jen odsouval
              knihy pod okraj obrazovky.
            */}
            {!activeDoc ? (
              documents.length === 0 && deviceDocs.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-white/10 px-4 py-6 text-center text-sm text-muted-foreground">
                  Zatím tu nic není. Vyber soubor nahoře, nebo appce povol přístup k souborům v telefonu.
                </p>
              ) : null
            ) : pdfDoc ? (
              /*
                Vykreslená kniha přes celou obrazovku. Stránka se ukazuje tak,
                jak vypadá - s obrázky i sazbou - a textová vrstva nad ní dělá
                výběr, hledání a zvýraznění čtené věty.
              */
              <PdfReader
                pdf={pdfDoc}
                name={documentName ?? activeDoc.name}
                pageCount={documentPages.length}
                pageTexts={documentTexts}
                page={documentPage}
                onPage={viewPage}
                bookmarks={documentBookmarks}
                onToggleBookmark={toggleBookmark}
                aspect={activeDoc.aspect ?? 0.72}
                onClose={closeDocument}
                speech={
                  documentReadable
                    ? {
                        page: readingPage,
                        segments,
                        active: speechChunk,
                        reading: isReadingDocument,
                        onReadFrom: readFromSpot,
                        onToggle: toggleDocumentReading,
                      }
                    : undefined
                }
              />
            ) : (
              <div className="min-w-0">
                <div className="min-w-0">
                  <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={closeDocument}
                        aria-label="Zpět na knihovnu dokumentů"
                        className="flex h-8 shrink-0 items-center gap-1 rounded-lg px-2 text-xs text-muted-foreground transition-colors hover:bg-white/[0.06] hover:text-foreground"
                      >
                        <ChevronLeft className="size-4" /> Knihovna
                      </button>
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

                  {/*
                    Holý text místo vykreslené knihy není stav, který by měl
                    nastat potichu. Knize chybí soubor - buď je v knihovně
                    z doby, kdy si čtečka nechávala jen text, nebo ho uživatel
                    v telefonu smazal. Dá se to spravit, tak ať je vidět jak.
                  */}
                  {missingFile ? (
                    <div className="mb-3 flex flex-col gap-2.5 rounded-xl border border-brand/25 bg-brand/10 px-4 py-3 text-xs text-brand">
                      <span className="flex items-start gap-2">
                        <FileText className="mt-0.5 size-4 shrink-0" />
                        <span className="leading-relaxed">
                          Z tohohle dokumentu má knihovna jen vytažený text - soubor k němu chybí,
                          takže stránky nejdou vykreslit. Najdi ho a kniha se ukáže tak, jak vypadá.
                          Stránka i záložky zůstanou.
                        </span>
                      </span>
                      <label className="flex h-9 w-fit cursor-pointer items-center gap-2 rounded-lg border border-brand/40 px-3 font-medium transition-colors hover:bg-brand/15">
                        <FileUp className="size-4" /> Najít soubor
                        <input
                          type="file"
                          accept=".pdf,application/pdf"
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            event.target.value = "";
                            if (file) void attachDocumentFile(file);
                          }}
                          className="hidden"
                        />
                      </label>
                    </div>
                  ) : null}

                  <div className="reader-toolbar flex flex-wrap items-center justify-between gap-2 rounded-t-2xl border border-white/[0.08] bg-white/[0.045] px-3 py-2">
                    <div className="flex items-center gap-1">
                      <button type="button" className="reader-tool" onClick={() => setDocumentZoom((value) => Math.max(75, value - 10))} aria-label="Zmenšit"><ZoomOut className="size-4" /></button>
                      <span className="w-12 text-center text-xs tabular-nums text-muted-foreground">{documentZoom}%</span>
                      <button type="button" className="reader-tool" onClick={() => setDocumentZoom((value) => Math.min(140, value + 10))} aria-label="Zvětšit"><ZoomIn className="size-4" /></button>
                    </div>

                    <div className="flex items-center gap-1">
                      <button type="button" className={cn("reader-tool", documentBookmarks.includes(documentPage) && "text-brand")} onClick={() => toggleBookmark()} aria-label="Záložka">
                        {documentBookmarks.includes(documentPage) ? <BookmarkCheck className="size-4" /> : <Bookmark className="size-4" />}
                      </button>
                      {readablePage || isReadingDocument ? (
                        <>
                          <button type="button" className="reader-tool disabled:opacity-30" disabled={documentPage === 0} onClick={() => goToPage(documentPage - 1)} aria-label="Stránka zpět"><SkipBack className="size-4 fill-current" /></button>
                          {/* Skok po větách: klepnout se do textu dá taky, ale
                              tohle je přesnější, když se poslouchá se zhasnutým
                              displejem v ruce. */}
                          <button type="button" className="reader-tool disabled:opacity-30" disabled={speechChunk === 0} onClick={() => jumpToChunk(speechChunk - 1)} aria-label="O větu zpět"><ChevronLeft className="size-4" /></button>
                          <button
                            type="button"
                            onClick={toggleDocumentReading}
                            className={cn("flex h-8 items-center gap-2 rounded-lg px-3 text-xs font-medium transition-colors", isReadingDocument ? "bg-brand text-black" : "hover:bg-white/10")}
                            aria-label={isReadingDocument ? "Pozastavit čtení" : "Číst nahlas"}
                          >
                            {isReadingDocument ? <Pause className="size-3.5 fill-current" /> : <Play className="size-3.5 fill-current" />}
                            {isReadingDocument ? "Pauza" : speechChunk > 0 ? "Pokračovat" : "Číst nahlas"}
                          </button>
                          <button type="button" className="reader-tool disabled:opacity-30" disabled={speechChunk >= chunks.length - 1} onClick={() => jumpToChunk(speechChunk + 1)} aria-label="O větu vpřed"><ChevronRight className="size-4" /></button>
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
                          {/* Hlas se řeší tady, u čtení - ne v nastavení celé appky. */}
                          <button type="button" className="reader-tool" onClick={() => setVoiceOpen(true)} aria-label="Hlas předčítání">
                            <Volume2 className="size-4" />
                          </button>
                        </>
                      ) : (
                        <span className="px-2 text-[11px] text-muted-foreground">čtení nahlas nejde</span>
                      )}
                    </div>
                  </div>

                  <div className="reader-paper min-h-[520px] overflow-auto rounded-b-2xl border-x border-b border-white/[0.08] p-6 shadow-2xl sm:p-12">
                    <article className="mx-auto max-w-2xl origin-top transition-transform" style={{ transform: `scale(${documentZoom / 100})`, transformOrigin: "top center", marginBottom: `${(documentZoom - 100) * 3}px` }}>
                      <p className="mb-8 text-xs font-semibold uppercase tracking-[0.18em] text-brand">{activeDocument?.label}</p>
                      <div className="whitespace-pre-wrap font-serif text-[1.04rem] leading-[1.9] text-white/90">
                        {activeDocument
                          ? readablePage
                            ? renderReadablePage(activeDocument.text)
                            : renderDocumentText(activeDocument.text)
                          : ""}
                      </div>
                    </article>
                  </div>

                  <div className="mt-4 flex items-center justify-between">
                    <button type="button" disabled={documentPage === 0} onClick={() => goToPage(documentPage - 1)} className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs text-muted-foreground hover:bg-white/[0.05] hover:text-foreground disabled:opacity-30"><ChevronLeft className="size-4" /> Předchozí</button>
                    <button
                      type="button"
                      onClick={() => setPagesOpen(true)}
                      className="rounded-lg px-3 py-2 text-xs tabular-nums text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {documentPage + 1} / {documentPages.length}
                    </button>
                    <button type="button" disabled={documentPage === documentPages.length - 1} onClick={() => goToPage(documentPage + 1)} className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs text-muted-foreground hover:bg-white/[0.05] hover:text-foreground disabled:opacity-30">Další <ChevronRight className="size-4" /></button>
                  </div>
                </div>
              </div>
            )}

            {/*
              Okno o průběhu, ne jen mlha přes obrazovku. Velká kniha se otevírá
              vteřiny a bez čísla to vypadá, že se appka zasekla - proto je vidět,
              co se zrovna děje a kolik z toho je hotové. Dokud se procenta
              spočítat nedají, běží pruh sám od sebe.
            */}
            {isLoadingDocument ? (
              <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/45 px-8 backdrop-blur-sm">
                <div className="flex w-full max-w-xs flex-col gap-3 rounded-2xl border border-white/10 bg-popover px-5 py-4 shadow-xl">
                  <div className="flex items-center gap-3 text-sm">
                    <Loader2 className="size-4 shrink-0 animate-spin text-brand" />
                    <span className="min-w-0 flex-1 truncate">{documentProgress.label}</span>
                    {documentProgress.percent !== null ? (
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {documentProgress.percent} %
                      </span>
                    ) : null}
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                    {documentProgress.percent !== null ? (
                      <div
                        className="h-full rounded-full bg-brand transition-[width] duration-200"
                        style={{ width: `${documentProgress.percent}%` }}
                      />
                    ) : (
                      <div className="progress-drift h-full w-1/3 rounded-full bg-brand" />
                    )}
                  </div>
                </div>
              </div>
            ) : null}
            {documentError ? <div className="mt-4 flex items-center gap-2 rounded-xl border border-brand/30 bg-brand/10 px-4 py-3 text-xs text-brand"><X className="size-4" /> {documentError}</div> : null}
          </section>
        ) : null}

        {activeView === "video" && addons.video ? (
          <VideoLibrary onBeforePlay={silenceEverything} onToast={toast} onPlayerChange={trackVideoPlayer} layout={videoLayout} />
        ) : null}

        {activeView === "downloads" && addons.downloads ? (
          <DownloadView onToast={toast} onDownloaded={() => void loadDeviceMusic()} />
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
        {/*
          Lišta patří k tomu, co je na obrazovce. V knihovně ukazuje hudbu,
          a to teprve od chvíle, kdy si uživatel nějakou skladbu pustí -
          po otevření appky nemá co hlásit. Ve videu a v dokumentech by jen
          zabírala místo věcem, které mají vlastní přehrávač.
        */}
        {activeView === "library" && hasTrack && playbackStarted ? (
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
        ) : null}

        {activeView === "reader" && documentName && !pdfDoc ? (
          <button
            type="button"
            onClick={toggleDocumentReading}
            className="player-dock flex w-full items-center gap-3 border-t border-white/[0.09] px-4 py-2.5 text-left"
          >
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-white/[0.06] text-brand">
              <FileText className="size-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{documentName}</span>
              <span className="block truncate text-xs text-muted-foreground">
                strana {documentPage + 1} z {documentPages.length}
              </span>
            </span>
            {readablePage || isReadingDocument ? (
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-foreground text-background">
                {isReadingDocument ? <Pause className="size-4 fill-current" /> : <Play className="ml-0.5 size-4 fill-current" />}
              </span>
            ) : null}
          </button>
        ) : null}

        {views.length > 1 ? (
          <nav className="border-t border-white/[0.07] sm:hidden">
            <div className="mx-auto flex w-full max-w-4xl">
              {views.map((item) => {
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
                      <SectionIcon id={sectionIcons[item.id]} className="size-5" />
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

      <audio ref={audioRef} src={playsNatively(currentTrack) ? undefined : currentTrack.src || undefined} preload="metadata" loop={repeatMode === "one"} onPlay={() => { logPlayback("element: hraje"); setIsPlaying(true); }} onPause={() => { logPlayback("element: pauza"); setIsPlaying(false); }} onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)} onLoadedMetadata={(event) => { const nextDuration = event.currentTarget.duration; if (Number.isFinite(nextDuration)) { setDuration(nextDuration); setTracks((previous) => previous.map((track) => track.id === currentTrackId ? { ...track, durationSeconds: nextDuration, duration: formatTime(nextDuration) } : track)); } if (pendingSeek.current > 0) { const seekTo = Math.min(pendingSeek.current, nextDuration || pendingSeek.current); pendingSeek.current = 0; event.currentTarget.currentTime = seekTo; setCurrentTime(seekTo); } }} onEnded={() => { logPlayback("element: konec skladby"); handleEnded(); }} onStalled={() => logPlayback("element: uvázl")} onError={() => { logPlayback(`element: chyba (kód ${audioRef.current?.error?.code ?? "?"})`); if (currentTrack.id !== EMPTY_TRACK.id) toast({ tone: "warn", title: "Audio soubor není dostupný", description: "Zkontroluj, jestli je skladba stále v zařízení." }); }} className="hidden" />

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
        open={docToDelete !== null}
        onOpenChange={(open) => {
          if (!open) setDocToDelete(null);
        }}
        title="Smazat z knihovny?"
        description={docToDelete?.name}
        footer={
          <>
            <Button variant="outline" onClick={() => setDocToDelete(null)}>
              Nechat
            </Button>
            <Button
              onClick={() => {
                const doomed = docToDelete;
                setDocToDelete(null);
                if (doomed) void forgetDocument(doomed.id);
              }}
            >
              Smazat
            </Button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-muted-foreground">
          Zmizí z knihovny i se záložkami a s uloženou kopií. Soubor v telefonu zůstane, kde je -
          smaže se jen to, co si o něm drží appka.
        </p>
      </Dialog>

      <Dialog
        open={voiceOpen}
        onOpenChange={setVoiceOpen}
        title="Hlas předčítání"
        description="Platí pro čtení dokumentů nahlas."
      >
        <SpeechSettings open={voiceOpen} />
      </Dialog>

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

      <Sheet
        open={pagesOpen}
        onOpenChange={setPagesOpen}
        title="Stránky"
        description={documentName ?? undefined}
      >
        {/*
          Přehled na vyžádání, ne věčný sloupec vedle textu: stránky mají smysl
          ve chvíli, kdy uživatel chce skočit jinam. Klepnutí přeskočí a čtení
          nahlas pokračuje odtamtud.
        */}
        <div className="grid grid-cols-5 gap-2 pb-1 sm:grid-cols-8">
          {documentPages.map((page, index) => (
            <button
              key={index}
              type="button"
              onClick={() => {
                goToPage(index);
                setPagesOpen(false);
              }}
              aria-label={page.label}
              className={cn(
                "relative flex h-11 items-center justify-center rounded-xl border text-xs tabular-nums transition-colors",
                index === documentPage
                  ? "border-brand bg-brand/15 text-brand"
                  : "border-white/[0.08] text-muted-foreground hover:bg-accent",
              )}
            >
              {index + 1}
              {documentBookmarks.includes(index) ? (
                <BookmarkCheck className="absolute right-0.5 top-0.5 size-3 text-brand" />
              ) : null}
            </button>
          ))}
        </div>
      </Sheet>

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        addons={addons}
        onAddonChange={handleAddonChange}
        mediaPermission={mediaPermission}
        onRequestMediaAccess={requestMediaAccess}
        onSectionIconsChange={setSectionIcons}
        onVideoLayoutChange={setVideoLayout}
      />
    </div>
  );
}
