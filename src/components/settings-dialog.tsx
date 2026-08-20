"use client";

import * as React from "react";
import { AlertTriangle, RefreshCw, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import * as liveUpdate from "@/lib/live-update";
import {
  clearErrors,
  clearPlaybackLog,
  readErrors,
  readPlaybackLog,
  type LoggedError,
  type PlaybackEvent,
} from "@/lib/diagnostics";
import { askForNotifications, playbackSupport, type PlaybackSupport } from "@/lib/playback-service";
import { clearNativeCrash, lastNativeCrash } from "@/lib/stream";
import {
  DEFAULT_LANGUAGE,
  listVoices,
  previewVoice,
  setSpeechLanguage,
  setSpeechVoiceId,
  speechLanguage,
  speechVoiceId,
  type SpeechVoice,
} from "@/lib/speech";
import { SectionIcon } from "@/components/ui/section-icon";
import {
  SECTION_ICONS,
  loadSectionIcons,
  saveSectionIcons,
  type SectionIconId,
  type SectionIcons,
  type SectionId,
} from "@/lib/section-icons";
import { cn } from "@/lib/utils";

type Tab = "main" | "addons";

// Vzhled se nenastavuje: appka má jediné téma - černá, bílá, žlutá.
const TABS: { id: Tab; label: string }[] = [
  { id: "main", label: "Hlavní" },
  { id: "addons", label: "Addony" },
];

/**
 * Vypínatelné části appky. Přidání dalšího addonu je jeden řádek tady -
 * obrazovka nastavení i záložky v appce jedou z tohohle seznamu.
 */
export type AddonId = "reader" | "video" | "downloads";

export const ADDONS: { id: AddonId; label: string; hint: string; storageKey: string }[] = [
  {
    id: "reader",
    label: "Čtečka dokumentů",
    hint: "PDF a TXT soubory, offline čtení",
    storageKey: "microwins:reader_addon",
  },
  {
    id: "video",
    label: "Video",
    hint: "MP4 ze zařízení i z vybraného souboru",
    storageKey: "microwins:video_addon",
  },
  {
    id: "downloads",
    label: "Stahování",
    hint: "Přímý odkaz na MP3 nebo MP4",
    storageKey: "microwins:downloads_addon",
  },
];

export type Addons = Record<AddonId, boolean>;

/** Chybějící volba = zapnuto. Nový addon nemá uživateli zhasnout sám od sebe. */
export function loadAddons(): Addons {
  const read = (key: string) => {
    try {
      return localStorage.getItem(key) !== "false";
    } catch {
      return true;
    }
  };
  return Object.fromEntries(ADDONS.map((a) => [a.id, read(a.storageKey)])) as Addons;
}

export function saveAddon(id: AddonId, enabled: boolean): void {
  const addon = ADDONS.find((a) => a.id === id);
  if (!addon) return;
  try {
    localStorage.setItem(addon.storageKey, enabled ? "true" : "false");
  } catch {
    // soukromý režim - volba vydrží do zavření appky
  }
}

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  addons?: Addons;
  onAddonChange?: (id: AddonId, enabled: boolean) => void;
  mediaPermission?: "unknown" | "granted" | "denied" | "unavailable";
  onRequestMediaAccess?: () => Promise<void> | void;
  onSectionIconsChange?: (icons: SectionIcons) => void;
}

