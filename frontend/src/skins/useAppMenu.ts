import { useCallback, useMemo, useState } from "react";
import { useLang } from "../i18n";
import { SKIN_IDS } from "../lib/ui/skin";
import { requestStealthToggle } from "../lib/ui/stealth";
import { MenuAnchor, MenuEntry, anchorFor } from "./AppMenu";
import { SKINS } from "./registry";
import { useSkin } from "./SkinProvider";

// The looks as a group of radio items: one click switches, the current one is checked.
export function useLookEntries(): MenuEntry[] {
  const { t } = useLang();
  const { skin, setSkin } = useSkin();
  return useMemo(
    () => [
      { kind: "heading", id: "look-heading", label: t("Appearance") },
      ...SKIN_IDS.map(
        (id): MenuEntry => ({
          kind: "item",
          id: `look-${id}`,
          label: t(SKINS[id].label),
          checked: id === skin,
          run: () => setSkin(id),
        })
      ),
    ],
    [skin, setSkin, t]
  );
}

/**
 * The menu every skin opens from its own "File" (and similar) controls, so nothing needs
 * a shortcut: the normal view at what is open, the looks, settings, and hiding the screen.
 */
export function useAppMenuEntries(actions: { openInDefault: () => void; openSettings: () => void }): MenuEntry[] {
  const { t } = useLang();
  const looks = useLookEntries();
  const { openInDefault, openSettings } = actions;
  return useMemo(
    () => [
      { kind: "item", id: "open-default", label: t("Open in the normal view"), run: openInDefault },
      { kind: "separator", id: "sep-1" },
      ...looks,
      { kind: "separator", id: "sep-2" },
      { kind: "item", id: "settings", label: t("Settings"), run: openSettings },
      { kind: "item", id: "hide", label: t("Hide now"), hint: "`", run: requestStealthToggle },
    ],
    [looks, openInDefault, openSettings, t]
  );
}

// Which menu is open and where: `open(id, element)` from a click, `close()` to dismiss.
export function useMenuState<Id extends string>() {
  const [state, setState] = useState<{ id: Id; anchor: MenuAnchor } | null>(null);
  const open = useCallback(
    (id: Id, element: Element, placement: MenuAnchor["placement"] = "below") =>
      setState((current) => (current?.id === id ? null : { id, anchor: anchorFor(element, placement) })),
    []
  );
  const close = useCallback(() => setState(null), []);
  return { menu: state, open, close };
}
