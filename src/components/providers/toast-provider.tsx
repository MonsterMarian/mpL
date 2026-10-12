"use client";

import * as React from "react";
import { AlertTriangle, X } from "lucide-react";
import { BRAND_MARK } from "@/lib/brand";
import { cn } from "@/lib/utils";

type ToastTone = "win" | "info" | "warn";

interface Toast {
  id: number;
  tone: ToastTone;
  title: string;
  description?: string;
}

interface ToastApi {
  toast: (t: Omit<Toast, "id">) => void;
}

const ToastContext = React.createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error("useToast musí být uvnitř ToastProvider");
  return ctx;
}

/** Jak dlouho hláška visí. Povedená akce (přidáno, založeno) o chvíli déle. */
const DURATION: Record<ToastTone, number> = { win: 6000, info: 4000, warn: 4000 };

/**
 * Hlášky appky - vlastní pro mpL.
 *
 * Dřív byly převzaté z MicroWins: oranžová plocha a pohár, který v hudebním
 * přehrávači nedává smysl. Teď je to černá karta se značkou appky (p s notou)
 * ve žluté z ikony na ploše; varování nese žlutý trojúhelník. Tenký pruh dole
 * odpočítává, kdy hláška sama zmizí.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  const nextId = React.useRef(1);

  const dismiss = React.useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = React.useCallback(
    (t: Omit<Toast, "id">) => {
      const id = nextId.current++;
      setToasts((prev) => [...prev, { ...t, id }]);
      window.setTimeout(() => dismiss(id), DURATION[t.tone]);
    },
    [dismiss],
  );

  const api = React.useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        // Nad lištou přehrávače i nad spodní navigací, ne pod nimi.
        className="mw-above-dock pointer-events-none fixed inset-x-0 z-[60] flex flex-col items-center gap-2 px-4 sm:items-end"
        role="status"
        aria-live="polite"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cn(
              "animate-in-up pointer-events-auto relative flex w-full max-w-sm items-start gap-3 overflow-hidden rounded-xl border bg-popover p-3 pr-2 text-popover-foreground shadow-lg shadow-black/60",
              t.tone === "info" ? "border-border" : "border-notice/40",
            )}
          >
            {t.tone === "warn" ? (
              <AlertTriangle className="mt-0.5 size-5 shrink-0 text-notice" />
            ) : (
              <BrandMark />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{t.title}</p>
              {t.description ? (
                <p className="mt-0.5 text-xs text-muted-foreground">{t.description}</p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              aria-label="Zavřít"
              className="-my-1 grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="size-4" />
            </button>
            <span
              aria-hidden
              className="mw-countdown absolute inset-x-0 bottom-0 h-0.5 bg-notice/70"
              style={{ "--mw-countdown": `${DURATION[t.tone]}ms` } as React.CSSProperties}
            />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/**
 * Značka appky obarvená žlutou z ikony. Obrázek značky slouží jen jako maska,
 * barvu dává CSS - stejný tvar jako na ploše, bez druhé kopie v jiné barvě.
 * (Data URI, ne soubor: balík živé aktualizace binární PNG rozbije.)
 */
function BrandMark() {
  return (
    <span
      aria-hidden
      className="-mt-0.5 size-6 shrink-0 bg-notice"
      style={{
        maskImage: `url("${BRAND_MARK}")`,
        WebkitMaskImage: `url("${BRAND_MARK}")`,
        maskSize: "contain",
        WebkitMaskSize: "contain",
        maskRepeat: "no-repeat",
        WebkitMaskRepeat: "no-repeat",
        maskPosition: "center",
        WebkitMaskPosition: "center",
      }}
    />
  );
}