export function SettingsDialog({
  open,
  onOpenChange,
  addons = { reader: true, video: true, downloads: true },
  onAddonChange,
  mediaPermission = "unknown",
  onRequestMediaAccess,
  onSectionIconsChange,
}: SettingsDialogProps) {
  const [activeTab, setActiveTab] = React.useState<Tab>("main");
  
  React.useEffect(() => {
    if (!open) {
      setActiveTab("main");
    }
  }, [open]);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Nastavení"
      description="Úprava P/_ayer podle tvého poslechu."
      fullScreen
    >
      <div className="flex flex-col gap-5">
        <div className="flex gap-1 border-b">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "-mb-px border-b-2 px-3 py-2 text-sm transition-colors",
                activeTab === tab.id
                  ? "border-foreground font-medium text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === "main" ? (
          <div className="flex flex-col gap-5 animate-in-up">
            <MediaSection 
              mediaPermission={mediaPermission} 
              onRequestMediaAccess={onRequestMediaAccess} 
            />
            <SpeechSection open={open} />
            <SystemPlaybackSection open={open} />
            <PlaybackLogSection open={open} />
            <NativeCrashSection open={open} />
            <UpdateSection />
            <ErrorSection open={open} />
          </div>
        ) : (
          <div className="flex flex-col gap-5 animate-in-up">
            <Section title="Addony" hint="Vypnutá část zmizí i se svou záložkou; data zůstanou.">
              <AddonChoice addons={addons} onAddonChange={onAddonChange} />
            </Section>

            <Section title="Ikony sekcí" hint="Volba se projeví hned ve spodní liště.">
              <SectionIconChoice open={open} onChange={onSectionIconsChange} />
            </Section>
          </div>
        )}
      </div>
    </Dialog>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
      {hint ? <p className="px-1 text-xs text-muted-foreground">{hint}</p> : null}
    </section>
  );
}

function MediaSection({ 
  mediaPermission, 
  onRequestMediaAccess 
}: { 
  mediaPermission: string;
  onRequestMediaAccess?: () => Promise<void> | void;
}) {
  const [isRequestingMedia, setIsRequestingMedia] = React.useState(false);

  const handleRequestMediaAccess = async () => {
    if (!onRequestMediaAccess || isRequestingMedia) return;
    setIsRequestingMedia(true);
    try {
      await onRequestMediaAccess();
    } finally {
      setIsRequestingMedia(false);
    }
  };

  return (
    <Section title="Hudba ze zařízení" hint="Povol přístup, ať P/_ayer najde stažené skladby v telefonu.">
      <div className="flex flex-col gap-2 rounded-lg border px-3 py-2.5 text-sm">
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium text-foreground">Lokální poslech</span>
          <span className={cn("text-xs font-medium", mediaPermission === "granted" ? "text-win" : "text-muted-foreground")}>
             {mediaPermission === "granted" ? "Povolený" : mediaPermission === "denied" ? "Zamítnutý" : mediaPermission === "unavailable" ? "Prohlížeč" : "Čeká"}
          </span>
        </div>
        <Button 
          type="button" 
          variant={mediaPermission === "granted" ? "outline" : "default"} 
          disabled={isRequestingMedia || mediaPermission === "unavailable"} 
          onClick={handleRequestMediaAccess}
          className="mt-2"
        >
          {isRequestingMedia ? "Čekám…" : mediaPermission === "denied" ? "Otevřít nastavení" : mediaPermission === "granted" ? "Obnovit" : "Povolit přístup"}
        </Button>
      </div>
    </Section>
  );
}

