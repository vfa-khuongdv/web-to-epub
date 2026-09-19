import {
  Bell,
  BookOpen,
  Check,
  ChevronRight,
  Circle,
  Clock,
  Download,
  ExternalLink,
  FileText,
  Highlighter,
  Import,
  Info,
  Languages,
  Library,
  LucideIcon,
  Monitor,
  Moon,
  Pencil,
  Play,
  RotateCw,
  Sun,
  TriangleAlert,
  Trash2,
  Upload,
  X,
} from "lucide-react";

export type IconName =
  | "crawl"
  | "library"
  | "play"
  | "retry"
  | "download"
  | "upload"
  | "chevron"
  | "check"
  | "alert"
  | "clock"
  | "x"
  | "trash"
  | "edit"
  | "chapter"
  | "dot"
  | "info"
  | "open"
  | "sun"
  | "moon"
  | "display"
  | "book"
  | "language"
  | "highlight"
  | "bell";

// Names stay the app's own vocabulary rather than the library's, so call sites read
// as intent ("retry", "open") and swapping a glyph is a one-line change here.
const icons: Record<IconName, LucideIcon> = {
  crawl: Import,
  library: Library,
  play: Play,
  retry: RotateCw,
  download: Download,
  upload: Upload,
  chevron: ChevronRight,
  check: Check,
  alert: TriangleAlert,
  clock: Clock,
  x: X,
  trash: Trash2,
  edit: Pencil,
  chapter: FileText,
  dot: Circle,
  info: Info,
  open: ExternalLink,
  sun: Sun,
  moon: Moon,
  display: Monitor,
  book: BookOpen,
  language: Languages,
  highlight: Highlighter,
  bell: Bell,
};

// The dot is a state light (crawling, live), not an outline: it reads as a dot only
// when filled, and lucide draws every glyph as a stroke.
const FILLED: Partial<Record<IconName, boolean>> = { dot: true, play: true };

// Lucide draws on a 24px grid at stroke width 2. These icons sit at 12–16px beside
// 12–13px text, where 2 is heavy enough to smudge; 1.75 keeps them crisp.
const STROKE_WIDTH = 1.75;

export function Icon({
  name,
  size = 16,
  className,
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  const Glyph = icons[name];
  return (
    <Glyph
      size={size}
      strokeWidth={STROKE_WIDTH}
      fill={FILLED[name] ? "currentColor" : "none"}
      className={className}
      aria-hidden="true"
      focusable="false"
    />
  );
}
