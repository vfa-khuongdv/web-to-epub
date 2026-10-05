// File and folder names for the disguise skins. A Vietnamese story title becomes a plain
// ASCII slug, so a folder in the code skin or a sheet tab reads like any project file
// ("tro-ve-thoi-nien-thieu/ch-0012-gap-lai.md") instead of a book title with diacritics.

const MAX_SLUG = 40;

export function slugify(text: string, max = MAX_SLUG): string {
  const ascii = text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase();
  const slug = ascii.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (slug.length <= max) return slug;
  const cut = slug.slice(0, max);
  // End on a whole word when there is one to end on.
  const lastDash = cut.lastIndexOf("-");
  return (lastDash > max / 2 ? cut.slice(0, lastDash) : cut).replace(/-+$/g, "");
}

export function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

// Neutral names hide the story behind a numbered module; `index` is the story's position
// in the list being shown (0-based), so the same story keeps its name while the list does.
export function storyFolderName(title: string, index: number, neutral: boolean): string {
  if (neutral) return `module-${pad(index + 1, 2)}`;
  return slugify(title) || `module-${pad(index + 1, 2)}`;
}

export function chapterFileName(order: number, title: string, neutral: boolean, extension = "md"): string {
  const number = pad(order, 4);
  if (neutral) return `part-${number}.${extension}`;
  const slug = slugify(title, 32);
  return slug ? `ch-${number}-${slug}.${extension}` : `ch-${number}.${extension}`;
}

// Spreadsheet sheet names: at most 31 characters, none of []:*?/\ (the real limits).
export function sheetName(title: string, index: number, neutral: boolean): string {
  const base = neutral ? `Sheet${index + 1}` : slugify(title, 31).replace(/-/g, "_") || `Sheet${index + 1}`;
  return base.slice(0, 31);
}
