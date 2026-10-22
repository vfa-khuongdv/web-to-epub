// Some Vietnamese PDFs come from a legacy font whose embedded text layer stores accented
// letters as ASCII symbols: "đ|n ông" for "đàn ông", "c{ch" for "cách", "nh}n" for "nhân".
// The symbol that stands for a letter differs per font, so each symbol's letter is voted from
// the document's own clean words instead of being hard-coded.

const SYMBOLS = "|{}";
const LETTERS = [..."àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵ"];
const WORD_RE = /[\p{L}|{}]+/gu;
const SYMBOL_RE = /[|{}]/;
// Too few occurrences is a stray character, not a font quirk; a letter that does not beat the
// runner-up clearly is a guess.
const MIN_OCCURRENCES = 20;
const MIN_LEAD = 2;

export function symbolLetters(texts: string[]): Map<string, string> {
  const vocab = new Map<string, number>();
  const broken = new Map<string, Map<string, number>>();
  for (const text of texts) {
    for (const [word] of text.toLowerCase().matchAll(WORD_RE)) {
      if (!SYMBOL_RE.test(word)) {
        vocab.set(word, (vocab.get(word) ?? 0) + 1);
      } else if (/\p{L}/u.test(word)) {
        for (const symbol of SYMBOLS) {
          if (word.split(symbol).length !== 2) continue;
          const words = broken.get(symbol) ?? new Map<string, number>();
          words.set(word, (words.get(word) ?? 0) + 1);
          broken.set(symbol, words);
        }
      }
    }
  }
  const result = new Map<string, string>();
  for (const [symbol, words] of broken) {
    // Each distinct word casts one vote, split between the letters that make a real word by
    // how common each is, so the many different words decide, not a short, very common one
    // ("v|" -> và or vì) or a single close call ("nh}n" -> nhân or nhận).
    const votes = new Map<string, number>();
    let occurrences = 0;
    for (const [word, count] of words) {
      occurrences += count;
      const seen = LETTERS.map((letter) => [letter, vocab.get(word.replace(symbol, letter)) ?? 0] as const);
      const total = seen.reduce((sum, [, n]) => sum + n, 0);
      for (const [letter, n] of seen) if (n) votes.set(letter, (votes.get(letter) ?? 0) + n / total);
    }
    const [[letter, best] = ["", 0], [, second] = ["", 0]] = [...votes].sort((a, b) => b[1] - a[1]);
    if (occurrences >= MIN_OCCURRENCES && best >= second * MIN_LEAD) result.set(symbol, letter);
  }
  return result;
}

export function applySymbolLetters(text: string, letters: Map<string, string>): string {
  if (!letters.size) return text;
  return text.replace(/(?<=(\p{L}))[|{}]|[|{}](?=(\p{L}))/gu, (symbol, before: string | undefined, after: string | undefined) => {
    const letter = letters.get(symbol);
    if (!letter) return symbol;
    const neighbour = before ?? after ?? "";
    const upper = neighbour !== neighbour.toLowerCase() && neighbour === neighbour.toUpperCase();
    return upper ? letter.toUpperCase() : letter;
  });
}

// Symbols inside words, or the stray one-and-two-consonant fragments that a dropped vowel
// leaves ("c ng", "v n"), in volume: the text layer is wrong and the glyphs are worth reading.
export function looksBroken(texts: string[]): boolean {
  const text = texts.join("\n");
  const symbols = text.match(/\p{L}[|{}]|[|{}]\p{L}/gu)?.length ?? 0;
  const gaps = text.match(/(?<![\p{L}])[bcdđghklmnpqrstvx]{1,2} [bcdghklmnpqrstvx]{1,3}(?![\p{L}])/giu)?.length ?? 0;
  return symbols >= MIN_OCCURRENCES || gaps >= 30;
}
