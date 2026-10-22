// Tab completion at the end of the prompt, as zsh does it: the first word from the
// command names, later words from the folder they point into. One match is filled in
// (a folder with "/", a file with a space); several are filled to their common start,
// and listed when that adds nothing.

export interface CompletionEntry {
  name: string;
  dir: boolean;
}

export interface Completion {
  input: string;
  // Shown under the prompt when the typed start is shared by several names.
  candidates: string[];
}

function commonPrefix(names: string[]): string {
  if (names.length === 0) return "";
  let prefix = names[0];
  for (const name of names.slice(1)) {
    let at = 0;
    while (at < prefix.length && at < name.length && prefix[at] === name[at]) at++;
    prefix = prefix.slice(0, at);
  }
  return prefix;
}

function startsWith(names: string[], prefix: string): string[] {
  const exact = names.filter((name) => name.startsWith(prefix));
  if (exact.length > 0 || !prefix) return exact;
  const lower = prefix.toLowerCase();
  return names.filter((name) => name.toLowerCase().startsWith(lower));
}

export function complete(
  input: string,
  options: {
    commands: string[];
    // The entries of the folder a typed path part points into ("" is the current one),
    // or null when it is not a folder or not loaded.
    list: (dirPart: string) => CompletionEntry[] | null;
  }
): Completion {
  const start = input.search(/\S+$/);
  const word = start >= 0 ? input.slice(start) : "";
  const head = start >= 0 ? input.slice(0, start) : input;
  const none = { input, candidates: [] };

  if (!head.trim()) {
    const matches = startsWith(options.commands, word);
    if (matches.length === 1) return { input: `${head}${matches[0]} `, candidates: [] };
    const prefix = commonPrefix(matches);
    if (prefix.length > word.length) return { input: head + prefix, candidates: [] };
    return { input, candidates: matches };
  }

  if (word === ".." || word.endsWith("/..")) return { input: `${input}/`, candidates: [] };
  const slash = word.lastIndexOf("/");
  const dirPart = slash >= 0 ? word.slice(0, slash + 1) : "";
  const prefix = slash >= 0 ? word.slice(slash + 1) : word;
  const entries = options.list(dirPart);
  if (!entries) return none;
  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  const matches = startsWith(
    entries.map((entry) => entry.name),
    prefix
  );
  if (matches.length === 0) return none;
  if (matches.length === 1) {
    const entry = byName.get(matches[0])!;
    return { input: `${head}${dirPart}${entry.name}${entry.dir ? "/" : " "}`, candidates: [] };
  }
  const common = commonPrefix(matches);
  if (common.length > prefix.length) return { input: `${head}${dirPart}${common}`, candidates: [] };
  return { input, candidates: matches.map((name) => (byName.get(name)?.dir ? `${name}/` : name)) };
}
