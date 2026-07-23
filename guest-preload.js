// guest-preload.js
// Runs inside the guest page BEFORE any scripts execute to strip automation traces & bypass blocking alert/confirm modals.

// 1. Strip Automation Webdriver property & cdc_ variables
Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

try {
  delete window.cdc_adoQbxzdn1b73wneD22qd_Array;
  delete window.cdc_adoQbxzdn1b73wneD22qd_Promise;
  delete window.cdc_adoQbxzdn1b73wneD22qd_Symbol;
} catch (e) {}

// 2. Spoof Chrome User-Agent Client Hints
const CLEAN_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
Object.defineProperty(navigator, 'userAgent', { get: () => CLEAN_UA });
Object.defineProperty(navigator, 'appVersion', { get: () => '5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36' });

const userAgentData = {
  brands: [
    { brand: 'Google Chrome', version: '140' },
    { brand: 'Chromium', version: '140' },
    { brand: 'Not=A?Brand', version: '24' }
  ],
  mobile: false,
  platform: 'Windows'
};
Object.defineProperty(navigator, 'userAgentData', { get: () => userAgentData });

// 3. Spoof Default Languages & Plugins
Object.defineProperty(navigator, 'languages', { get: () => ['ko-KR', 'ko', 'en-US', 'en'] });
Object.defineProperty(navigator, 'language', { get: () => 'ko-KR' });
Object.defineProperty(navigator, 'vendor', { get: () => 'Google Inc.' });

// 4. Inject window.chrome object
window.chrome = {
  app: {
    isInstalled: false,
    InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
    RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' }
  },
  runtime: {
    OnInstalledReason: { CHROME_UPDATE: 'chrome_update', INSTALL: 'install', SHARED_MODULE_UPDATE: 'shared_module_update', UPDATE: 'update' },
    OnRestartRequiredReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic' }
  },
  csi: function() { return { startE: Date.now(), onloadT: Date.now(), pageT: 100, tran: 15 }; },
  loadTimes: function() {
    return {
      commitLoadTime: Date.now() / 1000,
      connectionInfo: 'h2',
      finishDocumentLoadTime: Date.now() / 1000,
      finishLoadTime: Date.now() / 1000,
      firstPaintTime: Date.now() / 1000,
      navigationType: 'Other',
      requestTime: Date.now() / 1000,
      startLoadTime: Date.now() / 1000
    };
  }
};

// 5. Bypass JS Blocking Dialog Modals (alert, confirm, prompt)
function patchWindowDialogs(win) {
  try {
    if (!win) return;
    win.alert = function(msg) { console.log(`[AetherBrowser Alert Bypassed]: ${msg}`); };
    win.confirm = function(msg) {
      const str = String(msg || '');
      if (str.includes('저장된') || str.includes('작성하던') || str.includes('이어서') || str.includes('임시')) {
        return false; // Auto-cancel draft recovery popups
      }
      return true;
    };
    win.prompt = function(msg, defaultVal) { return defaultVal || ''; };
  } catch (e) {}
}

patchWindowDialogs(window);
try { if (window.top && window.top !== window) patchWindowDialogs(window.top); } catch (e) {}

if (typeof document !== 'undefined') {
  const applyToIframes = () => {
    try {
      const iframes = document.querySelectorAll('iframe');
      iframes.forEach(iframe => {
        try { if (iframe.contentWindow) patchWindowDialogs(iframe.contentWindow); } catch (e) {}
      });
    } catch (e) {}
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyToIframes);
  } else {
    applyToIframes();
  }
}
