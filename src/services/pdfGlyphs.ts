import { createHash } from "node:crypto";

// A minimal TrueType reader: just enough to turn a glyph into a fingerprint of its outline,
// so a glyph whose text the PDF got wrong can be matched to the same shape drawn elsewhere in
// the document with the right text. Composite glyphs (a letter plus its accent) are flattened,
// because a subsetter renumbers their parts; hinting is ignored.

export interface GlyphFont {
  // Fingerprint of the glyph a character code draws; "" for a blank glyph, undefined when the
  // character has no glyph or the outline cannot be read.
  outline(code: number): string | undefined;
}

type Point = [number, number, number];

const MAX_COMPOSITE_DEPTH = 6;

export function readGlyphFont(data: Uint8Array): GlyphFont | undefined {
  try {
    return parse(data);
  } catch {
    return undefined;
  }
}

function parse(data: Uint8Array): GlyphFont | undefined {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const tag = view.getUint32(0);
  if (tag !== 0x00010000 && tag !== 0x74727565) return undefined; // not TrueType outlines
  const tables = new Map<string, number>();
  for (let i = 0; i < view.getUint16(4); i++) {
    const at = 12 + i * 16;
    const name = String.fromCharCode(...data.subarray(at, at + 4));
    tables.set(name, view.getUint32(at + 8));
  }
  const head = tables.get("head");
  const maxp = tables.get("maxp");
  const loca = tables.get("loca");
  const glyf = tables.get("glyf");
  const cmap = tables.get("cmap");
  if (head === undefined || maxp === undefined || loca === undefined || glyf === undefined || cmap === undefined) {
    return undefined;
  }
  const unitsPerEm = view.getUint16(head + 18) || 1000;
  const longLoca = view.getInt16(head + 50) === 1;
  const glyphCount = view.getUint16(maxp + 4);
  const glyphRange = (gid: number): [number, number] => {
    if (gid >= glyphCount) return [0, 0];
    return longLoca
      ? [view.getUint32(loca + gid * 4), view.getUint32(loca + gid * 4 + 4)]
      : [view.getUint16(loca + gid * 2) * 2, view.getUint16(loca + gid * 2 + 2) * 2];
  };

  const points = (gid: number, depth: number): Point[][] => {
    const [start, end] = glyphRange(gid);
    if (end <= start || depth > MAX_COMPOSITE_DEPTH) return [];
    let at = glyf + start;
    const contours = view.getInt16(at);
    at += 10;
    if (contours >= 0) return simpleGlyph(view, at, contours);
    const parts: Point[][] = [];
    for (let more = true; more; ) {
      const flags = view.getUint16(at);
      const component = view.getUint16(at + 2);
      at += 4;
      let dx = 0;
      let dy = 0;
      if (flags & 1) {
        dx = view.getInt16(at);
        dy = view.getInt16(at + 2);
        at += 4;
      } else {
        dx = view.getInt8(at);
        dy = view.getInt8(at + 1);
        at += 2;
      }
      if (!(flags & 2)) dx = dy = 0; // point matching: not worth supporting
      let [a, b, c, d] = [1, 0, 0, 1];
      const f2dot14 = (offset: number) => view.getInt16(at + offset) / 16384;
      if (flags & 8) {
        a = d = f2dot14(0);
        at += 2;
      } else if (flags & 0x40) {
        a = f2dot14(0);
        d = f2dot14(2);
        at += 4;
      } else if (flags & 0x80) {
        [a, b, c, d] = [f2dot14(0), f2dot14(2), f2dot14(4), f2dot14(6)];
        at += 8;
      }
      for (const contour of points(component, depth + 1)) {
        parts.push(contour.map(([x, y, on]) => [a * x + c * y + dx, b * x + d * y + dy, on] as Point));
      }
      more = !!(flags & 0x20);
    }
    return parts;
  };

  const glyphOf = cmapLookup(view, cmap);
  const cache = new Map<number, string | undefined>();
  return {
    outline(code) {
      if (cache.has(code)) return cache.get(code);
      const gid = glyphOf(code);
      let result: string | undefined;
      if (gid !== undefined) {
        const contours = points(gid, 0);
        const scale = 1000 / unitsPerEm;
        const text = contours
          .map((contour) => contour.map(([x, y, on]) => `${Math.round(x * scale)},${Math.round(y * scale)},${on}`).join(" "))
          .join("|");
        result = text ? createHash("sha1").update(text).digest("hex") : "";
      }
      cache.set(code, result);
      return result;
    },
  };
}

