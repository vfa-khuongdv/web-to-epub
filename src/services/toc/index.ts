import { asianfanficsAdapter } from "./asianfanfics";
import { fanfictionAdapter } from "./fanfiction";
import { scribdAdapter } from "./scribd";
import { truyenfullTemplateAdapter } from "./truyenfullTemplate";
import { TocAdapter } from "./types";
import { vietmessengerAdapter } from "./vietmessenger";
import { wattpadAdapter } from "./wattpad";
import { xtruyenAdapter } from "./xtruyen";

export type { TocAdapter, TocChapter, TocResult } from "./types";

const ADAPTERS: TocAdapter[] = [
  truyenfullTemplateAdapter,
  xtruyenAdapter,
  wattpadAdapter,
  asianfanficsAdapter,
  fanfictionAdapter,
  vietmessengerAdapter,
  scribdAdapter,
];

export function getTocAdapter(url: string): TocAdapter | undefined {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return undefined;
  }
  return ADAPTERS.find((adapter) => adapter.domains.includes(hostname));
}
