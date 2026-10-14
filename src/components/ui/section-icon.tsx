"use client";

import {
  ArrowDownToLine,
  AudioLines,
  Book,
  BookMarked,
  BookOpenText,
  BookText,
  CassetteTape,
  CircleArrowDown,
  CirclePlay,
  Clapperboard,
  CloudDownload,
  Disc3,
  Download,
  FileText,
  Film,
  FolderDown,
  HardDriveDownload,
  Headphones,
  Inbox,
  Library,
  ListOrdered,
  MonitorPlay,
  Newspaper,
  Notebook,
  PackageOpen,
  Popcorn,
  Radio,
  ScrollText,
  Tv,
  Video,
  Videotape,
} from "lucide-react";
import type * as React from "react";
import { BrandIcon } from "@/components/ui/brand-icon";
import type { SectionIconId } from "@/lib/section-icons";

/**
 * Ikona sekce podle volby uživatele.
 *
 * Jmenovité importy schválně: kdyby se sáhlo po dynamickém přístupu do
 * knihovny, skončí v balíku všech patnáct set ikon lucide.
 */
const ICONS: Record<SectionIconId, React.ComponentType<{ className?: string }>> = {
  library: Library,
  // Místo noty značka appky - nota v mpL nikde není.
  music: BrandIcon,
  disc: Disc3,
  headphones: Headphones,
  "audio-lines": AudioLines,
  radio: Radio,
  "list-music": ListOrdered,
  cassette: CassetteTape,
  "book-open-text": BookOpenText,
  book: Book,
  "file-text": FileText,
  notebook: Notebook,
  "book-marked": BookMarked,
  "book-text": BookText,
  newspaper: Newspaper,
  "scroll-text": ScrollText,
  film: Film,
  video: Video,
  clapperboard: Clapperboard,
  "monitor-play": MonitorPlay,
  tv: Tv,
  popcorn: Popcorn,
  "circle-play": CirclePlay,
  videotape: Videotape,
  download: Download,
  "arrow-down-to-line": ArrowDownToLine,
  "cloud-download": CloudDownload,
  inbox: Inbox,
  "hard-drive-download": HardDriveDownload,
  "folder-down": FolderDown,
  "circle-arrow-down": CircleArrowDown,
  "package-open": PackageOpen,
};

export function SectionIcon({ id, className }: { id: SectionIconId; className?: string }) {
  const Icon = ICONS[id] ?? Library;
  return <Icon className={className} />;
}
