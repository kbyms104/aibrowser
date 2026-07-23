import { runAgentStep, executeAgentAction } from './agent.js';

// DOM Elements
const webviewContainer = document.getElementById('webview-container');
const webviewLoader = document.getElementById('webview-loader');
const addressBar = document.getElementById('browser-address-bar');
const btnBack = document.getElementById('browser-back');
const btnForward = document.getElementById('browser-forward');
const btnRefresh = document.getElementById('browser-refresh');

const sidebarToggleBtn = document.getElementById('toggle-sidebar-btn');
const workspaceGrid = document.querySelector('.workspace-grid');

const btnToggleConfig = document.getElementById('toggle-config-btn');
const btnShowConfig = document.getElementById('show-config-btn');
const configPanel = document.getElementById('config-panel');
const cliPresets = document.getElementById('cli-presets');
const cliCommandInput = document.getElementById('cli-command-input');
const apiKeyGroup = document.getElementById('api-key-group');
const apiKeyLabel = document.getElementById('api-key-label');
const apiKeyInput = document.getElementById('api-key-input');

const goalInput = document.getElementById('goal-input');
const btnRun = document.getElementById('run-btn');
const btnStop = document.getElementById('stop-btn');
const btnClearLogs = document.getElementById('clear-logs-btn');
const timelineLogs = document.getElementById('timeline-logs');
const extractedResult = document.getElementById('extracted-result');

const tabsList = document.getElementById('tabs-list');
const btnAddTab = document.getElementById('add-tab-btn');
const btnLaunchChrome = document.getElementById('launch-chrome-btn');
const btnClearCache = document.getElementById('clear-cache-btn');

// System State
let tabs = [];
let activeTabId = null;
let tabIdCounter = 0;
let guestPreloadPath = '';
let isAgentRunning = false;
let isAgentPaused = false;
let history = [];
let step = 0;
const maxSteps = 15;

async function initPreloadPath() {
  try {
    guestPreloadPath = await window.electronAPI.getGuestPreloadPath();
  } catch (err) {
    console.error("Failed to load guest preload path:", err);
  }
}

// 1. Tab Management System
function createTab(url = 'https://www.google.com') {
  const tabId = tabIdCounter++;
  const sessionToggle = document.getElementById('session-partition-toggle');
  const isIsolated = sessionToggle ? sessionToggle.checked : false;

  const webviewEl = document.createElement('webview');
  webviewEl.id = `webview-${tabId}`;
  webviewEl.setAttribute('allowpopups', '');
  webviewEl.setAttribute('disablewebsecurity', '');
  webviewEl.setAttribute('useragent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36');
  if (guestPreloadPath) webviewEl.setAttribute('preload', guestPreloadPath);

  if (isIsolated) {
    webviewEl.setAttribute('partition', `persist:session-tab-${tabId}`);
    addLogItem('INFO', `Tab [ID ${tabId}] created with isolated session partition.`);
  }

  webviewEl.src = url;
  webviewEl.style.display = 'none';
  webviewEl.style.flex = '1';
  webviewEl.style.width = '100%';
  webviewEl.style.height = '100%';
  webviewEl.style.border = 'none';

  const tabEl = document.createElement('div');
  tabEl.className = 'tab-item';
  tabEl.dataset.tabId = tabId;
  tabEl.innerHTML = `
    <i class="fa-solid fa-globe tab-icon"></i>
    <span class="tab-title">새 탭 ${isIsolated ? '🛡️' : ''}</span>
    <i class="fa-solid fa-xmark tab-close"></i>
  `;

  tabEl.addEventListener('click', (e) => {
    if (e.target.classList.contains('tab-close')) {
      e.stopPropagation();
      closeTab(tabId);
    } else {
      switchTab(tabId);
    }
  });

  webviewEl.addEventListener('did-start-loading', () => {
    if (tabId === activeTabId) webviewLoader.classList.add('loading');
  });

  webviewEl.addEventListener('did-stop-loading', () => {
    if (tabId === activeTabId) {
      webviewLoader.classList.remove('loading');
      updateNavigationUI();
    }
  });

  webviewEl.addEventListener('page-title-updated', (e) => {
    const titleEl = tabEl.querySelector('.tab-title');
    if (titleEl) titleEl.textContent = (e.title || '새 탭') + (isIsolated ? ' 🛡️' : '');
  });

  webviewContainer.appendChild(webviewEl);
  tabsList.insertBefore(tabEl, btnAddTab);

  const tabObj = { id: tabId, webview: webviewEl, tabEl, isIsolated, detectedVideos: [] };
  tabs.push(tabObj);
  switchTab(tabId);
}

