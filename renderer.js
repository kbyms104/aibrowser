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
const aiSidebar = document.getElementById('ai-sidebar');

// Media Downloader Elements
const btnMediaDownload = document.getElementById('media-download-btn');
const mediaCountBadge = document.getElementById('media-count-badge');
const mediaDropdown = document.getElementById('media-dropdown');
const mediaListContainer = document.getElementById('media-list-container');
const btnCloseMediaDropdown = document.getElementById('close-media-dropdown');

const btnToggleConfig = document.getElementById('toggle-config-btn');
const btnShowConfig = document.getElementById('show-config-btn');
const configPanel = document.getElementById('config-panel');
const cliPresets = document.getElementById('cli-presets');
const cliCommandInput = document.getElementById('cli-command-input');

const goalInput = document.getElementById('goal-input');
const btnRun = document.getElementById('run-btn');
const btnStop = document.getElementById('stop-btn');
const btnClearLogs = document.getElementById('clear-logs-btn');
const timelineLogs = document.getElementById('timeline-logs');
const extractedResult = document.getElementById('extracted-result');

const tabsList = document.getElementById('tabs-list');
const btnAddTab = document.getElementById('add-tab-btn');

// Tab System State
let tabs = [];
let activeTabId = null;
let tabIdCounter = 0;
let guestPreloadPath = '';
let isAgentRunning = false;
let history = [];
let isAgentPaused = false;
let step = 0;
const maxSteps = 15;

async function initPreloadPath() {
  try {
    guestPreloadPath = await window.electronAPI.getGuestPreloadPath();
  } catch (err) {
    console.error("Failed to load guest preload path:", err);
  }
}

// 1. Tab Management Functions

function createTab(url = 'https://www.google.com') {
  const tabId = tabIdCounter++;
  
  // Read state of the isolated session checkbox
  const sessionToggle = document.getElementById('session-partition-toggle');
  const isIsolated = sessionToggle ? sessionToggle.checked : false;
  
  // Create webview element
  const webviewEl = document.createElement('webview');
  webviewEl.id = `webview-${tabId}`;
  webviewEl.setAttribute('allowpopups', '');
  webviewEl.setAttribute('disablewebsecurity', '');
  webviewEl.setAttribute('useragent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36');
  if (guestPreloadPath) {
    webviewEl.setAttribute('preload', guestPreloadPath);
  }
  
  // If isolated session toggle is checked, set isolated persistent partition
  if (isIsolated) {
    webviewEl.setAttribute('partition', `persist:session-tab-${tabId}`);
    addLogItem('INFO', `새 탭 [ID ${tabId}] 에 독립된 쿠키/캐시 세션을 활성화했습니다.`);
  }

  webviewEl.src = url;
  webviewEl.style.display = 'none';
  webviewEl.style.flex = '1';
  webviewEl.style.width = '100%';
  webviewEl.style.height = '100%';
  webviewEl.style.border = 'none';
  webviewEl.style.background = '#ffffff';

  // Create tab UI element
  const tabEl = document.createElement('div');
  tabEl.className = `browser-tab ${isIsolated ? 'isolated-session' : ''}`;
  tabEl.id = `tab-${tabId}`;
  tabEl.innerHTML = `
    ${isIsolated ? '<i class="fa-solid fa-user-shield" style="color: var(--accent-cyan); font-size: 0.75rem; margin-right: 6px;" title="독립 계정 세션"></i>' : ''}
    <span class="tab-title">Loading...</span>
    <span class="close-tab-btn" title="탭 닫기">
      <i class="fa-solid fa-xmark"></i>
    </span>
  `;

  // Attach WebView Listeners
  webviewEl.addEventListener('dom-ready', () => {
    updateTabTitle(tabId);
    if (tabId === activeTabId) {
      updateBrowserNavigationUI();
    }
  });

  webviewEl.addEventListener('console-message', (e) => {
    const levelStr = ['INFO', 'WARNING', 'ERROR'][e.level] || 'INFO';
    console.log(`[WebView Console ${levelStr}] ${e.message} (Line: ${e.line}, Source: ${e.sourceId})`);
    
    // Filter out Electron's built-in system security warnings from the UI Timeline logs to prevent user confusion
    if (e.message && e.message.includes('Electron Security Warning')) {
      return;
    }

    // Add errors to the sidebar log timeline so we can see what's happening
    if (e.level >= 2) {
      addLogItem('ERROR', `[WebView Page Error]: ${e.message}`);
    }
  });

  // Handle javascript dialogs (alert, confirm, prompt) to prevent hanging
  webviewEl.addEventListener('dialog', (e) => {
    e.preventDefault();
    const message = e.messageText || '';
    
    // Cancel Tistory draft recovery popups
    if (message.includes('저장된') || message.includes('작성하던') || message.includes('이어서') || message.includes('임시저장') || message.includes('임시')) {
      addLogItem('INFO', `[경고창 자동 제어] 임시 저장 글 불러오기 취소: "${message}"`);
      if (e.dialog && e.dialog.cancel) e.dialog.cancel();
    } else {
      addLogItem('INFO', `[경고창 자동 승인] 확인 클릭: "${message}"`);
      if (e.dialog && e.dialog.ok) e.dialog.ok();
    }
  });

  webviewEl.addEventListener('did-start-loading', () => {
    if (tabId === activeTabId) {
      webviewLoader.classList.add('loading');
    }
  });

  webviewEl.addEventListener('did-stop-loading', () => {
    if (tabId === activeTabId) {
      webviewLoader.classList.remove('loading');
      updateBrowserNavigationUI();
    }
    updateTabTitle(tabId);
  });

  webviewEl.addEventListener('did-navigate', (e) => {
    updateTabTitle(tabId);
    if (tabId === activeTabId) {
      addressBar.value = e.url;
      updateBrowserNavigationUI();
    }
  });

  webviewEl.addEventListener('did-navigate-in-page', (e) => {
    if (tabId === activeTabId) {
      addressBar.value = e.url;
    }
  });

  webviewEl.addEventListener('page-title-updated', (e) => {
    const titleSpan = tabEl.querySelector('.tab-title');
    if (titleSpan) {
      titleSpan.textContent = e.title || 'New Tab';
    }
  });

  // Handle standard link popups by opening them in a new tab
  webviewEl.addEventListener('new-window', (e) => {
    e.preventDefault();
    createTab(e.url);
  });

  // Tab switching click listener
  tabEl.addEventListener('click', (e) => {
    // Avoid switching if clicking close button
    if (e.target.closest('.close-tab-btn')) return;
    switchTab(tabId);
  });

  // Tab close button click listener
  const closeBtn = tabEl.querySelector('.close-tab-btn');
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    closeTab(tabId);
  });

  // Append to DOM
  webviewContainer.appendChild(webviewEl);
  tabsList.appendChild(tabEl);

  const tabObj = {
    id: tabId,
    webview: webviewEl,
    tabEl: tabEl,
    isIsolated: isIsolated,
    detectedVideos: []
  };

  tabs.push(tabObj);
  switchTab(tabId);
}

