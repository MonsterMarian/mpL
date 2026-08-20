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
    /** Pořadí hlasu v seznamu z `getSupportedVoices` - plugin jiný klíč nezná. */
    voice?: number;
  }): Promise<void>;
  stop(): Promise<void>;
  getSupportedVoices(): Promise<{ voices: Array<{ name: string; lang: string; default?: boolean }> }>;
  getSupportedLanguages(): Promise<{ languages: string[] }>;
}

const TextToSpeech = registerPlugin<TextToSpeechPlugin>("TextToSpeech");

function isNative(): boolean {
  return Capacitor.isNativePlatform();
}

export const DEFAULT_LANGUAGE = "cs-CZ";

/** Hlas, jak si ho jde vybrat v Nastavení. */
export interface SpeechVoice {
  /**
   * Klíč, který přežije restart.
   *
   * Plugin i prohlížeč adresují hlas pořadím v seznamu, jenže to se mezi
   * spuštěními a po aktualizaci hlasového modulu posouvá - uložené číslo by
   * pak ukazovalo na cizí hlas. Drží se proto jméno s jazykem a na pořadí se
   * překládá až v okamžiku čtení.
   */
  id: string;
  name: string;
  lang: string;
}

const LANG_KEY = "microwins:speech_lang";
const VOICE_KEY = "microwins:speech_voice";

/** Poslední načtený seznam hlasů. Z něj se bere pořadí pro plugin. */
let voiceCache: SpeechVoice[] = [];

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // soukromý režim - volba vydrží do zavření appky
  }
}

function voiceId(name: string, lang: string): string {
  return `${lang}|${name}`;
}

export function speechLanguage(): string {
  return read(LANG_KEY) ?? DEFAULT_LANGUAGE;
}

export function setSpeechLanguage(lang: string): void {
  write(LANG_KEY, !lang || lang === DEFAULT_LANGUAGE ? null : lang);
}

export function speechVoiceId(): string | null {
  return read(VOICE_KEY);
}

/** `null` znamená „ten, co si systém vybere sám podle jazyka". */
export function setSpeechVoiceId(id: string | null): void {
  write(VOICE_KEY, id);
}

/**
 * Hlasy, které zařízení umí.
 *
 * V telefonu je dodává hlasový modul Androidu (obvykle Google TTS), takže
 * seznam závisí na tom, co má uživatel doinstalované. V prohlížeči je dodává
 * `speechSynthesis`, a ten je hlásí **až po chvíli** - proto se na první
 * prázdnou odpověď čeká na `voiceschanged`, jinak by nabídka zůstala prázdná.
 */
export async function listVoices(): Promise<SpeechVoice[]> {
  try {
    if (isNative()) {
      const result = await TextToSpeech.getSupportedVoices();
      voiceCache = (result?.voices ?? []).map((voice) => ({
        id: voiceId(voice.name, voice.lang),
        name: voice.name,
        lang: voice.lang,
      }));
      return voiceCache;
    }

    if (typeof window === "undefined" || !("speechSynthesis" in window)) return [];

    const collect = () =>
      window.speechSynthesis.getVoices().map((voice) => ({
        id: voiceId(voice.name, voice.lang),
        name: voice.name,
        lang: voice.lang,
      }));

    let voices = collect();
    if (!voices.length) {
      await new Promise<void>((resolve) => {
        const done = () => resolve();
        window.speechSynthesis.addEventListener("voiceschanged", done, { once: true });
        // Kdyby událost nedorazila, ať se nečeká donekonečna.
        setTimeout(done, 1200);
      });
      voices = collect();
    }
    voiceCache = voices;
    return voices;
  } catch {
    return [];
  }
}

/** Jazyky, ve kterých zařízení umí mluvit - odvozené z hlasů, které nabízí. */
export async function listLanguages(): Promise<string[]> {
  const voices = voiceCache.length ? voiceCache : await listVoices();
  const langs = new Set(voices.map((voice) => voice.lang).filter(Boolean));
  // Čeština v nabídce být musí, i když k ní zrovna žádný hlas není: bez ní by
  // nešlo vrátit se k výchozímu nastavení.
  langs.add(DEFAULT_LANGUAGE);
  return [...langs].sort();
}

/** Vybraný hlas, nebo `null` když si má systém vybrat sám. */
function selectedVoice(): SpeechVoice | null {
  const id = speechVoiceId();
  if (!id) return null;
  return voiceCache.find((voice) => voice.id === id) ?? null;
}

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
  // Vybraný hlas se překládá na pořadí v seznamu, takže seznam musí být po
  // ruce. Po startu appky ještě není - načte se teď, jednou.
  if (speechVoiceId() && !voiceCache.length) await listVoices();
  const voice = selectedVoice();
  const lang = voice?.lang ?? speechLanguage();

  if (isNative()) {
    const index = voice ? voiceCache.findIndex((item) => item.id === voice.id) : -1;
    await TextToSpeech.speak({
      text,
      lang,
      rate,
      pitch: 1,
      volume: 1,
      ...(index >= 0 ? { voice: index } : {}),
    });
    return;
  }
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    throw new Error("Zařízení nemá hlasový modul.");
  }
  await new Promise<void>((resolve, reject) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;
    if (voice) {
      const match = window.speechSynthesis
        .getVoices()
        .find((item) => item.name === voice.name && item.lang === voice.lang);
      if (match) utterance.voice = match;
    }
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

/**
 * Krátká ukázka vybraným hlasem.
 *
 * Bez ní se volba pozná až uprostřed knihy - jména hlasů jsou v telefonu
 * nicneříkající (`cs-cz-x-jfk#female_1`) a poslech je jediný způsob, jak
 * poznat, který je který.
 */
export async function previewVoice(text = "Takhle bude znít předčítání."): Promise<void> {
  await stopSpeaking();
  await speakOnce(text, 1);
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