function switchTab(tabId) {
  activeTabId = tabId;
  tabs.forEach(tab => {
    if (tab.id === tabId) {
      tab.tabEl.classList.add('active');
      tab.webview.style.display = 'flex';
      updateNavigationUI();
    } else {
      tab.tabEl.classList.remove('active');
      tab.webview.style.display = 'none';
    }
  });
}

function closeTab(tabId) {
  const index = tabs.findIndex(t => t.id === tabId);
  if (index === -1) return;

  const tabToClose = tabs[index];
  tabToClose.webview.remove();
  tabToClose.tabEl.remove();
  tabs.splice(index, 1);

  if (tabs.length === 0) {
    createTab();
  } else if (activeTabId === tabId) {
    const nextTab = tabs[Math.max(0, index - 1)];
    switchTab(nextTab.id);
  }
}

function updateNavigationUI() {
  const tab = tabs.find(t => t.id === activeTabId);
  if (!tab || !tab.webview) return;
  try {
    addressBar.value = tab.webview.getURL() || '';
  } catch (e) {}
}

// 2. Settings & Preset Handler
function updateApiKeyUI() {
  const value = cliPresets.value;
  const directProviders = ['gemini-api', 'openai-api', 'claude-api'];
  if (directProviders.includes(value)) {
    const provider = value.replace('-api', '');
    apiKeyGroup.style.display = 'block';
    apiKeyLabel.textContent = `${provider.toUpperCase()} API Key`;
    apiKeyInput.value = window.localStorage.getItem(`${provider}-api-key`) || '';
  } else {
    apiKeyGroup.style.display = 'none';
  }
}

cliPresets.addEventListener('change', () => {
  if (cliPresets.value !== 'custom') {
    cliCommandInput.value = cliPresets.value;
  } else {
    cliCommandInput.value = '';
    cliCommandInput.focus();
  }
  updateApiKeyUI();
});

if (apiKeyInput) {
  apiKeyInput.addEventListener('input', () => {
    const value = cliPresets.value;
    if (['gemini-api', 'openai-api', 'claude-api'].includes(value)) {
      const provider = value.replace('-api', '');
      window.localStorage.setItem(`${provider}-api-key`, apiKeyInput.value.trim());
    }
  });
}

// Config Panel Toggle
if (btnToggleConfig) btnToggleConfig.addEventListener('click', () => configPanel.classList.toggle('collapsed'));
if (btnShowConfig) btnShowConfig.addEventListener('click', () => configPanel.classList.toggle('collapsed'));

// Browser Navigation Listeners
btnBack.addEventListener('click', () => {
  const tab = tabs.find(t => t.id === activeTabId);
  if (tab && tab.webview.canGoBack()) tab.webview.goBack();
});

btnForward.addEventListener('click', () => {
  const tab = tabs.find(t => t.id === activeTabId);
  if (tab && tab.webview.canGoForward()) tab.webview.goForward();
});

btnRefresh.addEventListener('click', () => {
  const tab = tabs.find(t => t.id === activeTabId);
  if (tab) tab.webview.reload();
});