function switchTab(tabId) {
  activeTabId = tabId;

  tabs.forEach(tab => {
    if (tab.id === tabId) {
      tab.tabEl.classList.add('active');
      tab.webview.style.display = 'flex';
      
      // Update loading bar (safely wrap in try-catch in case webview is not ready yet)
      try {
        if (tab.webview.isLoading()) {
          webviewLoader.classList.add('loading');
        } else {
          webviewLoader.classList.remove('loading');
        }
      } catch (err) {
        webviewLoader.classList.remove('loading');
      }
      
      updateBrowserNavigationUI();
    } else {
      tab.tabEl.classList.remove('active');
      tab.webview.style.display = 'none';
    }
  });

  // Hide media dropdown and update badge for the newly selected tab
  try {
    mediaDropdown.classList.add('collapsed');
    updateMediaBadge();
  } catch (e) {}
}

function closeTab(tabId) {
  const index = tabs.findIndex(t => t.id === tabId);
  if (index === -1) return;

  const tabToClose = tabs[index];
  
  // Remove from DOM
  tabToClose.tabEl.remove();
  tabToClose.webview.remove();

  // Remove from state array
  tabs.splice(index, 1);

  // Determine which tab to switch to next
  if (activeTabId === tabId) {
    if (tabs.length > 0) {
      const nextActiveTab = tabs[Math.max(0, index - 1)];
      switchTab(nextActiveTab.id);
    } else {
      // If no tabs left, open a new blank tab
      createTab();
    }
  }
}

function updateTabTitle(tabId) {
  const tab = tabs.find(t => t.id === tabId);
  if (!tab) return;

  try {
    const title = tab.webview.getTitle();
    const titleSpan = tab.tabEl.querySelector('.tab-title');
    if (titleSpan) {
      titleSpan.textContent = title || 'New Tab';
    }
  } catch (err) {
    // Title not ready
  }
}

function updateBrowserNavigationUI() {
  const tab = tabs.find(t => t.id === activeTabId);
  if (!tab) return;

  try {
    btnBack.disabled = !tab.webview.canGoBack();
    btnForward.disabled = !tab.webview.canGoForward();
    addressBar.value = tab.webview.getURL();
  } catch (err) {
    // Webview is not ready yet
  }
}

// Initialize default single tab after loading guest preload path
isAgentRunning = false;
history = [];

initPreloadPath().then(() => {
  createTab();
});

// Add Tab click listener
btnAddTab.addEventListener('click', () => {
  createTab();
});

// 2. Sidebar toggling
sidebarToggleBtn.addEventListener('click', () => {
  workspaceGrid.classList.toggle('sidebar-collapsed');
  sidebarToggleBtn.classList.toggle('active');
});

// Config collapsible controls
btnToggleConfig.addEventListener('click', () => {
  configPanel.classList.add('collapsed');
});
btnShowConfig.addEventListener('click', () => {
  configPanel.classList.remove('collapsed');
});

const apiKeyGroup = document.getElementById('api-key-group');
const apiKeyLabel = document.getElementById('api-key-label');
const apiKeyInput = document.getElementById('api-key-input');

