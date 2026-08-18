"use client";

import * as React from "react";
import { recordError } from "@/lib/diagnostics";
import { revertToBundled } from "@/lib/live-update";
import { BRAND_MARK } from "@/lib/brand";

/**
 * Poslední záchrana.
 *
 * Bez ní stačí jedna chyba při vykreslení a z appky zbude černá plocha - na
 * telefonu k nerozeznání od pádu. Tady se místo toho ukáže, co se stalo,
 * a nabídnou se tři cesty ven, včetně návratu k verzi z APK: když appku
 * položí stažený balík, tohle je jediné tlačítko, které ji spraví.
 */
interface State {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    recordError(`${error.name}: ${error.message}`, info.componentStack?.trim().split("\n")[0]);
  }

  render(): React.ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-5 bg-background px-6 py-10 text-center text-foreground">
        {/* eslint-disable-next-line @next/next/no-img-element -- značka je data URI */}
        <img src={BRAND_MARK} alt="" aria-hidden="true" className="size-14" />
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Něco se rozbilo</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Hudba i data zůstaly, jen tahle obrazovka spadla.
          </p>
        </div>

        <pre className="max-h-40 w-full max-w-sm overflow-auto rounded-xl border border-white/10 bg-white/[0.04] p-3 text-left font-mono text-[11px] leading-relaxed text-muted-foreground">
          {error.name}: {error.message}
        </pre>

        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            className="flex h-11 items-center justify-center rounded-full bg-brand px-6 text-sm font-semibold text-black"
          >
            Zkusit znovu
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="flex h-11 items-center justify-center rounded-full border px-6 text-sm"
          >
            Restartovat aplikaci
          </button>
          <button
            type="button"
            onClick={() => void revertToBundled()}
            className="px-6 py-2 text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            Vrátit se k verzi z APK
          </button>
        </div>
      </div>
    );
  }
}
