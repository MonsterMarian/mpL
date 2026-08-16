/**
 * Předčítání textu.
 *
 * Chová se jako přehrávač: dá se pozastavit, pokračovat od stejného místa
 * a měnit rychlost. Ani jeden z rozpoznávačů to sám neumí - plugin
 * `text-to-speech` zná jen „mluv" a „zmlkni", `speechSynthesis` sice pauzu má,
 * ale v Android WebView na ni není spoleh. Řeší to čtení po kusech: mluví se
 * větu po větě a pauza znamená „dopověz kus a stůj". Kde se stálo, ví index
 * kusu, takže pokračování navazuje a rychlost se projeví hned na dalším.
 */
import { Capacitor, registerPlugin } from "@capacitor/core";

/**
 * Plugin se registruje ručně, stejně jako `MediaLibrary`.
 *
 * Balíček `@capacitor-community/text-to-speech` si při importu sahá na
 * `window` ("warm up" v jeho index.js) a tím shodí prerender celé stránky.
 * `registerPlugin` je totéž volání, které dělá i on sám, jen bez toho
 * vedlejšího efektu - a na rozdíl od `await import()` nevzniká samostatný
 * JS kus, který by ve WebView mohl chybět.
 */
interface TextToSpeechPlugin {
  speak(options: {
    text: string;
    lang?: string;
    rate?: number;
    pitch?: number;
    volume?: number;
  }): Promise<void>;
  stop(): Promise<void>;
}

const TextToSpeech = registerPlugin<TextToSpeechPlugin>("TextToSpeech");

function isNative(): boolean {
  return Capacitor.isNativePlatform();
}

const LANGUAGE = "cs-CZ";

export const SPEECH_RATES = [0.75, 1, 1.25, 1.5, 2] as const;
export type SpeechRate = (typeof SPEECH_RATES)[number];

export interface SpeakerHandlers {
  /** Který kus se právě čte - obrazovka podle toho zvýrazňuje. */
  onChunk: (index: number) => void;
  /** Došlo se na konec stránky. */
  onDone: () => void;
  onError: (message: string) => void;
}

export interface Speaker {
  /** Spustí čtení kusů od `from`. Předchozí čtení zruší. */
  speak: (chunks: string[], from: number, rate: number) => void;
  /** Zastaví čtení. Index posledního kusu si drží volající. */
  stop: () => void;
}

async function speakOnce(text: string, rate: number): Promise<void> {
  if (isNative()) {
    await TextToSpeech.speak({ text, lang: LANGUAGE, rate, pitch: 1, volume: 1 });
    return;
  }
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    throw new Error("Zařízení nemá hlasový modul.");
  }
  await new Promise<void>((resolve, reject) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = LANGUAGE;
    utterance.rate = rate;
    utterance.onend = () => resolve();
    utterance.onerror = (event) =>
      // Zrušení uživatelem není chyba, jen konec.
      event.error === "canceled" || event.error === "interrupted"
        ? resolve()
        : reject(new Error(String(event.error)));
    window.speechSynthesis.speak(utterance);
  });
}

async function stopSpeaking(): Promise<void> {
  if (typeof window !== "undefined") window.speechSynthesis?.cancel();
  if (!isNative()) return;
  try {
    await TextToSpeech.stop();
  } catch {
    // Nemluví se - není co zastavovat.
  }
}

export function createSpeaker(handlers: SpeakerHandlers): Speaker {
  /* Běh čtení se pozná podle vlastního tokenu. Kdyby se zastavovalo příznakem,
     staré čtení by po `stop()` doběhlo poslední kus a přehlásilo stav
     nového - dvě stránky by se pak četly přes sebe. */
  let run = {};

  const speak = (chunks: string[], from: number, rate: number) => {
    const token = {};
    run = token;

    void (async () => {
      await stopSpeaking();
      for (let i = Math.max(0, from); i < chunks.length; i += 1) {
        if (run !== token) return;
        handlers.onChunk(i);
        try {
          await speakOnce(chunks[i], rate);
        } catch (e) {
          if (run !== token) return;
          run = {};
          handlers.onError(String(e instanceof Error ? e.message : e).slice(0, 120));
          return;
        }
      }
      if (run !== token) return;
      run = {};
      handlers.onDone();
    })();
  };

  const stop = () => {
    run = {};
    void stopSpeaking();
  };

  return { speak, stop };
}
