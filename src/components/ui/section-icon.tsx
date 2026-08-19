"use client";

import {
  ArrowDownToLine,
  Book,
  BookOpenText,
  Clapperboard,
  CloudDownload,
  Disc3,
  Download,
  FileText,
  Film,
  Headphones,
  Inbox,
  Library,
  MonitorPlay,
  Music2,
  Notebook,
  Video,
} from "lucide-react";
import type { SectionIconId } from "@/lib/section-icons";

/**
 * Ikona sekce podle volby uživatele.
 *
 * Jmenovité importy schválně: kdyby se sáhlo po dynamickém přístupu do
 * knihovny, skončí v balíku všech patnáct set ikon lucide.
 */
const ICONS: Record<SectionIconId, typeof Library> = {
  library: Library,
  music: Music2,
  disc: Disc3,
  headphones: Headphones,
  "book-open-text": BookOpenText,
  book: Book,
  "file-text": FileText,
  notebook: Notebook,
  film: Film,
  video: Video,
  clapperboard: Clapperboard,
  "monitor-play": MonitorPlay,
  download: Download,
  "arrow-down-to-line": ArrowDownToLine,
  "cloud-download": CloudDownload,
  inbox: Inbox,
};

export function SectionIcon({ id, className }: { id: SectionIconId; className?: string }) {
  const Icon = ICONS[id] ?? Library;
  return <Icon className={className} />;
}
