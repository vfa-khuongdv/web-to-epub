import { useCallback, useEffect, useState } from "react";
import { drawCharacters, fetchIllustrated, removeCharacters } from "../../lib/api";
import { useLang } from "../../i18n";
import { IllustratedCharacter, IllustratedState } from "../../types";
import { Icon } from "../ui/Icon";

export type VideoStyleValue = "cover" | "illustrated";

// The server sanitizes every drawing (shape elements and flat colours only), so it is safe
// to inline; the face is moved to the head like the video does.
function CharacterPreview({ character }: { character: IllustratedCharacter }) {
  const markup = `${character.body}<g transform="translate(0 ${character.headY})">${character.faces.smile}</g>`;
  return (
    <figure className="m-0 flex w-20 flex-col items-center gap-0.5 text-center">
      <svg
        viewBox="-130 -520 260 540"
        width={64}
        height={132}
        role="img"
        aria-label={character.name}
        className="rounded-tool bg-sunken"
        dangerouslySetInnerHTML={{ __html: markup }}
      />
      <figcaption className="text-[11px] leading-tight text-ink-2" title={character.description}>
        {character.name}
      </figcaption>
    </figure>
  );
}

interface Props {
  storyId: string;
  value: VideoStyleValue;
  onChange: (value: VideoStyleValue) => void;
  disabled?: boolean;
  // Whether the story has drawn characters, so "Make videos" can wait for them.
  onReady: (ready: boolean) => void;
}

export function VideoStyle({ storyId, value, onChange, disabled, onReady }: Props) {
  const { t } = useLang();
  const [state, setState] = useState<IllustratedState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const next = await fetchIllustrated(storyId);
      setState(next);
      onReady(Boolean(next.bible));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [storyId, onReady]);

  useEffect(() => {
    void load();
  }, [load]);

  async function draw() {
    if (state?.bible && !window.confirm(t("Draw the characters again? Scenes already planned for chapters are discarded."))) return;
    setBusy(true);
    setError("");
    try {
      const next = await drawCharacters(storyId);
      setState(next);
      onReady(Boolean(next.bible));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await removeCharacters(storyId);
      await load();
    } finally {
      setBusy(false);
    }
  }

  const bible = state?.bible ?? null;
  return (
    <div className="field sm:col-span-2">
      <span className="label">{t("Video style")}</span>
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="input"
          aria-label={t("Video style")}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value as VideoStyleValue)}
        >
          <option value="cover">{t("Cover image")}</option>
          <option value="illustrated">{t("Illustrated scenes")}</option>
        </select>
        {value === "illustrated" && (
          <>
            <button
              type="button"
              className="btn btn-quiet btn-tiny"
              disabled={disabled || busy || !state?.agentAvailable}
              title={state && !state.agentAvailable ? t("Turn on the agent in Settings → Agent crawler first") : undefined}
              onClick={() => void draw()}
            >
              <Icon name="sparkles" size={12} />
              {busy ? t("Drawing the characters…") : bible ? t("Draw again") : t("Draw the characters")}
            </button>
            {bible && (
              <button type="button" className="btn btn-quiet btn-tiny" disabled={disabled || busy} onClick={() => void remove()}>
                {t("Remove characters")}
              </button>
            )}
          </>
        )}
      </div>
      {value === "illustrated" && (
        <>
          {bible ? (
            <div className="mt-1 flex flex-wrap gap-2">
              {bible.characters.map((character) => (
                <CharacterPreview key={character.id} character={character} />
              ))}
            </div>
          ) : (
            <p className="mt-0.5 text-[11px] leading-snug text-ink-3">
              {t("The agent reads the first chapters and draws the main characters once; every chapter then reuses them, so they look the same throughout. Planning a chapter's scenes uses the agent and a render takes much longer than the cover video.")}
            </p>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="mt-0.5 text-[11px] text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
