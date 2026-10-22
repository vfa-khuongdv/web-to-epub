// A typed command line split the way a shell splits it: words on spaces, '…' and "…"
// keep spaces, a backslash escapes the next character, a trailing & runs it in the
// background. No variables, globs, pipes or redirection — the shell answers those itself.

export interface ParsedLine {
  name: string;
  args: string[];
  background: boolean;
  // An opening quote that was never closed (zsh waits for more input; here an error).
  unclosed: "'" | '"' | null;
}

export function parseLine(input: string): ParsedLine {
  const words: string[] = [];
  let word = "";
  let inWord = false;
  let quote: "'" | '"' | null = null;
  for (let at = 0; at < input.length; at++) {
    const char = input[at];
    if (quote) {
      if (char === quote) quote = null;
      else if (char === "\\" && quote === '"' && at + 1 < input.length) word += input[++at];
      else word += char;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      inWord = true;
    } else if (char === "\\" && at + 1 < input.length) {
      word += input[++at];
      inWord = true;
    } else if (/\s/.test(char)) {
      if (inWord) words.push(word);
      word = "";
      inWord = false;
    } else {
      word += char;
      inWord = true;
    }
  }
  if (inWord) words.push(word);
  let background = false;
  const last = words[words.length - 1];
  if (last === "&") {
    background = true;
    words.pop();
  } else if (last && last.endsWith("&") && !last.endsWith("\\&")) {
    background = true;
    words[words.length - 1] = last.slice(0, -1);
  }
  const [name = "", ...args] = words;
  return { name, args, background, unclosed: quote };
}

export interface Options {
  // Single-letter flags, from -l, -la, -n 20 (the letter), -20 (as "n").
  flags: Set<string>;
  // A value given to an option that takes one: -n 20 / -n20 / -20 → { n: "20" }.
  values: Record<string, string>;
  operands: string[];
  // A flag the command does not know, for its "invalid option" error.
  invalid: string | null;
}

/**
 * Short options as getopt reads them: flags may be combined (-la), `withValue` letters
 * take the next word or the rest of the word, `-N` is `-n N` (head/tail), `--` ends them.
 */
export function readOptions(args: string[], known: string, withValue = ""): Options {
  const options: Options = { flags: new Set(), values: {}, operands: [], invalid: null };
  for (let at = 0; at < args.length; at++) {
    const arg = args[at];
    if (arg === "--") {
      options.operands.push(...args.slice(at + 1));
      break;
    }
    if (!arg.startsWith("-") || arg === "-") {
      options.operands.push(arg);
      continue;
    }
    if (/^-\d+$/.test(arg) && withValue.includes("n")) {
      options.values.n = arg.slice(1);
      continue;
    }
    for (let i = 1; i < arg.length; i++) {
      const letter = arg[i];
      if (withValue.includes(letter)) {
        const rest = arg.slice(i + 1);
        const value = rest || args[++at];
        if (value === undefined) options.invalid = letter;
        else options.values[letter] = value;
        break;
      }
      if (!known.includes(letter)) {
        options.invalid = options.invalid ?? letter;
        continue;
      }
      options.flags.add(letter);
    }
  }
  return options;
}
