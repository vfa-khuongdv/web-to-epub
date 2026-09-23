// Exposed by electron/preload.js only inside the packaged app — a native folder dialog
// + fs.writeFile bridge for EPUB export. The web equivalent (window.showDirectoryPicker)
// was tried first but dropped: Chrome refuses write access to several whole well-known
// folders (home, Desktop, Documents, Downloads itself) with "can't open this folder
// because it contains system files", which made it unusable for this.
interface ElectronExportBridge {
  pickFolder(): Promise<string | null>;
  writeFile(folderPath: string, fileName: string, data: ArrayBuffer): Promise<void>;
}

interface Window {
  electronExport?: ElectronExportBridge;
}
