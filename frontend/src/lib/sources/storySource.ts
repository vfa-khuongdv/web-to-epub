import type { Translate } from "../../i18n";

// Imported books (EPUB/PDF/archive.org/DTV Ebook files) are stored with site "epub" and a
// story URL whose prefix says where they came from (services/routes: epub:, pdf:, archive:,
// dtv:, web: — a page the agent read as one text). A new book source is one row here.
export const IMPORTED_SITE = "epub";

const IMPORTED_SOURCE_LABELS: [prefix: string, label: string][] = [
  ["pdf:", "PDF file"],
  ["archive:", "Internet Archive"],
  ["dtv:", "DTV Ebook"],
  ["heyzine:", "Heyzine"],
  ["web:", "Web page"],
];

export function storySourceLabel(story: { site: string; storyUrl: string }, t: Translate): string {
  if (story.site !== IMPORTED_SITE) return story.site;
  const known = IMPORTED_SOURCE_LABELS.find(([prefix]) => story.storyUrl.startsWith(prefix));
  return t(known ? known[1] : "EPUB file");
}
