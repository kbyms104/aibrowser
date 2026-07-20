// guest-preload.js
// This script runs inside the guest page BEFORE any other scripts execute,
// masking all Electron/automation fingerprints to make the browser look 100% human.

// 1. Hide Automation Webdriver property
Object.defineProperty(navigator, 'webdriver', {
  get: () => undefined
});

// 2. Spoof Chrome User-Agent Client Hints (userAgentData)
const userAgentData = {
  brands: [
    { brand: 'Not A(Browser', version: '99' },
    { brand: 'Google Chrome', version: '122' },
    { brand: 'Chromium', version: '122' }
  ],
  mobile: false,
  platform: 'Windows'
};
Object.defineProperty(navigator, 'userAgentData', {
  get: () => userAgentData
});

// 3. Spoof Default Languages & Localization
Object.defineProperty(navigator, 'languages', {
  get: () => ['ko-KR', 'ko', 'en-US', 'en']
});
Object.defineProperty(navigator, 'language', {
  get: () => 'ko-KR'
});

// 4. Spoof Chrome Standard PDF/Default Plugins
const mockPlugins = [
  { name: 'PDF Viewer', description: 'Portable Document Format', filename: 'internal-pdf-viewer' },
  { name: 'Chrome PDF Viewer', description: 'Portable Document Format', filename: 'internal-pdf-viewer' },
  { name: 'Chromium PDF Viewer', description: 'Portable Document Format', filename: 'internal-pdf-viewer' },
  { name: 'Microsoft Edge PDF Viewer', description: 'Portable Document Format', filename: 'internal-pdf-viewer' },
  { name: 'WebKit built-in PDF', description: 'Portable Document Format', filename: 'internal-pdf-viewer' }
];

Object.defineProperty(navigator, 'plugins', {
  get: () => {
    const list = [];
    mockPlugins.forEach(p => {
      const plugin = Object.create(Plugin.prototype);
      Object.defineProperties(plugin, {
        name: { value: p.name },
        description: { value: p.description },
        filename: { value: p.filename },
        length: { value: 0 }
      });
      list.push(plugin);
    });
    
    // Polyfill methods
    list.item = function(index) { return this[index]; };
    list.namedItem = function(name) { return this.find(p => p.name === name); };
    
    return list;
  }
});

// 5. Inject window.chrome object (Commonly missing in Electron/Automation environments)
window.chrome = {
  app: {
    isInstalled: false,
    InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
    RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' }
  },
  runtime: {
    OnInstalledReason: { CHROME_UPDATE: 'chrome_update', INSTALL: 'install', SHARED_MODULE_UPDATE: 'shared_module_update', UPDATE: 'update' },
    OnRestartRequiredReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic' },
    PlatformArch: { ARM: 'arm', ARM64: 'arm64', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
    PlatformNaclArch: { ARM: 'arm', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
    PlatformOs: { ANDROID: 'android', CROS: 'cros', LINUX: 'linux', MAC: 'mac', OPENBSD: 'openbsd', WIN: 'win' },
    RequestUpdateCheckStatus: { NO_UPDATE: 'no_update', THROTTLED: 'throttled', UPDATE_AVAILABLE: 'update_available' }
  }
};

// 6. Fix Permission queries mismatch
if (window.navigator && window.navigator.permissions && window.navigator.permissions.query) {
  const originalQuery = window.navigator.permissions.query;
  window.navigator.permissions.query = function(parameters) {
    if (parameters && parameters.name === 'notifications') {
      return Promise.resolve({ state: Notification.permission });
    }
    return originalQuery.call(window.navigator.permissions, parameters);
  };
}

// 7. Prevent JS Dialog blockages (Bypass blocking alert/confirm/prompt modals)
window.alert = (msg) => {
  console.log(`[AetherBrowser Alert Bypassed]: ${msg}`);
};

window.confirm = (msg) => {
  console.log(`[AetherBrowser Confirm Auto-Accepted]: ${msg}`);
  return true; // Auto-accept all confirmations
};

window.prompt = (msg, defaultVal) => {
  console.log(`[AetherBrowser Prompt Auto-Resolved]: ${msg}`);
  return defaultVal || ''; // Auto-return default value for prompts
};
