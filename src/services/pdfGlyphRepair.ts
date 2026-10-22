import { getDocumentProxy, getResolvedPDFJS } from "unpdf";
import { GlyphFont, readGlyphFont } from "./pdfGlyphs";

// Some PDFs draw a letter correctly but record the wrong text for it (a symbol such as "|" for
// "à", or nothing at all for "ũ"). What is drawn is right, so the shape of each glyph says what
// it is: a glyph whose text is not a letter but whose outline equals that of a glyph elsewhere
// in the document that does carry a letter is that letter. A shape with no such twin (the
// font subset kept only the broken copy) is one letter whatever it is used in, so it takes the
// letter that fits its surrounding words best among those the same font draws nowhere else.

type DocumentProxy = Awaited<ReturnType<typeof getDocumentProxy>>;

export type ItemFix = (items: { str: string }[]) => void;

const VIETNAMESE = [..."àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵ"];
const LETTER_RE = /^\p{L}$/u;
// Fewer different words than this agreeing on a letter is not evidence.
const MIN_PATTERNS = 3;
const MIN_USES = 5;
// Stands in for a glyph not yet known while its neighbours are read.
const HOLE = "\u0001";

interface Glyph {
  font: string;
  family: string;
  code: number;
  unicode: string;
  outline: string;
}

interface PageGlyphs {
  text: string;
  // Offset in `text` -> the glyph there, for glyphs whose text is not a letter.
  suspects: Map<number, Glyph>;
}

const keyOf = (glyph: Glyph) => `${glyph.font}#${glyph.code}`;

export async function glyphFixes(pdf: DocumentProxy): Promise<Map<number, ItemFix>> {
  const { OPS } = await getResolvedPDFJS();
  const fonts = new Map<string, { font?: GlyphFont; family: string }>();
  const pages = new Map<number, PageGlyphs>();
  // outline -> letter -> glyphs drawn with it
  const twins = new Map<string, Map<string, number>>();
  const familyLetters = new Map<string, Set<string>>();

  for (let number = 1; number <= pdf.numPages; number++) {
    const page = await pdf.getPage(number);
    const list = await page.getOperatorList();
    let current = "";
    let text = "";
    const suspects = new Map<number, Glyph>();
    for (let k = 0; k < list.fnArray.length; k++) {
      if (list.fnArray[k] === OPS.setFont) current = list.argsArray[k][0];
      if (list.fnArray[k] !== OPS.showText) continue;
      if (!fonts.has(current)) {
        const object = page.commonObjs.get(current) as { data?: Uint8Array; name?: string } | undefined;
        fonts.set(current, {
          font: object?.data ? readGlyphFont(object.data) : undefined,
          family: (object?.name ?? current).replace(/^[A-Z]{6}\+/, ""),
        });
      }
      const { font, family } = fonts.get(current)!;
      for (const raw of list.argsArray[k][0] as unknown[]) {
        if (!raw || typeof raw !== "object") continue;
        const g = raw as { unicode: string; fontChar: string; originalCharCode: number };
        const outline = font?.outline(g.fontChar.codePointAt(0) ?? -1);
        if (outline && !LETTER_RE.test(g.unicode)) {
          suspects.set(text.length, { font: current, family, code: g.originalCharCode, unicode: g.unicode, outline });
        } else if (outline) {
          const letters = twins.get(outline) ?? new Map<string, number>();
          letters.set(g.unicode, (letters.get(g.unicode) ?? 0) + 1);
          twins.set(outline, letters);
          const own = familyLetters.get(family) ?? new Set<string>();
          own.add(g.unicode.toLowerCase());
          familyLetters.set(family, own);
        }
        text += g.unicode;
      }
    }
    if (suspects.size) pages.set(number, { text, suspects });
    page.cleanup();
  }

  const letterOf = new Map<string, string>();
  for (const [outline, letters] of twins) letterOf.set(outline, [...letters].sort((a, b) => b[1] - a[1])[0][0]);

  // Resolve what has a twin; collect the rest per glyph.
  const known = new Map<string, string>(); // glyph key -> letter
  const lost = new Map<string, Glyph>();
  for (const { suspects } of pages.values()) {
    for (const glyph of suspects.values()) {
      const letter = letterOf.get(glyph.outline);
      if (letter) known.set(keyOf(glyph), letter);
      else if (glyph.unicode === " ") lost.set(keyOf(glyph), glyph);
    }
  }
  if (lost.size) for (const [key, letter] of guessLost(pages, known, lost, familyLetters)) known.set(key, letter);
  const fixes = new Map<number, ItemFix>();
  for (const [number, { text, suspects }] of pages) {
    const at = new Map<number, string>();
    for (const [offset, glyph] of suspects) {
      const letter = known.get(keyOf(glyph));
      if (letter) at.set(offset, letter);
    }
    if (at.size) fixes.set(number, (items) => applyToItems(items, text, at));
  }
  return fixes;
}

// pdf.js adds spaces between runs and may drop glyphs, so an item's characters are followed
// through the glyph text one by one instead of being looked up whole.
const SKIP_WINDOW = 8;

