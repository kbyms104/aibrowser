const { contextBridge, ipcRenderer } = require('electron');

// Expose safe, secure IPC channel bridge to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  captureWebview: (webContentsId) => ipcRenderer.invoke('capture-webview', webContentsId),
  runUniversalCli: (params) => ipcRenderer.invoke('run-universal-cli', params),
  runLocalHttp: (params) => ipcRenderer.invoke('run-local-http', params),
  runDirectApi: (params) => ipcRenderer.invoke('run-direct-api', params),
  downloadMedia: (params) => ipcRenderer.invoke('download-media', params),
  getGuestPreloadPath: () => ipcRenderer.invoke('get-guest-preload-path'),
  clearCache: () => ipcRenderer.invoke('clear-cache'),
  onVideoDetected: (callback) => ipcRenderer.on('video-detected', (event, data) => callback(data)),
  onOpenTabRequest: (callback) => ipcRenderer.on('open-tab-request', (event, url) => callback(url)),
  launchStealthChrome: () => ipcRenderer.invoke('launch-stealth-chrome'),
  evalRealChrome: (params) => ipcRenderer.invoke('eval-real-chrome', params),
  getRealChromeState: () => ipcRenderer.invoke('get-real-chrome-state'),
  cdpAction: (params) => ipcRenderer.invoke('cdp-action', params)
});
