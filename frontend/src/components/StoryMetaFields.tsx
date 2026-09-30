import type { RefObject } from "react";
import { useLang } from "../i18n";

// The editable book details: title, author, language and cover file. The parent owns the
// values (they are saved together with "Save metadata").
export default function StoryMetaFields({
  bookTitle,
  onBookTitle,
  author,
  onAuthor,
  language,
  onLanguage,
  coverInput,
  onCoverFile,
}: {
  bookTitle: string;
  onBookTitle: (value: string) => void;
  author: string;
  onAuthor: (value: string) => void;
  language: string;
  onLanguage: (value: string) => void;
  coverInput: RefObject<HTMLInputElement>;
  onCoverFile: (file: File | null) => void;
}) {
  const { t } = useLang();
  return (
    <div className="fields">
      <div className="field">
        <label htmlFor="story-title">{t("Book title")}</label>
      <input
        id="story-title"
        type="text"
        className="input"
        value={bookTitle}
        onChange={(e) => onBookTitle(e.target.value)}
      />
      </div>
      <div className="field">
        <label htmlFor="story-author">{t("Author")}</label>
      <input
        id="story-author"
        type="text"
        className="input"
        value={author}
        onChange={(e) => onAuthor(e.target.value)}
      />
      </div>
      <div className="field">
        <label htmlFor="story-language">{t("Book language")}</label>
      <select
        id="story-language"
        className="input"
        value={language}
        onChange={(e) => onLanguage(e.target.value)}
      >
        <option value="vi">{t("Vietnamese")}</option>
        <option value="en">{t("English")}</option>
      </select>
      </div>
      <div className="field">
        <label htmlFor="story-cover">{t("Cover image")}</label>
      <input
        id="story-cover"
        ref={coverInput}
        type="file"
        className="file-input"
        accept="image/*"
        onChange={(e) => onCoverFile(e.target.files?.[0] || null)}
      />
        <p className="cover-hint">{t("Cover auto-downloads during crawl. Select a new image, then click Save metadata to change it.")}</p>
      </div>
    </div>
  );
}
