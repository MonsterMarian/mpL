"use client";

import * as React from "react";
import { AlertTriangle, Check, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import * as liveUpdate from "@/lib/live-update";
import { askForNotifications, playbackSupport, type PlaybackSupport } from "@/lib/playback-service";
import { SectionIcon } from "@/components/ui/section-icon";
import {
  SECTION_ICONS,
  loadSectionIcons,
  saveSectionIcons,
  type SectionIconId,
  type SectionIcons,
  type SectionId,
} from "@/lib/section-icons";
import { loadUnifiedLook, saveUnifiedLook } from "@/lib/look";
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
      /*
        Místo pod obsahem, ať se dá vytáhnout nahoru.
        Poslední přepínač sedí u dolní hrany přesně tam, kde má čtenář palec,
        kterým roluje - přečíst ho znamenalo dívat se pod vlastní ruku. S touhle
        rezervou se konec kterékoli záložky dá odrolovat do pohodlné výšky.
      */
      className="pb-[calc(33dvh+var(--mw-safe-bottom))]"
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
            <SystemPlaybackSection open={open} />
            <UpdateSection />
          </div>
        ) : (
          <div className="flex flex-col gap-5 animate-in-up">
            <Section title="Addony" hint="Vypnutá část zmizí i se svou záložkou; data zůstanou.">
              <AddonChoice addons={addons} onAddonChange={onAddonChange} />
            </Section>

            <Section title="Ikony sekcí" hint="Volba se projeví hned ve spodní liště.">
              <SectionIconChoice open={open} onChange={onSectionIconsChange} />
            </Section>

            <Section title="Vzhled" hint="Zkušební přepínač: porovnej starou a sjednocenou podobu.">
              <UnifiedLookToggle open={open} />
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
          <span className="font-medium text-foreground">Přístup k hudbě</span>
          <PermissionState
            granted={mediaPermission === "granted"}
            label={mediaPermission === "denied" ? "Zamítnuto" : mediaPermission === "unavailable" ? "Prohlížeč" : "Čeká"}
          />
        </div>
        {mediaPermission === "granted" ? null : (
          <Button
            type="button"
            disabled={isRequestingMedia || mediaPermission === "unavailable"}
            onClick={handleRequestMediaAccess}
            className="mt-2"
          >
            {isRequestingMedia ? "Čekám…" : mediaPermission === "denied" ? "Otevřít nastavení" : "Povolit přístup"}
          </Button>
        )}
      </div>
    </Section>
  );
}

/** Stav oprávnění: povolené jako štítek s fajfkou, ostatní jen šedým textem. */
function PermissionState({ granted, label }: { granted: boolean; label: string }) {
  if (!granted) return <span className="text-xs font-medium text-muted-foreground">{label}</span>;
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-brand/15 px-2 py-0.5 text-xs font-medium text-brand">
      <Check className="size-3.5" /> Povoleno
    </span>
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
      {ADDONS.map((addon) => (
        <ToggleRow
          key={addon.id}
          label={addon.label}
          hint={addon.hint}
          on={addons[addon.id]}
          onToggle={(on) => {
            saveAddon(addon.id, on);
            onAddonChange?.(addon.id, on);
          }}
        />
      ))}
    </div>
  );
}

function ToggleRow({
  label,
  hint,
  on,
  onToggle,
}: {
  label: string;
  hint: string;
  on: boolean;
  onToggle: (on: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onToggle(!on)}
      aria-pressed={on}
      className={cn(
        "flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
        on ? "border-foreground/40 bg-accent" : "hover:bg-accent/50",
      )}
    >
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
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
}

function UnifiedLookToggle({ open }: { open: boolean }) {
  const [on, setOn] = React.useState(false);

  React.useEffect(() => {
    if (open) setOn(loadUnifiedLook());
  }, [open]);

  return (
    <ToggleRow
      label="Sjednocený vzhled"
      hint="Oranžová tlačítka, „Vybrat soubor“, přepínače a nadpisy stránek v jedné podobě."
      on={on}
      onToggle={(next) => {
        setOn(next);
        saveUnifiedLook(next);
      }}
    />
  );
}

/**
 * Vlastní ikona pro každou sekci.
 *
 * Sáhnout uživateli na ikony bez ptaní byl omyl - tvar, který jednomu sedí,
 * druhého tahá za oči. Výchozí zůstávají ty původní.
 */
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
          <PermissionState granted={granted} label={support.notifications === "denied" ? "Zamítnuto" : "Čeká"} />
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

function UpdateSection() {
  const [current, setCurrent] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState<string | null>(null);
  const [checking, setChecking] = React.useState(false);
  const [statusMsg, setStatusMsg] = React.useState("");

  React.useEffect(() => {
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
    setChecking(true);
    const res = await liveUpdate.checkForUpdate();
    setChecking(false);
    const waiting = liveUpdate.pendingBundleVersion();
    setPending(waiting);

    if (res.kind === "downloaded") {
      setStatusMsg("Aktualizace stažena. Změny se projeví po restartu.");
    } else if (res.kind === "up-to-date") {
      // „up-to-date" přijde i ve chvíli, kdy nejnovější verze je stažená a jen čeká na nasazení
      setStatusMsg(waiting ? "Nejnovější verze je stažená, stačí ji nasadit." : "Máš nejnovější verzi.");
    } else if (res.kind === "disabled") {
      setStatusMsg("Chybí adresa aktualizací.");
    } else {
      setStatusMsg("Chyba: " + res.message);
    }
  };

  return (
    <Section title="Aktualizace" hint="Appka si při startu sama stáhne novou verzi.">
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
    </Section>
  );
}
