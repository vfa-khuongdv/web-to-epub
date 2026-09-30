import { useLang } from "../i18n";
import { FONT_SIZE_RANGE, LINE_HEIGHTS, READER_FONTS, ReaderPrefs, ReaderTheme } from "../lib/readerPreview";

const THEME_LABEL: Record<ReaderTheme, string> = { light: "Paper", sepia: "Sepia", dark: "Night" };
const LINE_HEIGHT_LABEL: Record<string, string> = { "1.4": "Tight", "1.5": "Book", "1.8": "Loose" };

// The reader's "Text settings" panel: size, line spacing, font and page theme.
export default function ReaderTextPanel({
  prefs,
  onChange,
}: {
  prefs: ReaderPrefs;
  onChange: (patch: Partial<ReaderPrefs>) => void;
}) {
  const { t } = useLang();
  return (
    <aside className="reader-panel" aria-label={t("Text settings")}>
      <div className="field">
        <label>{t("Text size")}</label>
        <div className="reader-seg">
          <button
            type="button"
            disabled={prefs.fontSize <= FONT_SIZE_RANGE.min}
            aria-label={t("Smaller text")}
            onClick={() => onChange({ fontSize: prefs.fontSize - FONT_SIZE_RANGE.step })}
          >
            A−
          </button>
          <span className="reader-seg-value">{prefs.fontSize}px</span>
          <button
            type="button"
            disabled={prefs.fontSize >= FONT_SIZE_RANGE.max}
            aria-label={t("Larger text")}
            onClick={() => onChange({ fontSize: prefs.fontSize + FONT_SIZE_RANGE.step })}
          >
            A+
          </button>
        </div>
      </div>
      <div className="field">
        <label>{t("Line spacing")}</label>
        <div className="reader-seg">
          {LINE_HEIGHTS.map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={prefs.lineHeight === value}
              onClick={() => onChange({ lineHeight: value })}
            >
              {t(LINE_HEIGHT_LABEL[String(value)])}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <label>{t("Font")}</label>
        {/* Each choice is written in the family it selects, so the list is its own
            sample — the reason to pick one is what it looks like. */}
        <div className="reader-seg reader-seg-col">
          {READER_FONTS.map((font) => (
            <button
              key={font.id}
              type="button"
              style={{ fontFamily: font.stack }}
              aria-pressed={prefs.font === font.id}
              onClick={() => onChange({ font: font.id })}
            >
              {t(font.label)}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <label>{t("Page")}</label>
        <div className="reader-seg">
          {(Object.keys(THEME_LABEL) as ReaderTheme[]).map((theme) => (
            <button
              key={theme}
              type="button"
              aria-pressed={prefs.theme === theme}
              onClick={() => onChange({ theme })}
            >
              {t(THEME_LABEL[theme])}
            </button>
          ))}
        </div>
      </div>
      <p className="text-xs text-ink-3">
        {t(
          "Spacing and images come from the book's own stylesheet, so this page is what the exported EPUB contains. These settings only change how you read here — like the text controls on a Kindle, they are not written into the file."
        )}
      </p>
    </aside>
  );
}
