// guest-preload.js
// This script runs inside the guest page BEFORE any other scripts execute,
// masking all Electron/automation fingerprints to make the browser look 100% human.

// 1. Hide Automation Webdriver property & Electron traces
Object.defineProperty(navigator, 'webdriver', {
  get: () => undefined
});

try {
  delete window.cdc_adoQbxzdn1b73wneD22qd_Array;
  delete window.cdc_adoQbxzdn1b73wneD22qd_Promise;
  delete window.cdc_adoQbxzdn1b73wneD22qd_Symbol;
} catch (e) {}

const CLEAN_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
Object.defineProperty(navigator, 'userAgent', { get: () => CLEAN_UA });
Object.defineProperty(navigator, 'appVersion', { get: () => '5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36' });

// 2. Spoof Chrome User-Agent Client Hints (userAgentData) with realistic Chrome brands
const userAgentData = {
  brands: [
    { brand: 'Google Chrome', version: '128' },
    { brand: 'Chromium', version: '128' },
    { brand: 'Not=A?Brand', version: '24' }
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

// 7. Prevent JS Dialog blockages (Bypass blocking alert/confirm/prompt modals across main frame and subframes)
function patchWindowDialogs(win) {
  try {
    if (!win) return;
    win.alert = function(msg) {
      console.log(`[AetherBrowser Alert Bypassed]: ${msg}`);
    };
    win.confirm = function(msg) {
      console.log(`[AetherBrowser Confirm Handled]: ${msg}`);
      const str = String(msg || '');
      // If it's a draft recovery prompt (e.g. "저장된 글이 있습니다. 이어서 작성하시겠습니까?"), return false (Cancel)
      if (str.includes('저장된') || str.includes('작성하던') || str.includes('이어서') || str.includes('임시')) {
        return false;
      }
      return true;
    };
    win.prompt = function(msg, defaultVal) {
      console.log(`[AetherBrowser Prompt Auto-Resolved]: ${msg}`);
      return defaultVal || '';
    };
  } catch (e) {}
}

patchWindowDialogs(window);
try { if (window.top && window.top !== window) patchWindowDialogs(window.top); } catch (e) {}

// Continuously patch any new window / iframe on DOM ready
if (typeof document !== 'undefined') {
  const applyToIframes = () => {
    try {
      const iframes = document.querySelectorAll('iframe');
      iframes.forEach(iframe => {
        try {
          if (iframe.contentWindow) patchWindowDialogs(iframe.contentWindow);
        } catch (e) {}
      });
    } catch (e) {}
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyToIframes);
  } else {
    applyToIframes();
  }
}