function updateApiKeyUI() {
  const value = cliPresets.value;
  const directProviders = ['gemini-api', 'openai-api', 'claude-api'];
  if (directProviders.includes(value)) {
    const provider = value.replace('-api', '');
    apiKeyGroup.style.display = 'block';
    
    // Set appropriate label
    let label = 'Gemini API Key';
    if (provider === 'openai') label = 'OpenAI API Key';
    else if (provider === 'claude') label = 'Claude API Key';
    apiKeyLabel.textContent = label;
    
    // Load from localStorage
    apiKeyInput.value = window.localStorage.getItem(`${provider}-api-key`) || '';
    apiKeyInput.placeholder = `API Key 입력 (비어있으면 PC 환경변수 사용)`;
  } else {
    apiKeyGroup.style.display = 'none';
  }
}

// Connect CLI Presets to Command Input
cliPresets.addEventListener('change', () => {
  const value = cliPresets.value;
  if (value !== 'custom') {
    cliCommandInput.value = value;
  } else {
    cliCommandInput.value = '';
    cliCommandInput.focus();
  }
  updateApiKeyUI();
});

// Save API key on input
if (apiKeyInput) {
  apiKeyInput.addEventListener('input', () => {
    const value = cliPresets.value;
    const directProviders = ['gemini-api', 'openai-api', 'claude-api'];
    if (directProviders.includes(value)) {
      const provider = value.replace('-api', '');
      window.localStorage.setItem(`${provider}-api-key`, apiKeyInput.value.trim());
    }
  });
}

// Initialize on load
updateApiKeyUI();

// 3. Browser Navigation Actions
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
    if (!/^https?:\/\//i.test(url)) {
      url = 'https://' + url;
    }
    const tab = tabs.find(t => t.id === activeTabId);
    if (tab) {
      tab.webview.loadURL(url).catch(err => {
        console.warn("Navigation failed:", err.message);
      });
    }
  }
});

// 4. Log Management
function addLogItem(type, message, thought = null) {
  const logLine = `[${type}] ${message}${thought ? ` (Thought: ${thought})` : ''}`;
  window.electronAPI.writeLog(logLine).catch(e => {});

  const empty = timelineLogs.querySelector('.empty-state');
  if (empty) empty.remove();

  const item = document.createElement('div');
  item.className = 'log-item';
  const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  
  let badgeClass = 'badge-info';
  if (type === 'ERROR') badgeClass = 'badge-extract';
  
  item.innerHTML = `
    <div class="log-item-header">
      <span class="log-badge ${badgeClass}">${type}</span>
      <span class="log-time">${timeStr}</span>
    </div>
    <div class="log-content">${escapeHTML(message)}</div>
  `;

  if (thought) {
    const thoughtDiv = document.createElement('div');
    thoughtDiv.className = 'log-thought';
    thoughtDiv.textContent = `Thought: ${thought}`;
    item.appendChild(thoughtDiv);
  }

  timelineLogs.appendChild(item);
  timelineLogs.scrollTop = timelineLogs.scrollHeight;
}

function addActionLog(step, actionObj) {
  const logLine = `[ACTION STEP ${step}] ${actionObj.action} | description: "${actionObj.description}"${actionObj.value ? ` | value: "${actionObj.value}"` : ''}${actionObj.thought ? ` | thought: "${actionObj.thought}"` : ''}`;
  window.electronAPI.writeLog(logLine).catch(e => {});

  const empty = timelineLogs.querySelector('.empty-state');
  if (empty) empty.remove();

  const item = document.createElement('div');
  item.className = 'log-item';
  const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  
  let badgeClass = 'badge-info';
  const action = actionObj.action;
  if (action === 'GOTO') badgeClass = 'badge-nav';
  else if (action === 'CLICK') badgeClass = 'badge-click';
  else if (action === 'TYPE') badgeClass = 'badge-type';
  else if (action === 'SCROLL') badgeClass = 'badge-scroll';
  else if (action === 'WAIT') badgeClass = 'badge-info';
  else if (action === 'EXTRACT') badgeClass = 'badge-extract';
  else if (action === 'FINISH') badgeClass = 'badge-finish';

  const valueDisplay = actionObj.value ? `<div style="margin-top: 4px; font-weight: 600; font-size: 0.75rem; color: var(--accent-cyan);">Value: "${escapeHTML(actionObj.value)}"</div>` : '';

  item.innerHTML = `
    <div class="log-item-header">
      <span class="log-badge ${badgeClass}">STEP ${step} | ${action}</span>
      <span class="log-time">${timeStr}</span>
    </div>
    <div class="log-content" style="font-weight: 500;">
      ${escapeHTML(actionObj.description)}
      ${valueDisplay}
    </div>
  `;

  if (actionObj.thought) {
    const thoughtDiv = document.createElement('div');
    thoughtDiv.className = 'log-thought';
    thoughtDiv.textContent = actionObj.thought;
    item.appendChild(thoughtDiv);
  }

  timelineLogs.appendChild(item);
  timelineLogs.scrollTop = timelineLogs.scrollHeight;
}

function addExtractedData(dataText) {
  const empty = extractedResult.querySelector('.empty-state');
  if (empty) empty.remove();

  const dataCard = document.createElement('div');
  dataCard.className = 'data-card';
  dataCard.innerHTML = `
    <div class="data-card-title"><i class="fa-solid fa-scissors"></i> Extracted Info</div>
    <div class="data-card-body" style="white-space: pre-wrap;">${escapeHTML(dataText)}</div>
  `;

  extractedResult.appendChild(dataCard);
  extractedResult.scrollTop = extractedResult.scrollHeight;
}

