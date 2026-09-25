// Bridge for the EPUB export folder picker: the web File System Access API
// (window.showDirectoryPicker) turned out unreliable inside Electron's renderer (macOS
// reports "Failed to execute 'showDirectoryPicker'" / it hangs with no dialog shown), so
// the packaged app instead uses Electron's own native dialog + fs, reached through this
// contextBridge since nodeIntegration is off.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronExport", {
  // Resolves to the chosen folder's path, or null if the reader cancelled the dialog.
  pickFolder: () => ipcRenderer.invoke("export:pick-folder"),
  // `data` is the file's bytes as an ArrayBuffer (structured-cloned over IPC).
  writeFile: (folderPath, fileName, data) => ipcRenderer.invoke("export:write-file", folderPath, fileName, data),
  // Streams a file the app's own server prepared (narration zips) into the folder.
  saveUrl: (folderPath, fileName, url) => ipcRenderer.invoke("export:save-url", folderPath, fileName, url),
});

// Update bridge: the packaged app downloads a release zip and replaces its own
// bundle (electron/main.js); the renderer only asks and watches progress.
contextBridge.exposeInMainWorld("electronUpdate", {
  install: (zipUrl) => ipcRenderer.invoke("update:install", zipUrl),
  onProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on("update:progress", listener);
    return () => ipcRenderer.removeListener("update:progress", listener);
  },
});
