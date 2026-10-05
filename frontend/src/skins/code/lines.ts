// A chapter drawn as a Markdown file: paragraph i sits on editor line 2i+1 with an empty
// line between paragraphs, the way Markdown separates them. Positions are stored by
// paragraph index (the same `line` the spreadsheet skin stores), never by editor line.

export function editorLine(paragraph: number): number {
  return paragraph * 2 + 1;
}

export function editorLineCount(paragraphs: number): number {
  return paragraphs <= 0 ? 1 : paragraphs * 2 - 1;
}

// The paragraph an editor line belongs to (an empty line counts with the one above it).
export function paragraphOf(line: number): number {
  return Math.max(0, Math.floor((line - 1) / 2));
}

export function clampParagraph(paragraph: number, paragraphs: number): number {
  if (paragraphs <= 0) return 0;
  return Math.min(Math.max(0, Math.floor(paragraph)), paragraphs - 1);
}

/**
 * The row at the top of a scrolled view: the last row whose top is at or above
 * `scrollTop`, given the rows' tops in ascending order. Binary search, since a long
 * chapter has hundreds of rows and this runs while scrolling.
 */
export function firstVisible(tops: number[], scrollTop: number): number {
  if (tops.length === 0) return 0;
  let low = 0;
  let high = tops.length - 1;
  let found = 0;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (tops[mid] <= scrollTop) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found;
}