function addFinalOutput(result) {
  const empty = extractedResult.querySelector('.empty-state');
  if (empty) empty.remove();

  const container = document.createElement('div');
  container.className = 'result-markdown';
  
  const formattedHtml = parseSimpleMarkdown(result);
  
  container.innerHTML = `
    <div class="data-card" style="background: rgba(0, 242, 254, 0.05); border-color: rgba(0, 242, 254, 0.25);">
      <div class="data-card-title" style="color: var(--accent-cyan); font-weight: 800;">
        <i class="fa-solid fa-circle-check"></i> Final Result
      </div>
      <div style="margin-top: 8px;">${formattedHtml}</div>
    </div>
  `;

  extractedResult.appendChild(container);
  extractedResult.scrollTop = extractedResult.scrollHeight;
}

function addErrorOutput(errorMessage) {
  const empty = extractedResult.querySelector('.empty-state');
  if (empty) empty.remove();

  const container = document.createElement('div');
  container.className = 'result-markdown';
  
  container.innerHTML = `
    <div class="data-card" style="background: rgba(255, 23, 68, 0.05); border-color: rgba(255, 23, 68, 0.25);">
      <div class="data-card-title" style="color: var(--color-danger); font-weight: 800;">
        <i class="fa-solid fa-triangle-exclamation"></i> Automation Failed
      </div>
      <div style="margin-top: 8px; font-weight: 500;">${escapeHTML(errorMessage)}</div>
    </div>
  `;

  extractedResult.appendChild(container);
  extractedResult.scrollTop = extractedResult.scrollHeight;
}

// 5. AI Automation Execution Loop
btnRun.addEventListener('click', async () => {
  const goal = goalInput.value.trim();
  if (!goal) {
    alert("Please enter a goal for the AI agent.");
    return;
  }

  const commandTemplate = cliCommandInput.value.trim();
  if (!commandTemplate) {
    alert("Please configure a valid CLI Command Template in settings.");
    return;
  }

  // Get active tab webview
  const activeTab = tabs.find(t => t.id === activeTabId);
  if (!activeTab) {
    alert("No active web tab found.");
    return;
  }
  const webview = activeTab.webview;

  // Initialize status depending on whether we are resuming or starting fresh
  if (isAgentPaused) {
    addLogItem('INFO', `Resuming AI task: "${goal}"`);
    isAgentPaused = false;
  } else {
    timelineLogs.innerHTML = '';
    extractedResult.innerHTML = '';
    history = [];
    step = 0;
    addLogItem('INFO', `Starting AI task: "${goal}"`);
    addLogItem('INFO', `Connecting via CLI: "${commandTemplate}"`);
  }

  isAgentRunning = true;
  setRunningState(true);

  try {
    while (isAgentRunning && step < maxSteps) {
      step++;
      addLogItem('INFO', `Executing Step ${step} of ${maxSteps}...`);
      
      // Get the currently active webview dynamically in each step to support cross-tab tasks
      const currentActiveTab = tabs.find(t => t.id === activeTabId);
      if (!currentActiveTab) {
        throw new Error("No active tab found.");
      }
      const currentWebview = currentActiveTab.webview;

      // Wait for active webview loading to settle
      await waitForPageLoadSettle(currentWebview);

      // Force webview focus to route keyboard inputs correctly
      try {
        currentWebview.focus();
      } catch (e) {}

      // Run reasoning step via universal CLI handler
      const actionObj = await runAgentStep({
        commandTemplate,
        goal,
        history,
        webview: currentWebview,
        detectedVideos: currentActiveTab.detectedVideos,
        logCallback: (msg) => addLogItem('INFO', msg)
      });

      // Record action history
      history.push({
        action: actionObj.action,
        description: actionObj.description,
        value: actionObj.value
      });

      // Render timeline card
      addActionLog(step, actionObj);

      if (actionObj.action === 'FINISH') {
        addFinalOutput(actionObj.value);
        isAgentPaused = false;
        step = 0;
        break;
      }

      if (actionObj.action === 'EXTRACT') {
        addExtractedData(actionObj.value);
      }

      if (actionObj.action === 'ASK_USER') {
        isAgentPaused = true;
        isAgentRunning = false;
        addLogItem('INFO', 'Task paused for manual action. Please complete the steps (e.g. login, verification) in the browser, then click "Resume" to continue.');
        break;
      }

      // Execute action directly on the active webview
      try {
        await executeAgentAction(currentWebview, actionObj, (msg) => addLogItem('INFO', msg));
      } catch (actionErr) {
        addLogItem('WARNING', `Action execution failed: ${actionErr.message}`);
        // Overwrite the last history item to explain the failure reason to the model in the next step
        if (history.length > 0) {
          history[history.length - 1].description = `FAILED: ${actionObj.description} (Error: ${actionErr.message})`;
        }
      }

      // Wait a short moment for page animations or re-renders to settle using a cancellable delay
      // If the action was CLICK or TYPE, wait longer (1500ms) to allow new-window/tab-switch events to fire
      const delayMs = ['CLICK', 'TYPE'].includes(actionObj.action) ? 1500 : 500;
      await cancellableDelay(delayMs);
      
      if (step >= maxSteps) {
        addLogItem('INFO', 'Reached maximum step limit (15). Stopping.');
        addFinalOutput('Reached maximum step limit without completion.');
        isAgentPaused = false;
        step = 0;
      }
    }
  } catch (err) {
    // If the loop was cancelled by the user, handle it gracefully without error output
    if (!isAgentRunning) {
      addLogItem('INFO', 'Automation cancelled by user.');
      isAgentPaused = false;
      step = 0;
      return;
    }
    console.error("Agent execution loop failed:", err);
    addLogItem('ERROR', err.message);
    addErrorOutput(err.message);
    isAgentPaused = false;
    step = 0;
  } finally {
    isAgentRunning = false;
    setRunningState(false);
  }
});

