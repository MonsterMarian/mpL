"use client";

import * as React from "react";
import { Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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

/**
 * Hlas a jazyk předčítání.
 *
 * Patří ke čtečce, ne do globálního nastavení appky. V nastavení celé appky
 * hledal jazyk hlasu jen ten, kdo věděl, že tam je - přitom se řeší přesně
 * v okamžiku, kdy si někdo pouští dokument nahlas a hlas mu nesedí. Tady je
 * po ruce a nastavení appky se o řádek zkrátilo.
 *
 * Hlasy dodává hlasový modul telefonu, ne appka - co je v nabídce, závisí na
 * tom, co má kdo doinstalované. Seznam se proto čte ze zařízení a nedrží se
 * jako pevný výčet: napevno zadaná čeština znamená na telefonu bez českého
 * hlasu jen ticho, a nikde by se nedalo poznat proč.
 *
 * Jména hlasů jsou přitom nicneříkající (`cs-cz-x-jfk#female_1`), takže k volbě
 * patří tlačítko, které je nechá promluvit.
 */
export function SpeechSettings({ open = true }: { open?: boolean }) {
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
    return <p className="px-1 text-xs text-muted-foreground">Ptám se zařízení, co umí…</p>;
  }

  if (!voices.length) {
    return (
      <p className="px-1 text-xs leading-relaxed text-muted-foreground">
        Zařízení nehlásí žádný hlas. Předčítání pojede tím, co si systém vybere sám. Hlasy se
        doinstalují v Androidu: Nastavení → Usnadnění → Převod textu na řeč.
      </p>
    );
  }

  const languages = [...new Set([DEFAULT_LANGUAGE, ...voices.map((item) => item.lang)])].sort();
  const forLanguage = voices.filter((item) => item.lang === lang);

  return (
    <div className="flex flex-col gap-2">
      <label className="flex items-center justify-between gap-3 text-sm">
        Jazyk
        <select
          value={lang}
          onChange={(event) => pickLanguage(event.target.value)}
          className="h-9 min-w-0 flex-1 rounded-lg border border-white/15 bg-transparent px-2 text-xs outline-none"
        >
          {languages.map((item) => (
            <option key={item} value={item} className="bg-black">
              {item}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center justify-between gap-3 text-sm">
        Hlas
        <select
          value={voice ?? ""}
          onChange={(event) => pickVoice(event.target.value)}
          className="h-9 min-w-0 flex-1 rounded-lg border border-white/15 bg-transparent px-2 text-xs outline-none"
        >
          <option value="" className="bg-black">
            Systémový
          </option>
          {forLanguage.map((item) => (
            <option key={item.id} value={item.id} className="bg-black">
              {item.name}
            </option>
          ))}
        </select>
      </label>

      {forLanguage.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          K jazyku {lang} zařízení žádný hlas nemá. Doinstaluj ho v systému, jinak zůstane ticho.
        </p>
      ) : null}

      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Vybraný hlas určuje i jazyk, kterým se čte. Podle jména se poznat nedá - vyzkoušej ho.
        </p>
        <Button variant="outline" size="sm" className="shrink-0" onClick={() => void previewVoice()}>
          <Volume2 className="size-4" /> Vyzkoušet
        </Button>
      </div>
    </div>
  );
}
