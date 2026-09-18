import { ReactNode } from "react";

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
  | "display";

const shapes: Record<IconName, ReactNode> = {
  sun: (
    <>
      <circle cx="10" cy="10" r="3.5" />
      <path d="M10 2.6v1.7M10 15.7v1.7M2.6 10h1.7M15.7 10h1.7M4.8 4.8l1.2 1.2M14 14l1.2 1.2M15.2 4.8 14 6M6 14l-1.2 1.2" />
    </>
  ),
  moon: <path d="M15.3 12.3A5.9 5.9 0 0 1 7.7 4.7a5.9 5.9 0 1 0 7.6 7.6z" />,
  display: (
    <>
      <rect x="3" y="4.4" width="14" height="9.2" rx="1.4" />
      <path d="M7.7 17h4.6M10 13.6V17" />
    </>
  ),
  crawl: (
    <>
      <path d="M10 3.2v8.6" />
      <path d="M6.7 8.5 10 11.8l3.3-3.3" />
      <path d="M4 14.2v1.6a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-1.6" />
    </>
  ),
  library: (
    <>
      <path d="M4.2 4.4h2.8v11.2H4.2z" />
      <path d="M8.9 4.4h2.8v11.2H8.9z" />
      <path d="M13.4 5.6l2.3-.6 1.9 10.4-2.3.6z" />
    </>
  ),
  play: <path d="M7 5.2 15 10 7 14.8z" fill="currentColor" />,
  retry: (
    <>
      <path d="M3.5 10a6.5 6.5 0 0 1 11.2-4.5" />
      <path d="M14.7 2.3v3.2h-3.2" />
      <path d="M16.5 10a6.5 6.5 0 0 1-11.2 4.6" />
      <path d="M8.5 14.6H5.3v3.2" />
    </>
  ),
  download: (
    <>
      <path d="M10 3.4v8.4" />
      <path d="M6.7 8.5 10 11.8l3.3-3.3" />
      <path d="M4 14.4v1.4a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-1.4" />
    </>
  ),
  upload: (
    <>
      <path d="M10 12.6V4.2" />
      <path d="M6.7 7.5 10 4.2l3.3 3.3" />
      <path d="M4 14.4v1.4a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-1.4" />
    </>
  ),
  chevron: <path d="M8 5.5 12.5 10 8 14.5" />,
  check: <path d="M4.6 10.6 8 14l7.4-8" />,
  alert: (
    <>
      <path d="M10 3.4 17.1 15.6H2.9z" />
      <path d="M10 8.1v3.3" />
      <path d="M10 13.5v.01" />
    </>
  ),
  clock: (
    <>
      <path d="M10 3.4a6.6 6.6 0 1 1 0 13.2 6.6 6.6 0 0 1 0-13.2z" />
      <path d="M10 6.6V10l2.5 1.6" />
    </>
  ),
  x: (
    <>
      <path d="M5.6 5.6 14.4 14.4" />
      <path d="M14.4 5.6 5.6 14.4" />
    </>
  ),
  trash: (
    <>
      <path d="M4 6.6h12" />
      <path d="M8.1 6.6V4.8a1 1 0 0 1 1-1h1.8a1 1 0 0 1 1 1v1.8" />
      <path d="M5.7 6.6l.8 9.1a1 1 0 0 0 1 .9h5a1 1 0 0 0 1-.9l.8-9.1" />
      <path d="M8.5 9.4v4.9" />
      <path d="M11.5 9.4v4.9" />
    </>
  ),
  edit: (
    <>
      <path d="M4.6 15.4l.9-3.6 8.4-8.4a1.3 1.3 0 0 1 1.9 0l1.8 1.8a1.3 1.3 0 0 1 0 1.9l-8.4 8.4z" />
      <path d="M12.6 4.9l2.5 2.5" />
    </>
  ),
  chapter: (
    <>
      <path d="M5.2 2.8h5.9L15 6.7v10.5a1 1 0 0 1-1 1H5.2a1 1 0 0 1-1-1V3.8a1 1 0 0 1 1-1z" />
      <path d="M11.1 2.8v3.9H15" />
      <path d="M7 11.2h6" />
      <path d="M7 14h4" />
    </>
  ),
  dot: <path d="M10 6.8a3.2 3.2 0 1 1 0 6.4 3.2 3.2 0 0 1 0-6.4z" fill="currentColor" stroke="none" />,
  info: (
    <>
      <path d="M10 3.4a6.6 6.6 0 1 1 0 13.2 6.6 6.6 0 0 1 0-13.2z" />
      <path d="M10 13.4V9.6" />
      <path d="M10 7v.01" />
    </>
  ),
  open: (
    <>
      <path d="M11.4 3.6h5v5" />
      <path d="M16.4 3.6 9.6 10.4" />
      <path d="M13.8 11.9v3.7a1 1 0 0 1-1 1H4.9a1 1 0 0 1-1-1V7.7a1 1 0 0 1 1-1h3.7" />
    </>
  ),
};

export function Icon({
  name,
  size = 16,
  className,
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {shapes[name]}
    </svg>
  );
}