addressBar.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    let url = addressBar.value.trim();
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }
    const tab = tabs.find(t => t.id === activeTabId);
    if (tab) tab.webview.loadURL(url);
  }
});

btnAddTab.addEventListener('click', () => createTab());

// 3. Logging Helpers
function escapeHTML(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function addLogItem(type, message) {
  const empty = timelineLogs.querySelector('.empty-state');
  if (empty) empty.remove();

  const item = document.createElement('div');
  item.className = `log-item log-${type.toLowerCase()}`;
  const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  item.innerHTML = `<span class="log-time">[${timeStr}]</span> ${escapeHTML(message)}`;
  timelineLogs.appendChild(item);
  timelineLogs.scrollTop = timelineLogs.scrollHeight;
}

function addActionLog(stepNum, actionObj) {
  const empty = timelineLogs.querySelector('.empty-state');
  if (empty) empty.remove();

  const item = document.createElement('div');
  item.className = 'log-action-card';
  const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  item.innerHTML = `
    <div class="log-item-header">
      <span class="log-badge badge-click">STEP ${stepNum} | ${escapeHTML(actionObj.action)}</span>
      <span class="log-time">${timeStr}</span>
    </div>
    <div class="log-content" style="font-weight: 600; margin-top: 4px;">
      ${escapeHTML(actionObj.description)}
      ${actionObj.value ? `<div style="color: var(--accent-cyan); font-size: 0.75rem;">Value: "${escapeHTML(actionObj.value)}"</div>` : ''}
    </div>
  `;
  timelineLogs.appendChild(item);
  timelineLogs.scrollTop = timelineLogs.scrollHeight;
}

function addFinalOutput(result) {
  const empty = extractedResult.querySelector('.empty-state');
  if (empty) empty.remove();

  const container = document.createElement('div');
  container.className = 'result-card';
  container.innerHTML = `
    <div style="font-weight: 800; color: var(--accent-cyan); margin-bottom: 6px;"><i class="fa-solid fa-circle-check"></i> Task Completed</div>
    <div style="white-space: pre-wrap; font-size: 0.85rem;">${escapeHTML(result)}</div>
  `;
  extractedResult.appendChild(container);
  extractedResult.scrollTop = extractedResult.scrollHeight;
}

function setRunningState(running) {
  btnRun.disabled = running;
  btnStop.disabled = !running;
  if (running) {
    btnRun.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> 실행 중...`;
  } else {
    btnRun.innerHTML = `<i class="fa-solid fa-play"></i> AI 자동화 시작`;
  }
}

// Stop Agent Execution
btnStop.addEventListener('click', () => {
  isAgentRunning = false;
  isAgentPaused = false;
  setRunningState(false);
  addLogItem('INFO', '사용자에 의해 AI 자동화가 중지되었습니다.');
});

if (btnClearLogs) {
  btnClearLogs.addEventListener('click', () => {
    timelineLogs.innerHTML = `<div class="empty-state"><i class="fa-solid fa-terminal"></i><p>목표를 실행하면 AI 에이전트의 작업 단계가 여기에 표시됩니다.</p></div>`;
  });
}

// 4. Real Chrome 150 Stealth Launcher Listener
if (btnLaunchChrome) {
  btnLaunchChrome.addEventListener('click', async () => {
    addLogItem('INFO', '사용자 PC의 진짜 Google Chrome 150 스텔스 구동을 시작합니다...');
    try {
      const res = await window.electronAPI.launchStealthChrome();
      addLogItem('INFO', `[스텔스 구동 성공] ${res.message} (CDP Port: ${res.port})`);
      if (goalInput) {
        goalInput.disabled = false;
        goalInput.focus();
      }
    } catch (err) {
      console.error(err);
      addLogItem('ERROR', `Chrome 구동 실패: ${err.message}`);
    }
  });
}

// Clear Cache Listener
if (btnClearCache) {
  btnClearCache.addEventListener('click', async () => {
    if (confirm("모든 세션 쿠키 및 캐시를 초기화하시겠습니까?")) {
      await window.electronAPI.clearCache();
      alert("세션 데이터가 초기화되었습니다.");
    }
  });
}

// 5. Main AI Automation Execution Loop
btnRun.addEventListener('click', async () => {
  const goal = goalInput.value.trim();
  if (!goal) {
    alert("목표를 입력해 주세요.");
    return;
  }

  const commandTemplate = cliCommandInput.value.trim();
  if (!commandTemplate) {
    alert("설정에서 CLI Command Template / API URL을 입력해 주세요.");
    return;
  }

  const realChromeState = await window.electronAPI.getRealChromeState();
  const isRealChrome = realChromeState.active;

  let currentWebview = null;
  let currentActiveTab = null;

  if (!isRealChrome) {
    currentActiveTab = tabs.find(t => t.id === activeTabId);
    if (!currentActiveTab) {
      alert("활성화된 웹 탭이 없습니다.");
      return;
    }
    currentWebview = currentActiveTab.webview;
  } else {
    addLogItem('INFO', `[Real Chrome 150 CDP 타겟 감지] ${realChromeState.title} (${realChromeState.url})`);
  }

  if (isAgentPaused) {
    addLogItem('INFO', `작업 재개: "${goal}"`);
    isAgentPaused = false;
  } else {
    timelineLogs.innerHTML = '';
    extractedResult.innerHTML = '';
    history = [];
    step = 0;
    addLogItem('INFO', `AI 작업 시작: "${goal}" [타겟: ${isRealChrome ? '외부 Real Chrome 150' : '내장 WebView'}]`);
  }

  isAgentRunning = true;
  setRunningState(true);

  try {
    while (isAgentRunning && step < maxSteps) {
      step++;
      addLogItem('INFO', `[Step ${step}/${maxSteps}] 화면 및 요소 분석 중...`);

      if (!isRealChrome) {
        currentActiveTab = tabs.find(t => t.id === activeTabId);
        if (!currentActiveTab) throw new Error("활성화된 탭이 없습니다.");
        currentWebview = currentActiveTab.webview;
        try { currentWebview.focus(); } catch (e) {}
      }

      const actionObj = await runAgentStep({
        commandTemplate,
        goal,
        history,
        webview: currentWebview,
        detectedVideos: currentActiveTab ? currentActiveTab.detectedVideos : [],
        logCallback: (msg) => addLogItem('INFO', msg),
        isRealChrome
      });

      history.push({ action: actionObj.action, description: actionObj.description, value: actionObj.value });
      addActionLog(step, actionObj);

      if (actionObj.action === 'FINISH') {
        addFinalOutput(actionObj.value);
        isAgentPaused = false;
        step = 0;
        break;
      }

      if (actionObj.action === 'ASK_USER') {
        isAgentPaused = true;
        isAgentRunning = false;
        addLogItem('INFO', '수동 작업 필요: 브라우저에서 로그인/본인인증을 완료하신 후 "AI 자동화 시작"을 눌러주세요.');
        break;
      }

      try {
        await executeAgentAction(currentWebview, actionObj, (msg) => addLogItem('INFO', msg), isRealChrome);
      } catch (actionErr) {
        addLogItem('WARNING', `액션 실행 경고: ${actionErr.message}`);
        if (history.length > 0) {
          history[history.length - 1].description = `FAILED: ${actionObj.description} (${actionErr.message})`;
        }
      }

      await new Promise(resolve => setTimeout(resolve, 1500));
    }
  } catch (err) {
    console.error("Agent execution loop error:", err);
    addLogItem('ERROR', `AI 자동화 중 오류 발생: ${err.message}`);
  } finally {
    isAgentRunning = false;
    setRunningState(false);
  }
});

// App Initialization
initPreloadPath().then(() => {
  createTab();
  updateApiKeyUI();
});
