/**
 * The agent writes the character drawings, and the text it reads came from web pages, so
 * the SVG is rebuilt from an allowlist instead of being trusted: a few shape elements,
 * plain presentation attributes, flat colours only (no `url(#…)` — ids would collide
 * between scenes — no scripts, no event handlers, no text, no images).
 */
const ELEMENTS = new Set(["g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon"]);
const ATTRIBUTES = new Set([
  "d", "x", "y", "cx", "cy", "r", "rx", "ry", "width", "height", "x1", "y1", "x2", "y2", "points",
  "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "opacity", "fill-opacity",
  "stroke-opacity", "transform",
]);
const SAFE_VALUE = /^[#\w\s.,\-+()%]*$/;
const MAX_LENGTH = 24_000;
const MAX_ELEMENTS = 300;

export function sanitizeSvg(input: unknown): string | undefined {
  if (typeof input !== "string") return undefined;
  const source = input.trim();
  if (!source || source.length > MAX_LENGTH) return undefined;
  // Only tags (and whitespace between them) are allowed: text nodes, comments, CDATA,
  // doctype and processing instructions are all refused.
  const tagPattern = /<(\/?)([a-zA-Z][\w-]*)((?:\s+[\w:-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
  let out = "";
  let last = 0;
  let count = 0;
  const open: string[] = [];
  for (let match = tagPattern.exec(source); match; match = tagPattern.exec(source)) {
    if (source.slice(last, match.index).trim()) return undefined;
    last = tagPattern.lastIndex;
    const [, closing, rawName, rawAttributes, selfClosing] = match;
    const name = rawName.toLowerCase();
    if (!ELEMENTS.has(name)) return undefined;
    if (closing) {
      if (open.pop() !== name) return undefined;
      out += `</${name}>`;
      continue;
    }
    if (++count > MAX_ELEMENTS) return undefined;
    let attributes = "";
    for (const attribute of rawAttributes.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      const key = attribute[1].toLowerCase();
      const value = attribute[2] ?? attribute[3] ?? "";
      if (!ATTRIBUTES.has(key) || !SAFE_VALUE.test(value) || /url\s*\(|javascript/i.test(value)) return undefined;
      attributes += ` ${key}="${value}"`;
    }
    if (selfClosing) out += `<${name}${attributes}/>`;
    else {
      open.push(name);
      out += `<${name}${attributes}>`;
    }
  }
  if (source.slice(last).trim() || open.length > 0 || count === 0) return undefined;
  return out;
}
