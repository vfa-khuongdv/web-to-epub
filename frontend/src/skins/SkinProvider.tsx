import { ReactNode, createContext, useCallback, useContext, useEffect, useState } from "react";
import { SkinId, applySkin, readSkin, saveSkin } from "../lib/ui/skin";
import { StealthPrefs, readStealth, saveStealth } from "../lib/ui/stealth";

interface SkinValue {
  skin: SkinId;
  setSkin: (skin: SkinId) => void;
  prefs: StealthPrefs;
  setPrefs: (patch: Partial<StealthPrefs>) => void;
  // Whether the boss key's decoy is up (skins/StealthLayer.tsx). Kept here, above the
  // private-mode remount, so a library switch (or an expired private session) while the
  // user is away does not take the decoy down.
  hidden: boolean;
  setHidden: (hidden: boolean) => void;
}

const SkinContext = createContext<SkinValue>({
  skin: "default",
  setSkin: () => {},
  prefs: readStealth(),
  setPrefs: () => {},
  hidden: false,
  setHidden: () => {},
});

// Above the vault provider (main.tsx): switching to the private library remounts App,
// and the disguise must survive that — a skin that dropped back to the real app on the
// way into private mode would give the game away.
export function SkinProvider({ children }: { children: ReactNode }) {
  const [skin, setSkinState] = useState<SkinId>(readSkin);
  const [prefs, setPrefsState] = useState<StealthPrefs>(readStealth);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    applySkin(skin);
    saveSkin(skin);
  }, [skin]);

  const setSkin = useCallback((next: SkinId) => setSkinState(next), []);

  const setPrefs = useCallback((patch: Partial<StealthPrefs>) => {
    setPrefsState((current) => {
      const next = { ...current, ...patch };
      saveStealth(next);
      return next;
    });
  }, []);

  return (
    <SkinContext.Provider value={{ skin, setSkin, prefs, setPrefs, hidden, setHidden }}>{children}</SkinContext.Provider>
  );
}

export function useSkin(): SkinValue {
  return useContext(SkinContext);
}
