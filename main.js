import { app, BrowserWindow, ipcMain, webContents, session } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { exec, spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import http from 'http';
import puppeteer from 'puppeteer-core';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow = null;
let staticServer = null;
let realChromeBrowser = null;
let activeChildProcess = null;

// Disable Chromium C++ automation flags to ensure clean browser behavior
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');

const CLEAN_CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
app.userAgentFallback = CLEAN_CHROME_UA;

// 1. Local Static Server (serves index.html on http://127.0.0.1:49999 for clean ES Module loading)
function startLocalServer() {
  staticServer = http.createServer((req, res) => {
    let relativePath = req.url === '/' ? 'index.html' : req.url;
    relativePath = relativePath.split('?')[0].split('#')[0];
    const filePath = path.join(__dirname, relativePath);

    const extname = String(path.extname(filePath)).toLowerCase();
    const mimeTypes = {
      '.html': 'text/html',
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.json': 'application/json',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.gif': 'image/gif',
      '.svg': 'image/svg+xml'
    };

    const contentType = mimeTypes[extname] || 'application/octet-stream';

    fs.readFile(filePath, (error, content) => {
      if (error) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('File not found');
      } else {
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content, 'utf-8');
      }
    });
  });

  staticServer.listen(49999, '127.0.0.1', () => {
    console.log('[Server] Local static server running on http://127.0.0.1:49999');
  });
}