function applyToItems(items: { str: string }[], text: string, at: Map<number, string>): void {
  let from = 0;
  for (const item of items) {
    if (!item.str) continue;
    const head = item.str.slice(0, 10);
    let p = text.startsWith(head, from) ? from : text.indexOf(head, from);
    if (p < 0) p = from;
    let str = item.str;
    for (let i = 0; i < str.length; i++) {
      let q = p;
      if (text[q] !== str[i]) {
        q = str[i] === " " ? -1 : text.indexOf(str[i], p);
        if (q >= 0 && q - p > SKIP_WINDOW) q = -1;
      }
      if (q < 0) continue;
      const letter = at.get(q);
      if (letter) {
        // pdf.js merges the blank this glyph left with the space after it, so give it back.
        const space = text[q + 1] === " " && str[i + 1] !== " " ? " " : "";
        str = str.slice(0, i) + letter + space + str.slice(i + 1);
        i += space.length;
      }
      p = q + 1;
    }
    item.str = str;
    from = p;
  }
}

function guessLost(
  pages: Map<number, PageGlyphs>,
  known: Map<string, string>,
  lost: Map<string, Glyph>,
  familyLetters: Map<string, Set<string>>,
): Map<string, string> {
  // The text with every glyph resolved so far; HOLE marks a glyph still unknown.
  const vocab = new Map<string, number>();
  const patterns = new Map<string, Map<string, number>>(); // glyph key -> "left<hole>right" -> count
  for (const { text, suspects } of pages.values()) {
    let resolved = "";
    for (let i = 0; i < text.length; i++) {
      const glyph = suspects.get(i);
      resolved += glyph ? (known.get(keyOf(glyph)) ?? (lost.has(keyOf(glyph)) ? HOLE : text[i])) : text[i];
    }
    for (const word of resolved.toLowerCase().split(/[^\p{L}\u0001]+/u)) {
      if (word && !word.includes(HOLE)) vocab.set(word, (vocab.get(word) ?? 0) + 1);
    }
    for (const [offset, glyph] of suspects) {
      const key = keyOf(glyph);
      if (!lost.has(key)) continue;
      let left = offset;
      while (left > 0 && /\p{L}/u.test(resolved[left - 1])) left--;
      let right = offset + 1;
      while (right < resolved.length && /\p{L}/u.test(resolved[right])) right++;
      const pattern = `${resolved.slice(left, offset)}${HOLE}${resolved.slice(offset + 1, right)}`.toLowerCase();
      const own = patterns.get(key) ?? new Map<string, number>();
      own.set(pattern, (own.get(pattern) ?? 0) + 1);
      patterns.set(key, own);
    }
  }

  // A letter the same font already draws elsewhere is not this glyph's.
  const candidatesOf = (glyph: Glyph) => {
    const drawn = familyLetters.get(glyph.family) ?? new Set<string>();
    return VIETNAMESE.filter((letter) => !drawn.has(letter));
  };
  const scores: { key: string; letter: string; score: number }[] = [];
  for (const [key, glyph] of lost) {
    const candidates = candidatesOf(glyph);
    const votes = new Map<string, number>();
    const types = new Map<string, number>();
    for (const pattern of patterns.get(key)?.keys() ?? []) {
      const seen = candidates.map((letter) => [letter, vocab.get(pattern.replace(HOLE, letter)) ?? 0] as const);
      const total = seen.reduce((sum, [, n]) => sum + n, 0);
      for (const [letter, n] of seen) {
        if (!n) continue;
        votes.set(letter, (votes.get(letter) ?? 0) + n / total);
        types.set(letter, (types.get(letter) ?? 0) + 1);
      }
    }
    for (const [letter, score] of votes) if ((types.get(letter) ?? 0) >= MIN_PATTERNS) scores.push({ key, letter, score });
  }
  // One letter per glyph and one glyph per letter within a font, the surest first.
  const result = new Map<string, string>();
  const taken = new Set<string>();
  for (const { key, letter } of scores.sort((a, b) => b.score - a.score)) {
    const owner = `${lost.get(key)!.family}/${letter}`;
    if (result.has(key) || taken.has(owner)) continue;
    result.set(key, letter);
    taken.add(owner);
  }
  // A glyph seen only inside words, with a single letter of its font left over, is that letter
  // even when no word of the book spells it out (a letter that is lost everywhere).
  for (const [key, glyph] of lost) {
    const own = patterns.get(key);
    if (result.has(key) || !own) continue;
    const left = candidatesOf(glyph).filter((letter) => !taken.has(`${glyph.family}/${letter}`));
    const inside = [...own].every(([pattern]) => !pattern.startsWith(HOLE) && !pattern.endsWith(HOLE));
    const uses = [...own.values()].reduce((sum, n) => sum + n, 0);
    if (left.length === 1 && inside && uses >= MIN_USES) {
      result.set(key, left[0]);
      taken.add(`${glyph.family}/${left[0]}`);
    }
  }
  return result;
}
