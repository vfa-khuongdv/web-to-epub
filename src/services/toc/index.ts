import { truyenfullTemplateAdapter } from "./truyenfullTemplate";
import { TocAdapter } from "./types";
import { xtruyenAdapter } from "./xtruyen";

export type { TocAdapter, TocChapter, TocResult } from "./types";

const ADAPTERS: TocAdapter[] = [truyenfullTemplateAdapter, xtruyenAdapter];

export function getTocAdapter(url: string): TocAdapter | undefined {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return undefined;
  }
  return ADAPTERS.find((adapter) => adapter.domains.includes(hostname));
}
