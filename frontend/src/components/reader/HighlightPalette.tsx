import { HIGHLIGHT_COLORS, HighlightColor } from "../../lib/api";
import * as hl from "../../lib/reader/highlightDom";
import { useLang } from "../../i18n";
import { Icon } from "../ui/Icon";

const COLOR_LABEL: Record<HighlightColor, string> = {
  yellow: "Yellow",
  green: "Green",
  blue: "Blue",
  pink: "Pink",
};

// Where the colour palette sits: over a fresh selection, or over a highlight that was
// clicked (which can also be recoloured or removed).
export interface Palette {
  left: number;
  top: number;
  below: boolean;
  target: { kind: "selection"; start: number; end: number; text: string } | { kind: "highlight"; id: string };
}

export default function HighlightPalette({
  palette,
  onColor,
  onRemove,
}: {
  palette: Palette;
  onColor: (color: HighlightColor) => void;
  onRemove: (id: string) => void;
}) {
  const { t } = useLang();
  return (
    <div
      className={palette.below ? "reader-palette reader-palette-below" : "reader-palette"}
      style={{ left: palette.left, top: palette.top }}
      role="group"
      aria-label={t("Highlight colour")}
    >
      {HIGHLIGHT_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          className="reader-swatch"
          style={{ background: hl.SWATCH[color] }}
          title={t(COLOR_LABEL[color])}
          aria-label={t(COLOR_LABEL[color])}
          onClick={() => onColor(color)}
        />
      ))}
      {palette.target.kind === "highlight" && (
        <button
          type="button"
          className="reader-swatch reader-swatch-remove"
          title={t("Remove highlight")}
          aria-label={t("Remove highlight")}
          onClick={() => onRemove((palette.target as { id: string }).id)}
        >
          <Icon name="trash" size={12} />
        </button>
      )}
    </div>
  );
}
