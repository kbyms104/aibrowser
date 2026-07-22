const { contextBridge, ipcRenderer } = require('electron');

// Expose safe IPC channels to the renderer window using CommonJS syntax
contextBridge.exposeInMainWorld('electronAPI', {
  captureWebview: (webContentsId) => ipcRenderer.invoke('capture-webview', webContentsId),
  runUniversalCli: (params) => ipcRenderer.invoke('run-universal-cli', params),
  runLocalHttp: (params) => ipcRenderer.invoke('run-local-http', params),
  runDirectApi: (params) => ipcRenderer.invoke('run-direct-api', params),
  downloadMedia: (params) => ipcRenderer.invoke('download-media', params),
  abortAgentExecution: () => ipcRenderer.invoke('abort-agent-execution'),
  getGuestPreloadPath: () => ipcRenderer.invoke('get-guest-preload-path'),
  clearCache: () => ipcRenderer.invoke('clear-cache'),
  onVideoDetected: (callback) => ipcRenderer.on('video-detected', (event, data) => callback(data)),
  onOpenTabRequest: (callback) => ipcRenderer.on('open-tab-request', (event, url) => callback(url)),
  writeLog: (message) => ipcRenderer.invoke('write-log', message),
  readSourceFile: (filename) => ipcRenderer.invoke('read-source-file', filename),
  writeSourceFile: (filename, content) => ipcRenderer.invoke('write-source-file', { filename, content }),
  relaunchApp: () => ipcRenderer.invoke('relaunch-app'),
  launchStealthChrome: () => ipcRenderer.invoke('launch-stealth-chrome'),
  evalRealChrome: (params) => ipcRenderer.invoke('eval-real-chrome', params),
  getRealChromeState: () => ipcRenderer.invoke('get-real-chrome-state'),
  cdpAction: (params) => ipcRenderer.invoke('cdp-action', params)
});
