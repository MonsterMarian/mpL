"use client";

import * as React from "react";
import { Trophy, Info, AlertTriangle, X } from "lucide-react";
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

const TONE_ICON = { win: Trophy, info: Info, warn: AlertTriangle } as const;

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
      window.setTimeout(() => dismiss(id), t.tone === "win" ? 6000 : 4000);
    },
    [dismiss],
  );

  const api = React.useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        // Na mobilu nad spodní lištou, ne pod ní.
        className="mw-safe-bottom pointer-events-none fixed inset-x-0 bottom-16 z-[60] flex flex-col items-center gap-2 p-4 sm:bottom-0 sm:items-end"
        role="status"
        aria-live="polite"
      >
        {toasts.map((t) => {
          const Icon = TONE_ICON[t.tone];
          return (
            <div
              key={t.id}
              className={cn(
                "animate-in-up pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-lg border p-3 shadow-lg",
                t.tone === "win"
                  ? "border-win/40 bg-win-muted text-win-muted-foreground"
                  : "bg-card text-card-foreground",
              )}
            >
              <Icon className="mt-0.5 size-4 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{t.title}</p>
                {t.description ? (
                  <p className="mt-0.5 text-xs opacity-80">{t.description}</p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                aria-label="Zavřít"
                className="opacity-60 transition-opacity hover:opacity-100"
              >
                <X className="size-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