function AddonChoice({
  addons,
  onAddonChange,
}: {
  addons: Addons;
  onAddonChange?: (id: AddonId, enabled: boolean) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      {ADDONS.map((addon) => {
        const on = addons[addon.id];
        return (
          <button
            key={addon.id}
            type="button"
            onClick={() => {
              saveAddon(addon.id, !on);
              onAddonChange?.(addon.id, !on);
            }}
            aria-pressed={on}
            className={cn(
              "flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
              on ? "border-foreground/40 bg-accent" : "hover:bg-accent/50",
            )}
          >
            <span className="min-w-0">
              <span className="block text-sm font-medium">{addon.label}</span>
              <span className="block text-xs text-muted-foreground">{addon.hint}</span>
            </span>
            <span
              className={cn(
                "relative h-6 w-11 shrink-0 rounded-full transition-colors",
                on ? "bg-brand" : "bg-muted-foreground/30",
              )}
            >
              <span
                className={cn(
                  "absolute top-1 size-4 rounded-full bg-black shadow transition-[left] duration-200",
                  on ? "left-6" : "left-1",
                )}
              />
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Vlastní ikona pro každou sekci.
 *
 * Sáhnout uživateli na ikony bez ptaní byl omyl - tvar, který jednomu sedí,
 * druhého tahá za oči. Výchozí zůstávají ty původní.
 */
/**
 * Hlas a jazyk předčítání.
 *
 * Hlasy dodává hlasový modul telefonu, ne appka - co je v nabídce, závisí na
 * tom, co má kdo doinstalované. Seznam se proto čte ze zařízení a nedrží se
 * jako pevný výčet: napevno zadaná čeština znamená na telefonu bez českého
 * hlasu jen ticho, a nikde by se nedalo poznat proč.
 *
 * Jména hlasů jsou přitom nicneříkající (`cs-cz-x-jfk#female_1`), takže k volbě
 * patří tlačítko, které je nechá promluvit.
 */
function SpeechSection({ open }: { open: boolean }) {
  const [voices, setVoices] = React.useState<SpeechVoice[] | null>(null);
  const [lang, setLang] = React.useState(DEFAULT_LANGUAGE);
  const [voice, setVoice] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setLang(speechLanguage());
    setVoice(speechVoiceId());
    void listVoices().then(setVoices);
  }, [open]);

  const pickLanguage = (next: string) => {
    setLang(next);
    setSpeechLanguage(next);
    // Hlas z jiného jazyka by novou volbu přebil - vybraný hlas totiž určuje
    // i jazyk, kterým se mluví.
    if (voice && !voice.startsWith(`${next}|`)) {
      setVoice(null);
      setSpeechVoiceId(null);
    }
  };

  const pickVoice = (next: string) => {
    const value = next || null;
    setVoice(value);
    setSpeechVoiceId(value);
  };

  if (!voices) {
    return (
      <Section title="Hlas předčítání">
        <p className="px-1 text-xs text-muted-foreground">Ptám se zařízení, co umí…</p>
      </Section>
    );
  }

  if (!voices.length) {
    return (
      <Section title="Hlas předčítání" hint="Hlasy dodává systém. V Androidu je najdeš v Nastavení → Usnadnění → Převod textu na řeč.">
        <p className="px-1 text-xs text-muted-foreground">
          Zařízení nehlásí žádný hlas. Předčítání pojede tím, co si systém vybere sám.
        </p>
      </Section>
    );
  }

  const languages = [...new Set([DEFAULT_LANGUAGE, ...voices.map((item) => item.lang)])].sort();
  const forLanguage = voices.filter((item) => item.lang === lang);

  return (
    <Section title="Hlas předčítání" hint="Vybraný hlas určuje i jazyk, kterým se čte. Vyzkoušej ho - podle jména se poznat nedá.">
      <div className="flex flex-col gap-2 rounded-lg border px-3 py-2.5">
        <label className="flex items-center justify-between gap-3 text-sm">
          Jazyk
          <select
            value={lang}
            onChange={(event) => pickLanguage(event.target.value)}
            className="h-9 min-w-0 flex-1 rounded-lg border border-white/10 bg-transparent px-2 text-xs outline-none"
          >
            {languages.map((item) => (
              <option key={item} value={item} className="bg-black">{item}</option>
            ))}
          </select>
        </label>

        <label className="flex items-center justify-between gap-3 text-sm">
          Hlas
          <select
            value={voice ?? ""}
            onChange={(event) => pickVoice(event.target.value)}
            className="h-9 min-w-0 flex-1 rounded-lg border border-white/10 bg-transparent px-2 text-xs outline-none"
          >
            <option value="" className="bg-black">Systémový</option>
            {forLanguage.map((item) => (
              <option key={item.id} value={item.id} className="bg-black">{item.name}</option>
            ))}
          </select>
        </label>

        {forLanguage.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            K jazyku {lang} zařízení žádný hlas nemá. Doinstaluj ho v systému, jinak zůstane ticho.
          </p>
        ) : null}

        <Button variant="outline" size="sm" className="self-start" onClick={() => void previewVoice()}>
          <Volume2 className="size-4" /> Vyzkoušet
        </Button>
      </div>
    </Section>
  );
}

function SectionIconChoice({ open, onChange }: { open: boolean; onChange?: (icons: SectionIcons) => void }) {
  const [icons, setIcons] = React.useState<SectionIcons | null>(null);

  React.useEffect(() => {
    if (open) setIcons(loadSectionIcons());
  }, [open]);

  if (!icons) return null;

  const sections: { id: SectionId; label: string }[] = [
    { id: "library", label: "Knihovna" },
    { id: "reader", label: "Dokumenty" },
    { id: "video", label: "Video" },
    { id: "downloads", label: "Stahování" },
  ];

  const pick = (section: SectionId, icon: SectionIconId) => {
    const next = { ...icons, [section]: icon };
    setIcons(next);
    saveSectionIcons(next);
    onChange?.(next);
  };

  return (
    <div className="flex flex-col gap-3">
      {sections.map((section) => (
        <div key={section.id} className="rounded-lg border px-3 py-2.5">
          <p className="mb-2 text-sm font-medium">{section.label}</p>
          <div className="flex gap-2">
            {SECTION_ICONS[section.id].map((choice) => {
              const active = icons[section.id] === choice.id;
              return (
                <button
                  key={choice.id}
                  type="button"
                  onClick={() => pick(section.id, choice.id)}
                  aria-label={choice.label}
                  title={choice.label}
                  aria-pressed={active}
                  className={cn(
                    "flex size-11 items-center justify-center rounded-xl border transition-colors",
                    active ? "border-brand bg-brand/15 text-brand" : "text-muted-foreground hover:bg-accent",
                  )}
                >
                  <SectionIcon id={choice.id} className="size-5" />
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Ovládání v notifikaci a na zamykací obrazovce.
 *
 * Nativní část přijde jen s novým APK - živá aktualizace veze pouze web. Bez
 * téhle sekce se to pozná jedině tak, že „to nefunguje": volání do pluginu,
 * který v APK není, tiše spadne a nikde se neukáže nic.
 */
function SystemPlaybackSection({ open }: { open: boolean }) {
  const [support, setSupport] = React.useState<PlaybackSupport | null>(null);
  const refresh = React.useCallback(() => {
    void playbackSupport().then(setSupport);
  }, []);

  React.useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  if (!support || !support.native) return null;

  if (!support.plugin) {
    return (
      <Section title="Ovládání v systému" hint="Nativní část se vyměňuje jen instalací APK, živá aktualizace ji nepřenese.">
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Chybí v téhle instalaci.</span> Přehrávač se v notifikaci
            ani na zámku neukáže, dokud nenainstaluješ novější APK.
          </p>
        </div>
      </Section>
    );
  }

  const granted = support.notifications === "granted";
  return (
    <Section title="Ovládání v systému" hint="Název, obal, posuvník a tlačítka v notifikaci i na zamykací obrazovce.">
      <div className="flex flex-col gap-2 rounded-lg border px-3 py-2.5 text-sm">
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium text-foreground">Notifikace</span>
          <span className={cn("text-xs font-medium", granted ? "text-win" : "text-muted-foreground")}>
            {granted ? "Povolené" : support.notifications === "denied" ? "Zamítnuté" : "Čeká"}
          </span>
        </div>
        {granted ? null : (
          <Button
            type="button"
            className="mt-1"
            onClick={async () => {
              await askForNotifications();
              refresh();
            }}
          >
            Povolit notifikace
          </Button>
        )}
      </div>
    </Section>
  );
}

/**
 * Poslední pád nativní části.
 *
 * Pád v Javě appku zavře a nezůstane po něm nic, co by šlo z telefonu přečíst.
 * Tady je výpis, který se dá zkopírovat a poslat - jinak se hledá poslepu.
 */
function NativeCrashSection({ open }: { open: boolean }) {
  const [crash, setCrash] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) void lastNativeCrash().then(setCrash);
  }, [open]);

  if (!crash) return null;

  const newline = String.fromCharCode(10);
  const [stamp, ...rest] = crash.split(newline);
  const when = Number(stamp);
  const trace = rest.join(newline);

  return (
    <Section title="Poslední pád appky" hint="Tohle mi pošli, když appka spadne - je z toho vidět, kde přesně.">
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
        <div className="flex items-center gap-2 text-xs text-destructive">
          <AlertTriangle className="size-3.5 shrink-0" />
          <span className="tabular-nums">
            {Number.isFinite(when) ? new Date(when).toLocaleString("cs") : "neznámo kdy"}
          </span>
        </div>
        <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[10px] leading-relaxed text-muted-foreground">
          {trace}
        </pre>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={() => void navigator.clipboard?.writeText(crash)}>
          Zkopírovat
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            void clearNativeCrash();
            setCrash(null);
          }}
        >
          Vymazat
        </Button>
      </div>
    </Section>
  );
}

/**
 * Průběh přehrávání.
 *
 * Když hudba zhasne sama, tohle je jediné místo, ze kterého jde poznat proč:
 * je v něm vidět pořadí - kdo dal pokyn, co udělal přehrávač a co hlásila
 * služba. Časy jsou relativní k prvnímu záznamu, protože zajímavé je odstupem,
 * ne kolik bylo hodin.
 */
function PlaybackLogSection({ open }: { open: boolean }) {
  const [events, setEvents] = React.useState<PlaybackEvent[]>([]);

  React.useEffect(() => {
    if (open) setEvents(readPlaybackLog());
  }, [open]);

  if (!events.length) return null;

  const start = events[0].at;
  const line = (event: PlaybackEvent) => `+${((event.at - start) / 1000).toFixed(2)} s  ${event.text}`;

  return (
    <Section title="Průběh přehrávání" hint="Když se hudba sama zastaví, zkopíruj tohle - je z toho vidět, kdo ji zastavil.">
      <div className="max-h-56 overflow-y-auto rounded-lg border bg-white/[0.02] p-3">
        {events.map((event, index) => (
          <p key={`${event.at}-${index}`} className="whitespace-pre font-mono text-[11px] leading-relaxed text-muted-foreground">
            {line(event)}
          </p>
        ))}
      </div>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => void navigator.clipboard?.writeText(events.map(line).join("\n"))}
        >
          Zkopírovat
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            clearPlaybackLog();
            setEvents([]);
          }}
        >
          Vymazat
        </Button>
      </div>
    </Section>
  );
}

/**
 * Co appku naposledy položilo.
 *
 * V telefonu není konzole a bílá obrazovka neřekne nic - tohle je jediné
 * místo, odkud se dá pád popsat, aniž by se telefon připojoval kabelem.
 * Když je čisto, sekce se vůbec nekreslí.
 */
function ErrorSection({ open }: { open: boolean }) {
  const [errors, setErrors] = React.useState<LoggedError[]>([]);

  React.useEffect(() => {
    if (open) setErrors(readErrors());
  }, [open]);

  if (!errors.length) return null;

  return (
    <Section title="Poslední chyby" hint="Zkopíruj a pošli, když appka spadne - jinak není podle čeho hledat.">
      <div className="flex flex-col gap-2">
        {errors.map((error) => (
          <div key={error.at} className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
            <div className="flex items-center gap-2 text-xs text-destructive">
              <AlertTriangle className="size-3.5 shrink-0" />
              <span className="tabular-nums">{new Date(error.at).toLocaleString("cs")}</span>
            </div>
            <p className="mt-1 break-words font-mono text-[11px] leading-relaxed text-muted-foreground">{error.message}</p>
            {error.source ? <p className="mt-0.5 break-all font-mono text-[10px] text-muted-foreground/70">{error.source}</p> : null}
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void navigator.clipboard?.writeText(
              errors.map((e) => `${new Date(e.at).toISOString()} ${e.message}${e.source ? ` (${e.source})` : ""}`).join("\n"),
            );
          }}
        >
          Zkopírovat
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            clearErrors();
            setErrors([]);
          }}
        >
          Vymazat
        </Button>
      </div>
    </Section>
  );
}

function UpdateSection() {
  const [url, setUrl] = React.useState("");
  const [current, setCurrent] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState<string | null>(null);
  const [checking, setChecking] = React.useState(false);
  const [statusMsg, setStatusMsg] = React.useState("");

  const DEFAULT_URL = liveUpdate.DEFAULT_UPDATE_URL || "";

  React.useEffect(() => {
    setUrl(liveUpdate.getUpdateUrl());
    setCurrent(liveUpdate.currentBundleVersion());
    setPending(liveUpdate.pendingBundleVersion());
  }, []);

  const onApply = async () => {
    const res = await liveUpdate.applyPendingUpdate();
    if (res.error) {
      setStatusMsg("Nasazení selhalo: " + res.error);
      setPending(liveUpdate.pendingBundleVersion());
      setCurrent(liveUpdate.currentBundleVersion());
    } else if (!res.applied) {
      setStatusMsg("Tahle verze už běží");
      setPending(null);
    }
  };

  const onCheck = async () => {
    liveUpdate.setUpdateUrl(url);
    setChecking(true);
    const res = await liveUpdate.checkForUpdate();
    setChecking(false);
    setPending(liveUpdate.pendingBundleVersion());

    if (res.kind === "downloaded") {
      setStatusMsg("Aktualizace stažena. Změny se projeví po restartu.");
    } else if (res.kind === "up-to-date") {
      setStatusMsg("Máš nejnovější verzi.");
    } else if (res.kind === "disabled") {
      setStatusMsg("Chybí adresa aktualizací.");
    } else {
      setStatusMsg("Chyba: " + res.message);
    }
  };

  return (
    <Section
      title="Aktualizace z GitHubu"
      hint="Appka si při startu sama stáhne novou verzi."
    >
      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
          Adresa manifestu {url === DEFAULT_URL ? "(výchozí)" : "(vlastní)"}
        </summary>
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onBlur={() => liveUpdate.setUpdateUrl(url)}
          placeholder={DEFAULT_URL}
          autoComplete="off"
          spellCheck={false}
          className="mt-2 font-mono text-xs"
        />
        {url !== DEFAULT_URL && (DEFAULT_URL as string) !== "" ? (
          <button
            type="button"
            onClick={() => {
              setUrl(DEFAULT_URL);
              liveUpdate.setUpdateUrl(DEFAULT_URL);
            }}
            className="mt-1.5 text-muted-foreground hover:text-foreground"
          >
            Vrátit výchozí adresu
          </button>
        ) : null}
      </details>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" disabled={checking} onClick={onCheck}>
          <RefreshCw className={cn("size-4 mr-2", checking && "animate-spin")} />
          {checking ? "Hledám…" : "Zkontrolovat teď"}
        </Button>
        {pending ? (
          <Button size="sm" onClick={onApply}>
            Nasadit {pending}
          </Button>
        ) : null}
        <span className="tabular text-xs text-muted-foreground">
          {pending ? `čeká ${pending}` : current ? `verze ${current}` : "verze z APK"}
        </span>
      </div>
      
      {statusMsg && <div className="text-xs text-brand mt-1">{statusMsg}</div>}

      {current || pending ? (
        <button
          type="button"
          onClick={async () => {
            if (confirm("Opravdu vrátit aplikaci na původní APK?")) {
               await liveUpdate.revertToBundled();
               setCurrent(null);
               setPending(null);
               setStatusMsg("Bude nasazena verze z APK po restartu.");
            }
          }}
          className="self-start px-1 py-1 text-xs text-destructive hover:text-destructive/80"
        >
          Vrátit se k verzi z APK
        </button>
      ) : null}
    </Section>
  );
}
