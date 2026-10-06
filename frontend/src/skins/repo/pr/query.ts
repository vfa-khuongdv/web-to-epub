// The filter box above the issue and pull request lists, as the site reads it:
// "is:pr is:open label:bug author:lan-pt variance". The Open / Closed toggles rewrite the
// state part of the query, so the box and the toggles never disagree.

export type ItemState = "open" | "closed" | "merged";

export interface ListItemLike {
  number: number;
  title: string;
  author: string;
  labels: { name: string }[];
  state: ItemState;
}

export interface ListQuery {
  state: "open" | "closed" | null;
  merged: boolean;
  labels: string[];
  author: string | null;
  words: string[];
}

function tokens(query: string): string[] {
  return [...query.matchAll(/(\S+?:"[^"]*"|"[^"]*"|\S+)/g)].map((match) => match[0]);
}

const unquote = (value: string) => value.replace(/^"|"$/g, "");

export function parseQuery(query: string): ListQuery {
  const result: ListQuery = { state: null, merged: false, labels: [], author: null, words: [] };
  for (const token of tokens(query)) {
    const colon = token.indexOf(":");
    const key = colon > 0 ? token.slice(0, colon).toLowerCase() : "";
    const value = colon > 0 ? unquote(token.slice(colon + 1)).toLowerCase() : "";
    if ((key === "is" || key === "state") && (value === "open" || value === "closed")) result.state = value;
    else if (key === "is" && value === "merged") {
      result.state = "closed";
      result.merged = true;
    } else if (key === "is" || key === "sort" || key === "no") continue;
    else if (key === "label") result.labels.push(value);
    else if (key === "author") result.author = value;
    else result.words.push(unquote(token).toLowerCase());
  }
  return result;
}

export function matchesQuery(item: ListItemLike, query: ListQuery): boolean {
  if (query.state === "open" && item.state !== "open") return false;
  if (query.state === "closed" && item.state === "open") return false;
  if (query.merged && item.state !== "merged") return false;
  if (query.author && item.author.toLowerCase() !== query.author) return false;
  const labels = item.labels.map((label) => label.name.toLowerCase());
  if (query.labels.some((label) => !labels.includes(label))) return false;
  const haystack = `${item.title} #${item.number}`.toLowerCase();
  return query.words.every((word) => haystack.includes(word));
}

// The query with its state part set to `state` (added when missing), the rest kept.
export function withState(query: string, state: "open" | "closed"): string {
  const kept = tokens(query).filter((token) => !/^(is|state):(open|closed|merged)$/i.test(token));
  const at = kept.findIndex((token) => /^is:(pr|issue)$/i.test(token));
  kept.splice(at + 1, 0, `is:${state}`);
  return kept.join(" ");
}

// The open and closed counts beside the toggles, for everything else the query asks.
export function stateCounts(items: ListItemLike[], query: ListQuery): { open: number; closed: number } {
  const rest = { ...query, state: null, merged: false };
  let open = 0;
  let closed = 0;
  for (const item of items) {
    if (!matchesQuery(item, rest)) continue;
    if (item.state === "open") open++;
    else closed++;
  }
  return { open, closed };
}
