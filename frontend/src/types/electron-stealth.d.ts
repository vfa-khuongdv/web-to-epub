// Exposed by electron/preload.js inside the desktop app — the opt-in system-wide boss key
// (Settings → Disguise). The page asks for it and is told when it fires.
interface ElectronStealthBridge {
  // Whether the shortcut is now registered; false when turned off or another app owns it.
  setGlobalKey(enabled: boolean): boolean;
  // Returns an unsubscribe function.
  onBossKey(callback: () => void): () => void;
}

interface Window {
  electronStealth?: ElectronStealthBridge;
}
