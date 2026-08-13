"use client";

import * as React from "react";
import { Settings, Download, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import * as liveUpdate from "@/lib/live-update";

export function SettingsDialog() {
  const [open, setOpen] = React.useState(false);
  const [url, setUrl] = React.useState("");
  const [audioUrl, setAudioUrl] = React.useState("");
  const [autoPlay, setAutoPlay] = React.useState(false);
  
  const [updateStatus, setUpdateStatus] = React.useState<string | null>(null);
  const [currentVersion, setCurrentVersion] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setUrl(liveUpdate.getUpdateUrl());
      setCurrentVersion(liveUpdate.currentBundleVersion() || "APK verze");
      setAudioUrl(localStorage.getItem("microwins:audio_url") || "");
      setAutoPlay(localStorage.getItem("microwins:audio_autoplay") === "true");
    }
  }, [open]);

  const handleSave = () => {
    liveUpdate.setUpdateUrl(url);
    localStorage.setItem("microwins:audio_url", audioUrl);
    localStorage.setItem("microwins:audio_autoplay", autoPlay ? "true" : "false");
    setOpen(false);
    // Reload to apply auto-play if needed
    window.location.reload();
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
      <Button variant="ghost" size="icon" className="absolute top-4 right-4 rounded-full" onClick={() => setOpen(true)}>
        <Settings className="w-6 h-6" />
      </Button>
      <Dialog 
        open={open} 
        onOpenChange={setOpen} 
        title="Nastavení"
      >
        <div className="flex flex-col gap-6 py-4">
          <div className="flex flex-col gap-3">
            <h3 className="font-semibold text-lg">Přehrávač</h3>
            <div className="flex flex-col gap-2">
              <label className="text-sm">URL adresa hudby (načte se automaticky)</label>
              <Input 
                value={audioUrl} 
                onChange={(e) => setAudioUrl(e.target.value)} 
                placeholder="https://example.com/stream.mp3"
              />
            </div>
            <div className="flex items-center gap-2">
              <input 
                type="checkbox" 
                id="autoplay" 
                checked={autoPlay} 
                onChange={(e) => setAutoPlay(e.target.checked)} 
                className="w-4 h-4"
              />
              <label htmlFor="autoplay" className="text-sm">Přehrát automaticky po spuštění</label>
            </div>
          </div>

          <div className="w-full h-px bg-border" />

          <div className="flex flex-col gap-3">
            <h3 className="font-semibold text-lg">Aktualizace z GitHubu</h3>
            <div className="text-sm text-muted-foreground">Aktuální verze: {currentVersion}</div>
            <div className="flex flex-col gap-2">
              <label className="text-sm">Adresa manifestu (OTA URL)</label>
              <Input 
                value={url} 
                onChange={(e) => setUrl(e.target.value)} 
              />
            </div>
            
            <Button onClick={handleCheckUpdate} variant="secondary" className="w-full flex items-center justify-center gap-2">
              <Download className="w-4 h-4" /> Zkontrolovat aktualizace
            </Button>
            {updateStatus && <div className="text-sm font-medium text-blue-500">{updateStatus}</div>}
            
            <Button onClick={handleRevert} variant="destructive" className="w-full flex items-center justify-center gap-2 mt-4">
              <RotateCcw className="w-4 h-4" /> Vrátit na výchozí APK
            </Button>
          </div>

          <Button onClick={handleSave} className="w-full mt-4">Uložit nastavení</Button>
        </div>
      </Dialog>
    </>
  );
}
