"use client";

import * as React from "react";
import { BookOpenText, Check, Download, Moon, RotateCcw, Settings, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import * as liveUpdate from "@/lib/live-update";

interface SettingsDialogProps {
  addonEnabled?: boolean;
  onAddonEnabledChange?: (enabled: boolean) => void;
  onAudioSettingsChange?: (url: string, autoPlay: boolean) => void;
  trigger?: React.ReactNode;
}

export function SettingsDialog({
  addonEnabled = true,
  onAddonEnabledChange,
  onAudioSettingsChange,
  trigger,
}: SettingsDialogProps) {
  const [open, setOpen] = React.useState(false);
  const [url, setUrl] = React.useState("");
  const [audioUrl, setAudioUrl] = React.useState("");
  const [autoPlay, setAutoPlay] = React.useState(false);
  const [documentAddon, setDocumentAddon] = React.useState(addonEnabled);
  const [theme, setTheme] = React.useState<"dark" | "light">("dark");
  
  const [updateStatus, setUpdateStatus] = React.useState<string | null>(null);
  const [currentVersion, setCurrentVersion] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setUrl(liveUpdate.getUpdateUrl());
      setCurrentVersion(liveUpdate.currentBundleVersion() || "APK verze");
      setAudioUrl(localStorage.getItem("microwins:audio_url") || "");
      setAutoPlay(localStorage.getItem("microwins:audio_autoplay") === "true");
      setDocumentAddon(localStorage.getItem("microwins:reader_addon") !== "false");
      setTheme(localStorage.getItem("microwins:theme") === "light" ? "light" : "dark");
    }
  }, [open]);

  const handleSave = () => {
    liveUpdate.setUpdateUrl(url);
    localStorage.setItem("microwins:audio_url", audioUrl);
    localStorage.setItem("microwins:audio_autoplay", autoPlay ? "true" : "false");
    localStorage.setItem("microwins:reader_addon", documentAddon ? "true" : "false");
    localStorage.setItem("microwins:theme", theme);
    document.documentElement.classList.toggle("dark", theme === "dark");
    onAddonEnabledChange?.(documentAddon);
    onAudioSettingsChange?.(audioUrl.trim(), autoPlay);
    setOpen(false);
  };

  const handleCheckUpdate = async () => {
    setUpdateStatus("Hledám aktualizace...");
    const res = await liveUpdate.checkForUpdate();
    if (res.kind === "up-to-date") setUpdateStatus("Aplikace je aktuální.");
    else if (res.kind === "downloaded") setUpdateStatus("Aktualizace stažena. Projeví se po restartu.");
    else if (res.kind === "failed") setUpdateStatus("Chyba: " + res.message);
    else setUpdateStatus("Nelze zkontrolovat (může běžet v prohlížeči).");
  };

  const handleRevert = async () => {
    if (confirm("Opravdu chcete zahodit všechny stažené aktualizace a vrátit se k původní verzi?")) {
      await liveUpdate.revertToBundled();
    }
  };

  return (
    <>
      {trigger ?? (
        <Button variant="ghost" size="icon" className="rounded-full" onClick={() => setOpen(true)}>
          <Settings className="size-5" />
        </Button>
      )}
      <Dialog 
        open={open} 
        onOpenChange={setOpen} 
        title="Nastavení"
        description="Uprav si Sonoru podle svého poslechu."
        className="max-w-lg"
      >
        <div className="flex flex-col gap-5">
          <section className="rounded-2xl border bg-background/50 p-4">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-xl bg-orange-500/15 text-orange-400">
                <Settings className="size-4" />
              </div>
              <div>
                <h3 className="font-semibold">Přehrávač</h3>
                <p className="text-xs text-muted-foreground">Stream i automatické spuštění</p>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-xs font-medium text-muted-foreground">Výchozí stream URL</label>
              <Input 
                value={audioUrl} 
                onChange={(e) => setAudioUrl(e.target.value)} 
                placeholder="https://example.com/stream.mp3"
              />
            </div>
            <label className="mt-4 flex cursor-pointer items-center justify-between gap-4">
              <span>
                <span className="block text-sm font-medium">Přehrát po spuštění</span>
                <span className="text-xs text-muted-foreground">Prohlížeč může autoplay zablokovat.</span>
              </span>
              <input
                type="checkbox"
                checked={autoPlay}
                onChange={(e) => setAutoPlay(e.target.checked)}
                className="size-4 accent-orange-500"
              />
            </label>
          </section>

          <section className="rounded-2xl border bg-background/50 p-4">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-xl bg-orange-500/15 text-orange-400">
                <BookOpenText className="size-4" />
              </div>
              <div>
                <h3 className="font-semibold">Addony</h3>
                <p className="text-xs text-muted-foreground">Rozšiř si Sonoru o čtení dokumentů</p>
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={documentAddon}
              onClick={() => setDocumentAddon((enabled) => !enabled)}
              className="flex w-full items-center justify-between gap-4 rounded-xl border bg-card/70 p-3 text-left transition-colors hover:bg-accent"
            >
              <span>
                <span className="block text-sm font-medium">Čtečka dokumentů</span>
                <span className="text-xs text-muted-foreground">
                  {documentAddon ? "PDF a TXT knihovna je zapnutá" : "Čtečka bude skrytá z navigace"}
                </span>
              </span>
              <span className={"relative h-6 w-11 rounded-full transition-colors " + (documentAddon ? "bg-orange-500" : "bg-muted")}>
                <span className={"absolute top-1 size-4 rounded-full bg-white shadow-sm transition-transform " + (documentAddon ? "translate-x-6" : "translate-x-1")} />
              </span>
            </button>
          </section>

          <section className="rounded-2xl border bg-background/50 p-4">
            <div className="mb-3 flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-xl bg-orange-500/15 text-orange-400">
                {theme === "dark" ? <Moon className="size-4" /> : <Sun className="size-4" />}
              </div>
              <div>
                <h3 className="font-semibold">Vzhled</h3>
                <p className="text-xs text-muted-foreground">Klidný režim pro dlouhý poslech</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 rounded-xl bg-muted/40 p-1">
              {(["dark", "light"] as const).map((option) => (
                <button
                  type="button"
                  key={option}
                  onClick={() => setTheme(option)}
                  className={"flex h-9 items-center justify-center gap-2 rounded-lg text-xs font-medium transition-colors " + (theme === option ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
                >
                  {option === "dark" ? <Moon className="size-3.5" /> : <Sun className="size-3.5" />}
                  {option === "dark" ? "Tmavý" : "Světlý"}
                  {theme === option ? <Check className="size-3.5 text-orange-400" /> : null}
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border bg-background/50 p-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h3 className="font-semibold">Aktualizace z GitHubu</h3>
                <p className="text-xs text-muted-foreground">Verze: {currentVersion}</p>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-xs font-medium text-muted-foreground">Adresa manifestu OTA</label>
              <Input 
                value={url} 
                onChange={(e) => setUrl(e.target.value)} 
              />
            </div>
            
            <Button onClick={handleCheckUpdate} variant="secondary" className="mt-3 w-full">
              <Download className="w-4 h-4" /> Zkontrolovat aktualizace
            </Button>
            {updateStatus && <div className="mt-2 text-xs font-medium text-orange-400">{updateStatus}</div>}
            
            <Button onClick={handleRevert} variant="ghost" className="mt-2 w-full text-destructive hover:text-destructive">
              <RotateCcw className="w-4 h-4" /> Vrátit na výchozí APK
            </Button>
          </section>

          <Button onClick={handleSave} className="h-11 w-full bg-orange-500 text-white hover:bg-orange-400">Uložit nastavení</Button>
        </div>
      </Dialog>
    </>
  );
}