btnStop.addEventListener('click', async () => {
  if (isAgentRunning) {
    isAgentRunning = false;
    isAgentPaused = false;
    step = 0;
    addLogItem('INFO', 'Stopping automation task by user request...');
    
    // Command the main process to instantly kill the active child process or HTTP request
    try {
      await window.electronAPI.abortAgentExecution();
    } catch (e) {
      console.error("Abort execution error:", e);
    }
  }
});

btnClearLogs.addEventListener('click', () => {
  timelineLogs.innerHTML = `
    <div class="empty-state">
      <i class="fa-solid fa-terminal"></i>
      <p>Logs cleared.</p>
    </div>
  `;
});

function setRunningState(running) {
  if (running) {
    btnRun.disabled = true;
    btnStop.disabled = false;
    goalInput.disabled = true;
  } else {
    btnRun.disabled = false;
    btnStop.disabled = true;
    goalInput.disabled = false;
    
    // Switch button label dynamically based on pause state
    if (isAgentPaused) {
      btnRun.innerHTML = `<i class="fa-solid fa-play"></i> 계속 진행 (Resume)`;
    } else {
      btnRun.innerHTML = `<i class="fa-solid fa-play"></i> AI 자동화 시작`;
    }
  }
}

// Helper for cancellable delays that immediately throw if execution is stopped by the user
async function cancellableDelay(ms) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (!isAgentRunning) {
      throw new Error("Execution cancelled by user");
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

// Wait for guest page loading to be complete and document.readyState to be complete (fully cancellable)
async function waitForPageLoadSettle(currentWebview) {
  if (!isAgentRunning) throw new Error("Execution cancelled by user");

  // 1. If it's currently loading, wait for it to finish loading
  if (currentWebview.isLoading()) {
    addLogItem('INFO', 'Waiting for page load to complete...');
    await new Promise((resolve, reject) => {
      const stopListener = () => {
        clearInterval(cancelCheck);
        currentWebview.removeEventListener('did-stop-loading', stopListener);
        resolve();
      };
      
      const cancelCheck = setInterval(() => {
        if (!isAgentRunning) {
          clearInterval(cancelCheck);
          currentWebview.removeEventListener('did-stop-loading', stopListener);
          reject(new Error("Execution cancelled by user"));
        }
      }, 100);
      
      currentWebview.addEventListener('did-stop-loading', stopListener);
    });

    // 2. Poll document.readyState to guarantee DOM rendering has finished
    let loaded = false;
    let attempts = 0;
    while (!loaded && attempts < 10) {
      if (!isAgentRunning) throw new Error("Execution cancelled by user");
      attempts++;
      try {
        const readyState = await currentWebview.executeJavaScript('document.readyState');
        if (readyState === 'complete') {
          loaded = true;
        }
      } catch (e) {}
      if (!loaded) {
        await cancellableDelay(200);
      }
    }

    // 3. Wait additional 800ms for visual layout settle after page load
    await cancellableDelay(800);
  } else {
    // If not loading (i.e. standard page interaction), just a tiny 200ms safety delay is enough
    await cancellableDelay(200);
  }
}

// Client-side markdown parsers
function parseSimpleMarkdown(text) {
  if (!text) return '';
  let html = escapeHTML(text);

  html = html.replace(/^### (.*$)/gim, '<h4>$1</h4>');
  html = html.replace(/^## (.*$)/gim, '<h4>$1</h4>');
  html = html.replace(/^# (.*$)/gim, '<h4>$1</h4>');

  html = html.replace(/^\- (.*$)/gim, '<li>$1</li>');
  html = html.replace(/^\* (.*$)/gim, '<li>$1</li>');

  html = html.replace(/(<li>.*<\/li>)/gim, '<ul>$1</ul>');
  html = html.replace(/<\/ul>\s*<ul>/gim, '');

  html = html.replace(/\n\n/g, '</p><p>');
  html = html.replace(/\n/g, '<br>');

  if (!html.startsWith('<h') && !html.startsWith('<ul') && !html.startsWith('<p')) {
    html = `<p>${html}</p>`;
  }

  return html;
}

function escapeHTML(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// 6. Media Downloader Frontend Logic
function updateMediaBadge() {
  const activeTab = tabs.find(t => t.id === activeTabId);
  if (activeTab && activeTab.detectedVideos && activeTab.detectedVideos.length > 0) {
    btnMediaDownload.style.display = 'flex';
    mediaCountBadge.textContent = activeTab.detectedVideos.length;
  } else {
    btnMediaDownload.style.display = 'none';
  }
}

async function populateMediaList() {
  mediaListContainer.innerHTML = '';
  const activeTab = tabs.find(t => t.id === activeTabId);
  if (!activeTab) return;

  // 1. Attempt to extract progressive video URL (with sound) from active page DOM/React state
  let extractedProgressiveUrl = null;
  try {
    extractedProgressiveUrl = await activeTab.webview.executeJavaScript(`
      (function() {
        let meta = document.querySelector('meta[property="og:video"]');
        if (meta && meta.content) return meta.content;
        
        meta = document.querySelector('meta[name="twitter:player:stream"]');
        if (meta && meta.content) return meta.content;

        const scripts = document.querySelectorAll('script');
        for (const script of scripts) {
          const text = script.textContent;
          if (text) {
            let match = text.match(/"video_url"\\s*:\\s*"([^"]+)"/);
            if (match && match[1]) {
              return match[1].replace(/\\\\/g, '');
            }
            match = text.match(/"video_versions"\\s*:\\s*\\[\\s*\\{\\s*"type"\\s*:\\s*\\d+\\s*,\\s*"url"\\s*:\\s*"([^"]+)"/);
            if (match && match[1]) {
              return match[1].replace(/\\\\/g, '');
            }
            match = text.match(/"(https?:\\\\?\\/\\\\?\\/[^"]+?\\.mp4[^"]*?)"/);
            if (match && match[1]) {
              const cleanUrl = match[1].replace(/\\\\/g, '');
              if (!cleanUrl.includes('bytestart') && !cleanUrl.includes('byteend')) {
                return cleanUrl;
              }
            }
          }
        }
        return null;
      })()
    `);
    
    if (extractedProgressiveUrl && !activeTab.detectedVideos.includes(extractedProgressiveUrl)) {
      // Prepend to show as primary option
      activeTab.detectedVideos.unshift(extractedProgressiveUrl);
      updateMediaBadge();
    }
  } catch (e) {
    console.error("DOM Extraction failed:", e);
  }

  if (!activeTab.detectedVideos || activeTab.detectedVideos.length === 0) {
    mediaListContainer.innerHTML = '<div style="color: var(--text-muted); font-size: 11px; padding: 10px; text-align: center;">감지된 미디어가 없습니다.</div>';
    return;
  }

  activeTab.detectedVideos.forEach((url, index) => {
    const item = document.createElement('div');
    item.className = 'media-item';
    
    const isProgressive = (url === extractedProgressiveUrl);
    
    // Create clean label from URL or timestamp
    const cleanUrl = url.split('?')[0];
    const filename = cleanUrl.substring(cleanUrl.lastIndexOf('/') + 1) || `insta_video_${Date.now()}.mp4`;
    let safeFilename = filename.endsWith('.mp4') ? filename : filename + '.mp4';
    if (safeFilename.length > 30) {
      safeFilename = safeFilename.substring(0, 15) + '...' + safeFilename.substring(safeFilename.length - 10);
    }
    
    const label = isProgressive ? `<span style="background: rgba(0, 230, 118, 0.2); color: #00e676; border: 1px solid rgba(0, 230, 118, 0.4); font-size: 9px; padding: 1px 4px; border-radius: 3px; font-weight: 800; display: inline-block; margin-bottom: 2px;">소리 포함 (With Audio)</span><br>${safeFilename}` : safeFilename;
    const buttonText = isProgressive ? '고화질 다운로드' : '동영상 다운로드';
    const buttonClass = isProgressive ? 'media-item-btn progressive' : 'media-item-btn';

    item.innerHTML = `
      <div class="media-preview-container">
        <video src="${url}" preload="metadata" muted loop style="cursor: pointer;" title="클릭/마우스 오버하여 미리보기"></video>
      </div>
      <div class="media-item-content">
        <div class="media-item-info" title="${url}">${label}</div>
        <button class="${buttonClass}" data-index="${index}">${buttonText}</button>
      </div>
    `;

    // Add play/pause behavior on hover or click for the preview video
    const previewVideo = item.querySelector('video');
    
    item.addEventListener('mouseenter', () => {
      previewVideo.play().catch(e => {});
    });
    
    item.addEventListener('mouseleave', () => {
      previewVideo.pause();
    });

    previewVideo.addEventListener('click', (e) => {
      e.stopPropagation();
      if (previewVideo.paused) {
        previewVideo.play().catch(e => {});
      } else {
        previewVideo.pause();
      }
    });

    const downloadBtn = item.querySelector('.media-item-btn');
    downloadBtn.addEventListener('click', async () => {
      downloadBtn.disabled = true;
      downloadBtn.innerText = '다운로드 중...';
      
      const fileTimestamp = Date.now();
      const outputFilename = `instagram_video_${fileTimestamp}_${index + 1}.mp4`;
      
      try {
        const savePath = await window.electronAPI.downloadMedia({
          url: url,
          filename: outputFilename
        });
        downloadBtn.innerText = '다운로드 완료!';
        addLogItem('INFO', `동영상 다운로드 성공: [Downloads]\\${outputFilename}`);
      } catch (err) {
        console.error(err);
        downloadBtn.innerText = '다운로드 실패';
        addLogItem('ERROR', `동영상 다운로드 실패: ${err.message}`);
      } finally {
        setTimeout(() => {
          downloadBtn.disabled = false;
          downloadBtn.innerText = isProgressive ? '고화질 다운로드' : '동영상 다운로드';
        }, 3000);
      }
    });

    mediaListContainer.appendChild(item);
  });
}

// Media dropdown toggle listeners
btnMediaDownload.addEventListener('click', async () => {
  mediaDropdown.classList.toggle('collapsed');
  if (!mediaDropdown.classList.contains('collapsed')) {
    await populateMediaList();
  }
});

btnCloseMediaDropdown.addEventListener('click', () => {
  mediaDropdown.classList.add('collapsed');
});

// Register video sniffer IPC listener
window.electronAPI.onVideoDetected((data) => {
  const tab = tabs.find(t => {
    try {
      return t.webview.getWebContentsId() === data.webContentsId;
    } catch (err) {
      return false;
    }
  });

  if (tab) {
    if (!tab.detectedVideos.includes(data.url)) {
      tab.detectedVideos.push(data.url);
      if (tab.id === activeTabId) {
        updateMediaBadge();
      }
    }
  }
});

// Register IPC listener to open a new tab when a guest webview requests window.open
window.electronAPI.onOpenTabRequest((url) => {
  addLogItem('INFO', `새 창 감지: 새 탭에서 페이지를 엽니다: ${url}`);
  createTab(url);
});

// Real Chrome 150 Stealth Launch Event Listener
const btnLaunchChrome = document.getElementById('launch-chrome-btn');
if (btnLaunchChrome) {
  btnLaunchChrome.addEventListener('click', async () => {
    addLogItem('INFO', '사용자 PC의 진짜 Google Chrome 150 스텔스 실행을 시작합니다...');
    try {
      const res = await window.electronAPI.launchStealthChrome();
      addLogItem('INFO', `[스텔스 구동 완료] ${res.message} (CDP 포트: ${res.port})`);
      alert("진짜 Google Chrome 150 스텔스 실행 완료!\n\n노란색 '자동 제어' 경고 띠 없이 포트 9222번으로 구동되었습니다.\n이제 구글/티스토리/네이버 차단 없이 100% 안전하게 자동화 및 로그인을 진행할 수 있습니다!");
    } catch (err) {
      console.error(err);
      addLogItem('ERROR', `Chrome 150 구동 실패: ${err.message}`);
      alert("Chrome 구동 실패: " + err.message);
    }
  });
}

// Clear Cache Button Event Listener
const btnClearCache = document.getElementById('clear-cache-btn');
if (btnClearCache) {
  btnClearCache.addEventListener('click', async () => {
    const confirmReset = confirm("모든 탭의 쿠키, 캐시, 세션 데이터를 초기화하시겠습니까? (진행 시 모든 사이트에서 로그아웃됩니다)");
    if (!confirmReset) return;
    
    try {
      await window.electronAPI.clearCache();
      alert("브라우저 데이터가 초기화되었습니다. 현재 페이지를 새로고침합니다.");
      
      // Reload current tab webview
      const tab = tabs.find(t => t.id === activeTabId);
      if (tab && tab.webview) {
        tab.webview.reload();
      }
    } catch (err) {
      console.error(err);
      alert("초기화 중 오류가 발생했습니다: " + err.message);
    }
  });
}

// ==========================================
// 5. Self-Healing (Self-Patching) System
// ==========================================
let isHealingInProgress = false;

// Global Error & Promise Rejection Interceptors for the Renderer Process
window.addEventListener('error', (event) => {
  // Ignore harmless webview console errors or cross-origin script warnings
  if (!event.error || (event.message && event.message.includes('Script error'))) return;
  handleRendererCrash(event.error);
});

window.addEventListener('unhandledrejection', (event) => {
  if (!event.reason) return;
  handleRendererCrash(event.reason);
});

// Test Crash Button Event Listener (Generates intentional crash for verification)
const btnTestCrash = document.getElementById('test-crash-btn');
if (btnTestCrash) {
  btnTestCrash.addEventListener('click', () => {
    addLogItem('INFO', '자가 치유 기능 검증을 위해 의도적 오류를 발생시킵니다.');
    // Trigger intentional error: call undefined function
    window.triggerSelfHealingCrashTest();
  });
}

async function handleRendererCrash(error) {
  if (isHealingInProgress) return;
  isHealingInProgress = true;
  
  console.error('[Self-Healing] Intercepted crash in Renderer Process:', error);
  
  const overlay = document.getElementById('self-healing-overlay');
  const presetLabel = document.getElementById('self-healing-preset');
  const statusLabel = document.getElementById('self-healing-status-text');
  
  if (overlay) overlay.classList.add('active');
  
  const presetSelect = document.getElementById('cli-presets');
  const commandInput = document.getElementById('cli-command-input');
  
  const currentPreset = presetSelect ? presetSelect.value : 'agy';
  const currentCommand = commandInput ? commandInput.value : 'agy';
  
  if (presetLabel) {
    presetLabel.textContent = `Active AI Preset: ${currentPreset}`;
  }
  
  try {
    if (statusLabel) statusLabel.textContent = "에러 위치 및 콜스택 분석 중...";
    const errorStack = error ? (error.stack || error.message || String(error)) : 'Unknown Error';
    
    // Parse stack trace to identify target file (e.g. renderer.js, agent.js)
    let targetFilename = 'renderer.js';
    const match = errorStack.match(/(renderer\.js|agent\.js|preload\.js)/);
    if (match) {
      targetFilename = match[1];
    }
    
    if (statusLabel) statusLabel.textContent = `로컬 소스코드 (${targetFilename}) 읽어오는 중...`;
    const sourceCode = await window.electronAPI.readSourceFile(targetFilename);
    
    if (statusLabel) statusLabel.textContent = "AI에게 자가 치유 패치 제작 요청 중 (잠시 대기)...";
    
    const selfHealPrompt = `You are a Self-Healing Code Assistant. A runtime error occurred in this application.
Your job is to write a search-and-replace patch in JSON format to fix the bug in the provided source code.

[ERROR STACK TRACE]
${errorStack}

[SOURCE FILE NAME]
${targetFilename}

[SOURCE CODE]
\`\`\`javascript
${sourceCode}
\`\`\`

Analyze the stack trace and the code. Locate the bug, and write a JSON search-and-replace patch.
You MUST return a single valid JSON block containing:
{
  "target": "The exact contiguous block of code from the file that contains the bug, including proper indentation and surrounding lines for context.",
  "replacement": "The corrected block of code that should replace the target block."
}
Your output MUST be ONLY the JSON block inside a json code block: \`\`\`json ... \`\`\`. Do not include any conversational explanation or text outside the code block.`;

    let responseText = '';
    // Call the active preset using the exact same APIs that the agent uses!
    if (['gemini-api', 'openai-api', 'claude-api'].includes(currentPreset)) {
      const provider = currentPreset.replace('-api', '');
      const apiKey = window.localStorage.getItem(`${provider}-api-key`) || '';
      responseText = await window.electronAPI.runDirectApi({
        provider,
        prompt: selfHealPrompt,
        apiKey
      });
    } else if (currentCommand.startsWith('http://') || currentCommand.startsWith('https://')) {
      const urlObj = new URL(currentCommand);
      const model = urlObj.searchParams.get('model') || 'llama3';
      urlObj.search = '';
      const cleanUrl = urlObj.toString();
      responseText = await window.electronAPI.runLocalHttp({
        url: cleanUrl,
        model,
        prompt: selfHealPrompt
      });
    } else {
      // CLI preset (like agy or custom command)
      responseText = await window.electronAPI.runUniversalCli({
        commandTemplate: currentCommand,
        prompt: selfHealPrompt
      });
    }
    
    if (statusLabel) statusLabel.textContent = "AI 패치 추출 및 최종 검증 중...";
    
    // Extract JSON block from responseText
    let jsonText = responseText.trim();
    const jsonBlockMatch = jsonText.match(/```json([\s\S]*?)```/) || jsonText.match(/```([\s\S]*?)```/);
    if (jsonBlockMatch) {
      jsonText = jsonBlockMatch[1].trim();
    }
    
    let patchObj;
    try {
      patchObj = JSON.parse(jsonText);
    } catch (e) {
      // Direct parse fallback
      const matchRawJson = jsonText.match(/\{[\s\S]*\}/);
      if (matchRawJson) {
        patchObj = JSON.parse(matchRawJson[0]);
      } else {
        throw new Error("AI response could not be parsed as JSON: " + e.message);
      }
    }
    
    const targetBlock = patchObj.target;
    const replacementBlock = patchObj.replacement;
    
    if (!targetBlock || !replacementBlock) {
      throw new Error("AI patch is missing 'target' or 'replacement' fields.");
    }
    
    // Clean target/replacement carriage returns for stable matching
    const normalizedSource = sourceCode.replace(/\r\n/g, '\n');
    const normalizedTarget = targetBlock.replace(/\r\n/g, '\n');
    const normalizedReplacement = replacementBlock.replace(/\r\n/g, '\n');
    
    if (!normalizedSource.includes(normalizedTarget)) {
      throw new Error("AI patch target block could not be found in the original source code.");
    }
    
    const correctedCode = normalizedSource.replace(normalizedTarget, normalizedReplacement);
    
    if (statusLabel) statusLabel.textContent = "자가 치유 패치 디스크 적용 중...";
    await window.electronAPI.writeSourceFile(targetFilename, correctedCode);
    
    if (statusLabel) statusLabel.textContent = "패치 적용 완료! 브라우저 재기동 중...";
    await new Promise(r => setTimeout(r, 1500));
    
    // Relaunch the app
    await window.electronAPI.relaunchApp();
    
  } catch (healErr) {
    console.error('[Self-Healing] Failed to heal the code:', healErr);
    if (statusLabel) {
      statusLabel.innerHTML = `<span style="color: var(--color-danger);">자가 치유 실패: ${escapeHTML(healErr.message)}</span>`;
    }
    isHealingInProgress = false;
  }
}