// 2. Create Primary Browser Window
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    title: "AetherBrowser - AI Desktop Browser v2.0",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.loadURL('http://127.0.0.1:49999');
  mainWindow.webContents.openDevTools();

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// 3. Application Lifecycle Setup
app.whenReady().then(() => {
  startLocalServer();

  session.defaultSession.setUserAgent(CLEAN_CHROME_UA);

  // Global Header Interceptor to strip Electron signatures
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    details.requestHeaders['User-Agent'] = CLEAN_CHROME_UA;
    delete details.requestHeaders['X-Electron'];
    callback({ cancel: false, requestHeaders: details.requestHeaders });
  });

  app.on('web-contents-created', (event, contents) => {
    try { contents.setUserAgent(CLEAN_CHROME_UA); } catch (e) {}
    contents.setWindowOpenHandler((details) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('open-tab-request', details.url);
      }
      return { action: 'deny' };
    });
  });

  // ----------------------------------------------------
  // IPC Handlers
  // ----------------------------------------------------

  // Capture webview page screenshot
  ipcMain.handle('capture-webview', async (event, webContentsId) => {
    try {
      const wc = webContents.fromId(webContentsId);
      if (!wc) throw new Error(`WebContents ID ${webContentsId} not found.`);
      const image = await wc.capturePage();
      return image.toJPEG(50).toString('base64');
    } catch (err) {
      console.error('Capture webview error:', err);
      throw err;
    }
  });

  // Execute Universal CLI Command
  ipcMain.handle('run-universal-cli', async (event, { commandTemplate, prompt }) => {
    if (!commandTemplate) throw new Error("CLI Command Template is required.");

    let command = commandTemplate.trim();
    let tempFilePath = null;

    try {
      if (command.includes('$FILE')) {
        const tempDir = os.tmpdir();
        tempFilePath = path.join(tempDir, `aether_prompt_${Date.now()}.txt`);
        fs.writeFileSync(tempFilePath, prompt, 'utf8');
        command = command.replace(/\$FILE/g, `"${tempFilePath}"`);
      } else if (command.includes('$PROMPT')) {
        const escapedPrompt = prompt.replace(/"/g, '\\"');
        command = command.replace(/\$PROMPT/g, `"${escapedPrompt}"`);
      }

      if (process.platform === 'win32') {
        command = `chcp 65001 > nul && ${command}`;
      }

      return new Promise((resolve, reject) => {
        if (commandTemplate.includes('$FILE') || commandTemplate.includes('$PROMPT')) {
          const child = exec(command, (error, stdout, stderr) => {
            if (activeChildProcess === child) activeChildProcess = null;
            if (tempFilePath && fs.existsSync(tempFilePath)) {
              try { fs.unlinkSync(tempFilePath); } catch (e) {}
            }
            if (error) return reject(new Error(`CLI Execution Failed: ${error.message}. Stderr: ${stderr}`));
            resolve(stdout);
          });
          activeChildProcess = child;
        } else {
          const child = spawn(command, [], { shell: true });
          activeChildProcess = child;
          let stdout = '';
          let stderr = '';
          child.stdout.on('data', (d) => { stdout += d; });
          child.stderr.on('data', (d) => { stderr += d; });
          child.on('close', (code) => {
            if (activeChildProcess === child) activeChildProcess = null;
            if (code !== 0) return reject(new Error(`CLI Exited with code ${code}. Stderr: ${stderr}`));
            resolve(stdout);
          });
          child.stdin.write(prompt);
          child.stdin.end();
        }
      });
    } catch (err) {
      if (tempFilePath && fs.existsSync(tempFilePath)) {
        try { fs.unlinkSync(tempFilePath); } catch (e) {}
      }
      throw err;
    }
  });

  // Call Direct Provider API (Gemini, OpenAI, Claude)
  ipcMain.handle('run-direct-api', async (event, { provider, prompt, apiKey }) => {
    const key = apiKey || process.env[`${provider.toUpperCase()}_API_KEY` % provider] || process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY;
    
    if (provider === 'gemini') {
      const activeKey = key || process.env.GEMINI_API_KEY;
      if (!activeKey) throw new Error("Gemini API Key is missing. Set it in Settings or GEMINI_API_KEY environment variable.");
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${activeKey}`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
      });
      if (!response.ok) throw new Error(`Gemini API HTTP Error: ${response.status} ${response.statusText}`);
      const data = await response.json();
      return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    }

    if (provider === 'openai') {
      const activeKey = key || process.env.OPENAI_API_KEY;
      if (!activeKey) throw new Error("OpenAI API Key is missing. Set it in Settings or OPENAI_API_KEY environment variable.");
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${activeKey}`
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }]
        })
      });
      if (!response.ok) throw new Error(`OpenAI API HTTP Error: ${response.status} ${response.statusText}`);
      const data = await response.json();
      return data.choices?.[0]?.message?.content || '';
    }

    throw new Error(`Unsupported Direct API provider: ${provider}`);
  });

  // Call Local HTTP API (Ollama)
  ipcMain.handle('run-local-http', async (event, { url, model, prompt }) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: model || 'llama3', prompt, stream: false })
    });
    if (!response.ok) throw new Error(`Local HTTP Error: ${response.status} ${response.statusText}`);
    const data = await response.json();
    return data.response || data.content || JSON.stringify(data);
  });

  // Direct Media Downloader
  ipcMain.handle('download-media', async (event, { url, filename }) => {
    const downloadsFolder = path.join(os.homedir(), 'Downloads');
    const targetFilePath = path.join(downloadsFolder, filename);

    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch media from URL: ${response.statusText}`);
    const arrayBuffer = await response.arrayBuffer();
    fs.writeFileSync(targetFilePath, Buffer.from(arrayBuffer));
    return targetFilePath;
  });

  // Get guest preload path
  ipcMain.handle('get-guest-preload-path', () => {
    return path.join(__dirname, 'guest-preload.js');
  });

  // Clear cache and cookies
  ipcMain.handle('clear-cache', async () => {
    await session.defaultSession.clearStorageData();
    return true;
  });

  // Launch Installed Google Chrome v150 via CDP Stealth Port (9222)
  ipcMain.handle('launch-stealth-chrome', async () => {
    try {
      const checkRes = await fetch('http://127.0.0.1:9222/json');
      if (checkRes.ok) {
        return { success: true, port: 9222, message: 'Reusing active Chrome CDP instance on port 9222.' };
      }
    } catch (e) {}

    const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    if (!fs.existsSync(chromePath)) {
      throw new Error(`Google Chrome executable not found at: ${chromePath}`);
    }

    const profileDir = path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'User Data', 'AetherProfile');
    if (!fs.existsSync(profileDir)) {
      try { fs.mkdirSync(profileDir, { recursive: true }); } catch (e) {}
    }

    const args = [
      '--remote-debugging-port=9222',
      `--user-data-dir=${profileDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--start-maximized'
    ];

    console.log(`[Stealth Chrome] Spawning Chrome v150 with profile: ${profileDir}`);
    const chromeProc = spawn(chromePath, args, { detached: true, stdio: 'ignore' });
    chromeProc.unref();

    let cdpReady = false;
    for (let i = 0; i < 15; i++) {
      await new Promise(r => setTimeout(r, 500));
      try {
        const res = await fetch('http://127.0.0.1:9222/json');
        if (res.ok) { cdpReady = true; break; }
      } catch (e) {}
    }

    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
        mainWindow.focus();
      }
    }, 500);

    if (!cdpReady) {
      throw new Error('Chrome 150 launched but CDP port 9222 failed to respond.');
    }

    return { success: true, port: 9222, message: 'Google Chrome v150 launched on stealth CDP port 9222.' };
  });

  // Evaluate JS in External Chrome via Puppeteer CDP Bridge
  async function evalInRealChrome(expression) {
    const isConnected = realChromeBrowser && (typeof realChromeBrowser.isConnected === 'function' ? realChromeBrowser.isConnected() : realChromeBrowser.connected);
    if (!realChromeBrowser || !isConnected) {
      realChromeBrowser = await puppeteer.connect({
        browserURL: 'http://127.0.0.1:9222',
        defaultViewport: null
      });
    }

    const pages = await realChromeBrowser.pages();
    const page = pages.find(p => !p.url().startsWith('chrome-extension://')) || pages[0];
    if (!page) throw new Error('No active page tab found in Chrome on port 9222.');

    return await page.evaluate(expression);
  }

  ipcMain.handle('eval-real-chrome', async (event, { expression }) => {
    return await evalInRealChrome(expression);
  });

  ipcMain.handle('get-real-chrome-state', async () => {
    try {
      const listRes = await fetch('http://127.0.0.1:9222/json');
      if (!listRes.ok) return { active: false };
      const targets = await listRes.json();
      const target = targets.find(t => t.type === 'page' && !t.url.startsWith('chrome-extension://')) || targets[0];
      if (!target) return { active: false };
      return { active: true, url: target.url, title: target.title, id: target.id };
    } catch (e) {
      return { active: false };
    }
  });

  // Execute Native Puppeteer Actions on External Chrome 150
  ipcMain.handle('cdp-action', async (event, { action, elementId, value }) => {
    const isConnected = realChromeBrowser && (typeof realChromeBrowser.isConnected === 'function' ? realChromeBrowser.isConnected() : realChromeBrowser.connected);
    if (!realChromeBrowser || !isConnected) {
      realChromeBrowser = await puppeteer.connect({
        browserURL: 'http://127.0.0.1:9222',
        defaultViewport: null
      });
    }

    const pages = await realChromeBrowser.pages();
    const page = pages.find(p => !p.url().startsWith('chrome-extension://')) || pages[0];
    if (!page) throw new Error('No active page tab found in Chrome on port 9222.');

    if (action === 'GOTO') {
      await page.goto(value, { waitUntil: 'domcontentloaded', timeout: 30000 });
      return { success: true };
    }

    if (action === 'CLICK') {
      const selector = `[data-agent-id="${elementId}"]`;
      try {
        await page.waitForSelector(selector, { timeout: 5000 });
        await page.click(selector);
      } catch (e) {
        await page.evaluate((id) => {
          const el = document.querySelector(`[data-agent-id="${id}"]`);
          if (el) el.click();
        }, elementId);
      }
      await new Promise(r => setTimeout(r, 1200));
      return { success: true };
    }

    if (action === 'TYPE') {
      const selector = `[data-agent-id="${elementId}"]`;
      try {
        await page.waitForSelector(selector, { timeout: 5000 });
        await page.click(selector);
        await page.type(selector, value, { delay: 30 });
        await page.keyboard.press('Enter');
      } catch (e) {
        await page.evaluate((id, val) => {
          const el = document.querySelector(`[data-agent-id="${id}"]`);
          if (el) {
            el.focus();
            if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') el.value = val;
            else el.innerText = val;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }, elementId, value);
      }
      return { success: true };
    }

    if (action === 'SCROLL') {
      const distance = value === 'up' ? -500 : 500;
      await page.evaluate((y) => window.scrollBy(0, y), distance);
      return { success: true };
    }

    return { success: true };
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (staticServer) staticServer.close();
  if (process.platform !== 'darwin') app.quit();
});
