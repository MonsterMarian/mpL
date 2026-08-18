/**
 * Poslední chyby, které appku položily.
 *
 * V telefonu není konzole, do které by šlo nahlédnout, a bílá obrazovka
 * neřekne nic. Chyby se proto zapisují na disk a Nastavení je umí ukázat -
 * bez toho se pád na dálku hledá naslepo.
 *
 * Drží se posledních pět, novější první. Víc není k ničemu: opakující se pád
 * napíše pořád to samé a starší záznamy jen zabírají místo.
 */

export interface LoggedError {
  at: number;
  message: string;
  /** Odkud přišla - soubor a řádek, když je po ruce. */
  source?: string;
}

const STORAGE_KEY = "microwins:errors";
const LIMIT = 5;

export function readErrors(): LoggedError[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is LoggedError =>
        Boolean(item) && typeof item === "object" && typeof (item as LoggedError).message === "string",
    );
  } catch {
    return [];
  }
}

export function clearErrors(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // soukromý režim - není kam mazat
  }
}

export function recordError(message: string, source?: string): void {
  try {
    const entry: LoggedError = { at: Date.now(), message: message.slice(0, 400), source: source?.slice(0, 200) };
    const previous = readErrors();
    // Stejná chyba dokola nemá zabírat celý seznam - přepíše se ta poslední.
    const rest = previous[0]?.message === entry.message ? previous.slice(1) : previous;
    localStorage.setItem(STORAGE_KEY, JSON.stringify([entry, ...rest].slice(0, LIMIT)));
  } catch {
    // Zápis chyby nesmí vyrobit další chybu.
  }
}

/** Odchytí i to, co se stane mimo React - v přehrávači, v pluginu, kdekoliv. */
export function installErrorCapture(): void {
  if (typeof window === "undefined") return;
  window.addEventListener("error", (event) => {
    const where = event.filename ? `${event.filename}:${event.lineno}` : undefined;
    recordError(event.message || String(event.error), where);
  });
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    recordError(reason instanceof Error ? `${reason.name}: ${reason.message}` : `Nevyřízený slib: ${String(reason)}`);
  });
}
