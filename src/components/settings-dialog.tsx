"use client";

import * as React from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import * as liveUpdate from "@/lib/live-update";
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
export type AddonId = "reader" | "video";

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
}

export function SettingsDialog({
  open,
  onOpenChange,
  addons = { reader: true, video: true },
  onAddonChange,
  mediaPermission = "unknown",
  onRequestMediaAccess,
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
            <UpdateSection />
          </div>
        ) : (
          <div className="flex flex-col gap-5 animate-in-up">
            <Section title="Addony" hint="Vypnutá část zmizí i se svou záložkou; data zůstanou.">
              <AddonChoice addons={addons} onAddonChange={onAddonChange} />
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
