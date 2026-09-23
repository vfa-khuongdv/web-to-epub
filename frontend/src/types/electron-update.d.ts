// Exposed by electron/preload.js only inside the packaged app — download and install
// of a new release (electron/main.js, src/services/appInstaller.ts).
interface ElectronUpdateProgress {
  received?: number;
  total?: number;
  installing?: boolean;
}

interface ElectronUpdateBridge {
  install(zipUrl: string): Promise<void>;
  // Returns an unsubscribe function; the banner removes its listener on unmount.
  onProgress(callback: (progress: ElectronUpdateProgress) => void): () => void;
}

interface Window {
  electronUpdate?: ElectronUpdateBridge;
}