function simpleGlyph(view: DataView, start: number, contourCount: number): Point[][] {
  let at = start;
  const ends: number[] = [];
  for (let i = 0; i < contourCount; i++, at += 2) ends.push(view.getUint16(at));
  const total = contourCount ? ends[contourCount - 1] + 1 : 0;
  at += 2 + view.getUint16(at); // skip the instructions
  const flags: number[] = [];
  while (flags.length < total) {
    const flag = view.getUint8(at++);
    flags.push(flag);
    if (flag & 8) for (let repeat = view.getUint8(at++); repeat > 0; repeat--) flags.push(flag);
  }
  const axis = (short: number, same: number) => {
    const values: number[] = [];
    let value = 0;
    for (let i = 0; i < total; i++) {
      if (flags[i] & short) {
        const delta = view.getUint8(at++);
        value += flags[i] & same ? delta : -delta;
      } else if (!(flags[i] & same)) {
        value += view.getInt16(at);
        at += 2;
      }
      values.push(value);
    }
    return values;
  };
  const xs = axis(2, 16);
  const ys = axis(4, 32);
  const contours: Point[][] = [];
  let first = 0;
  for (const end of ends) {
    const contour: Point[] = [];
    for (let i = first; i <= end; i++) contour.push([xs[i], ys[i], flags[i] & 1]);
    contours.push(contour);
    first = end + 1;
  }
  return contours;
}

// Character code -> glyph id, from the first Unicode (or symbol) subtable it can read.
function cmapLookup(view: DataView, cmap: number): (code: number) => number | undefined {
  const lookups: ((code: number) => number | undefined)[] = [];
  for (let i = 0; i < view.getUint16(cmap + 2); i++) {
    const platform = view.getUint16(cmap + 4 + i * 8);
    const encoding = view.getUint16(cmap + 6 + i * 8);
    const at = cmap + view.getUint32(cmap + 8 + i * 8);
    const format = view.getUint16(at);
    if (format === 4) lookups.push(format4(view, at));
    else if (format === 12) lookups.push(format12(view, at));
    else if (platform === 1 && encoding === 0 && format === 0) lookups.push((code) => (code < 256 ? view.getUint8(at + 6 + code) : undefined));
  }
  return (code) => {
    for (const lookup of lookups) {
      const gid = lookup(code);
      if (gid) return gid;
    }
    return undefined;
  };
}

function format4(view: DataView, at: number): (code: number) => number | undefined {
  const segments = view.getUint16(at + 6) / 2;
  const ends = at + 14;
  const starts = ends + segments * 2 + 2;
  const deltas = starts + segments * 2;
  const ranges = deltas + segments * 2;
  return (code) => {
    for (let i = 0; i < segments; i++) {
      if (code > view.getUint16(ends + i * 2)) continue;
      if (code < view.getUint16(starts + i * 2)) return undefined;
      const range = view.getUint16(ranges + i * 2);
      if (!range) return (code + view.getInt16(deltas + i * 2)) & 0xffff;
      const gid = view.getUint16(ranges + i * 2 + range + (code - view.getUint16(starts + i * 2)) * 2);
      return gid ? (gid + view.getInt16(deltas + i * 2)) & 0xffff : undefined;
    }
    return undefined;
  };
}

function format12(view: DataView, at: number): (code: number) => number | undefined {
  const groups = view.getUint32(at + 12);
  return (code) => {
    for (let i = 0; i < groups; i++) {
      const group = at + 16 + i * 12;
      const first = view.getUint32(group);
      if (code >= first && code <= view.getUint32(group + 4)) return view.getUint32(group + 8) + code - first;
    }
    return undefined;
  };
}
