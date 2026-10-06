// The default avatars of a code-hosting site: a 5×5 mirrored pattern of blocks in one
// colour, derived from a name. Generic (no mascot, no mark), and stable per name.

import { hashString } from "../../lib/skins/hash";

export interface Identicon {
  // 25 cells, row by row; true is a coloured block.
  cells: boolean[];
  hue: number;
}

export function identicon(seed: string): Identicon {
  const value = hashString(seed);
  const cells: boolean[] = [];
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 5; col++) {
      // The left three columns come from the hash; the right two mirror them.
      const source = col < 3 ? col : 4 - col;
      cells.push(((value >>> (row * 3 + source)) & 1) === 1);
    }
  }
  return { cells, hue: (value >>> 15) % 360 };
}
