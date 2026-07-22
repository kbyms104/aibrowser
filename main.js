import { app, BrowserWindow, ipcMain, webContents, session } from 'electron';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import dotenv from 'dotenv';
import { exec, spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import http from 'http';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow = null;
let staticServer = null;

// Track active background tasks to support instant cancellation
let activeChildProcess = null;
let activeAbortController = null;

// Start a local static server to bypass file:// CORS policy for ES Modules (type="module")
function startLocalServer() {
  staticServer = http.createServer((req, res) => {
    let relativePath = req.url === '/' ? 'index.html' : req.url;
    // Clean query params or hashes
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
    console.log('Local server running on http://127.0.0.1:49999');
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    title: "AetherBrowser - Custom AI Desktop Browser",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: true, // Crucial: Enables the use of <webview> tag in renderer
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // Load from local static server to support ES modules perfectly
  mainWindow.loadURL('http://127.0.0.1:49999');

  // Open DevTools by default to help diagnose errors
  mainWindow.webContents.openDevTools();

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Disable Chromium C++ level automation flags to prevent Google/Cloudflare bot detection
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');

const CLEAN_CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
app.userAgentFallback = CLEAN_CHROME_UA;

app.whenReady().then(() => {
  // Start local server
  startLocalServer();

  // Set default User Agent for all sessions
  session.defaultSession.setUserAgent(CLEAN_CHROME_UA);

  // Intercept all outgoing HTTP headers to strip Electron signatures from Google OAuth endpoints
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    details.requestHeaders['User-Agent'] = CLEAN_CHROME_UA;
    delete details.requestHeaders['X-Electron'];
    callback({ cancel: false, requestHeaders: details.requestHeaders });
  });

  // Handle window.open and target="_blank" from webviews by sending an event to the renderer to create a tab
  app.on('web-contents-created', (event, contents) => {
    try {
      contents.setUserAgent(CLEAN_CHROME_UA);
    } catch (e) {}

    contents.setWindowOpenHandler((details) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('open-tab-request', details.url);
      }
      return { action: 'deny' };
    });
  });

  // Register Electron IPC handlers
  
  // 1. IPC Handler: Capture Webview page screenshot
  ipcMain.handle('capture-webview', async (event, webContentsId) => {
    try {
      const wc = webContents.fromId(webContentsId);
      if (!wc) {
        throw new Error(`WebContents with ID ${webContentsId} not found.`);
      }
      const image = await wc.capturePage();
      return image.toJPEG(50).toString('base64');
    } catch (err) {
      console.error('Error capturing webview page:', err);
      throw err;
    }
  });

  // 2. IPC Handler: Universal CLI Execution Bridge
  ipcMain.handle('run-universal-cli', async (event, { commandTemplate, prompt }) => {
    if (!commandTemplate) {
      throw new Error("CLI Command Template is required.");
    }

    let command = commandTemplate.trim();
    let tempFilePath = null;

    try {
      // Input Method A: File Argument ($FILE)
      if (command.includes('$FILE')) {
        const tempDir = os.tmpdir();
        tempFilePath = path.join(tempDir, `aether_prompt_${Date.now()}.txt`);
        fs.writeFileSync(tempFilePath, prompt, 'utf8');
        command = command.replace(/\$FILE/g, `"${tempFilePath}"`);
      } 
      // Input Method B: Direct Argument ($PROMPT)
      else if (command.includes('$PROMPT')) {
        const escapedPrompt = prompt.replace(/"/g, '\\"');
        command = command.replace(/\$PROMPT/g, `"${escapedPrompt}"`);
      }

      // On Windows, force the command shell code page to UTF-8 (65001) to prevent Korean encoding corruption
      if (process.platform === 'win32') {
        command = `chcp 65001 > nul && ${command}`;
      }

      // Execute Subprocess
      return new Promise((resolve, reject) => {
        if (commandTemplate.includes('$FILE') || commandTemplate.includes('$PROMPT')) {
          console.log(`Executing CLI Command: ${command}`);
          const child = exec(command, (error, stdout, stderr) => {
            if (activeChildProcess === child) activeChildProcess = null;
            if (tempFilePath && fs.existsSync(tempFilePath)) {
              try { fs.unlinkSync(tempFilePath); } catch (e) {}
            }
            
            if (error) {
              console.error(`CLI execution error: ${error.message}`);
              return reject(new Error(`CLI Command Execution Failed: ${error.message}. Stderr: ${stderr}`));
            }
            resolve(stdout);
          });
          activeChildProcess = child;
        } 
        // Input Method C: Standard Input (stdin)
        else {
          console.log(`Spawning CLI (stdin-mode): ${command}`);
          const child = spawn(command, [], { shell: true });
          activeChildProcess = child;
          
          child.stdout.setEncoding('utf8');
          child.stderr.setEncoding('utf8');
          
          let stdout = '';
          let stderr = '';
          
          child.stdout.on('data', (data) => {
            stdout += data;
          });
          
          child.stderr.on('data', (data) => {
            stderr += data;
          });
          
          child.on('close', (code) => {
            if (activeChildProcess === child) activeChildProcess = null;
            if (code !== 0) {
              console.error(`CLI process exited with code ${code}. Stderr: ${stderr}`);
              return reject(new Error(`CLI Process Exited with Code ${code}. Stderr: ${stderr}`));
            }
            resolve(stdout);
          });
          
          child.on('error', (err) => {
            if (activeChildProcess === child) activeChildProcess = null;
            console.error(`CLI spawn process failure:`, err);
            reject(err);
          });
          
          child.stdin.write(prompt);
          child.stdin.end();
        }
      });

    } catch (err) {
      if (tempFilePath && fs.existsSync(tempFilePath)) {
        try { fs.unlinkSync(tempFilePath); } catch (e) {}
      }
      console.error("Universal CLI Bridge encountered an error:", err);
      throw err;
    }
  });

  // 2b. IPC Handler: Direct Cloud HTTP API Execution (Gemini, OpenAI, Claude)
  ipcMain.handle('run-direct-api', async (event, { provider, prompt, apiKey }) => {
    let key = apiKey;
    if (!key) {
      if (provider === 'gemini') key = process.env.GEMINI_API_KEY;
      else if (provider === 'openai') key = process.env.OPENAI_API_KEY;
      else if (provider === 'claude') key = process.env.ANTHROPIC_API_KEY;
    }

    if (!key) {
      throw new Error(`API Key for ${provider} is missing. Please set it in Settings or environment variables.`);
    }

    try {
      if (provider === 'gemini') {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${key}`;
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            tools: [{ google_search: {} }],
            generationConfig: { responseMimeType: 'application/json' }
          })
        });
        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`Gemini API Error (Status ${response.status}): ${errText}`);
        }
        const data = await response.json();
        if (!data.candidates || !data.candidates[0] || !data.candidates[0].content || !data.candidates[0].content.parts[0]) {
          throw new Error(`Invalid Gemini API response: ${JSON.stringify(data)}`);
        }
        return data.candidates[0].content.parts[0].text;
      } 
      else if (provider === 'openai') {
        const url = 'https://api.openai.com/v1/chat/completions';
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${key}`
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [{ role: 'user', content: prompt }],
            response_format: { type: 'json_object' }
          })
        });
        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`OpenAI API Error (Status ${response.status}): ${errText}`);
        }
        const data = await response.json();
        return data.choices[0].message.content;
      }
      else if (provider === 'claude') {
        const url = 'https://api.anthropic.com/v1/messages';
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': key,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify({
            model: 'claude-3-5-sonnet-20240620',
            max_tokens: 1536,
            messages: [{ role: 'user', content: prompt }]
          })
        });
        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`Claude API Error (Status ${response.status}): ${errText}`);
        }
        const data = await response.json();
        return data.content[0].text;
      }
    } catch (e) {
      console.error(`Direct API call to ${provider} failed:`, e);
      throw e;
    }

    throw new Error(`Unsupported provider: ${provider}`);
  });

  // 3. IPC Handler: Get absolute file path for guest preload script
  ipcMain.handle('get-guest-preload-path', () => {
    const filePath = path.join(__dirname, 'guest-preload.js');
    return pathToFileURL(filePath).toString();
  });

  // 3b. IPC Handler: Clear default session cache, cookies and storage data
  ipcMain.handle('clear-cache', async () => {
    try {
      const allSessions = session.getAllSessions ? session.getAllSessions() : [session.defaultSession];
      for (const s of allSessions) {
        // Clear HTTP cache
        try {
          await s.clearCache();
        } catch (e) {
          console.error("Failed to clear HTTP cache for a session:", e);
        }
        
        // Clear all storages (cookies, localStorage, indexedDB, caches, service workers, etc.)
        try {
          await s.clearStorageData({
            storages: ['cookies', 'localstorage', 'caches', 'indexdb', 'websql', 'serviceworkers', 'fileysystem'],
            quotas: ['temporary', 'persistent', 'syncable']
          });
        } catch (e) {
          console.error("Failed to clear storage data for a session:", e);
        }
      }
      return true;
    } catch (err) {
      console.error("Thorough clear-cache failed:", err);
      throw err;
    }
  });

  // 4. IPC Handler: High-speed Local HTTP API (Ollama/OpenAI compatible)
  ipcMain.handle('run-local-http', async (event, { url, model, prompt }) => {
    activeAbortController = new AbortController();
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: model || 'llama3',
          messages: [
            { role: 'user', content: prompt }
          ],
          temperature: 0.1
        }),
        signal: activeAbortController.signal
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      
      // Handle Ollama direct chat response format
      if (data.message && data.message.content) {
        return data.message.content;
      }
      
      // Handle OpenAI Chat completions format
      if (data.choices && data.choices[0] && data.choices[0].message) {
        return data.choices[0].message.content;
      }

      return data.response || JSON.stringify(data);
    } catch (err) {
      console.error('Local HTTP request failed:', err);
      throw new Error(`Local HTTP Request Failed: ${err.message}`);
    } finally {
      activeAbortController = null;
    }
  });

  // 7. IPC Handler: Abort currently running subprocess or fetch request
  ipcMain.handle('abort-agent-execution', () => {
    console.log('Aborting active agent execution by user request...');
    let abortedAny = false;
    
    if (activeChildProcess) {
      abortedAny = true;
      try {
        if (process.platform === 'win32') {
          // Forcefully terminate the process tree on Windows
          exec(`taskkill /pid ${activeChildProcess.pid} /t /f`);
        } else {
          activeChildProcess.kill('SIGKILL');
        }
      } catch (e) {
        console.error('Failed to kill active child process:', e);
      }
      activeChildProcess = null;
    }
    
    if (activeAbortController) {
      abortedAny = true;
      try {
        activeAbortController.abort();
      } catch (e) {
        console.error('Failed to abort fetch request:', e);
      }
      activeAbortController = null;
    }
    
    return abortedAny;
  });

  // 5. Network Sniffer: Intercept and capture video stream URLs
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const headers = details.responseHeaders || {};
    
    // Bypass CORS for local rendering preview of CDN media, ONLY when initiated by our local app
    const isLocalApp = (details.initiator && details.initiator.includes('127.0.0.1')) || 
                        (details.referrer && details.referrer.includes('127.0.0.1'));
    if (isLocalApp) {
      if (details.url.includes('cdninstagram.com') || details.url.includes('fbcdn.net')) {
        headers['Access-Control-Allow-Origin'] = ['http://127.0.0.1:49999'];
        headers['Access-Control-Allow-Methods'] = ['GET, OPTIONS'];
      }
    }

    const contentTypeHeader = Object.keys(headers).find(k => k.toLowerCase() === 'content-type');
    const contentType = contentTypeHeader ? headers[contentTypeHeader][0] : '';
    
    // Sniff video content types, bypassing local server requests
    if (contentType && contentType.toLowerCase().includes('video/') && !details.url.includes('127.0.0.1')) {
      let targetUrl = details.url;
      try {
        const urlObj = new URL(details.url);
        if (urlObj.searchParams.has('bytestart') || urlObj.searchParams.has('byteend')) {
          urlObj.searchParams.delete('bytestart');
          urlObj.searchParams.delete('byteend');
          targetUrl = urlObj.toString();
        }
      } catch (e) {
        console.error("Failed to clean video URL:", e);
      }

      if (mainWindow) {
        mainWindow.webContents.send('video-detected', {
          url: targetUrl,
          contentType,
          webContentsId: details.webContentsId
        });
      }
    }
    callback({ cancel: false, responseHeaders: headers });
  });

  // 6. IPC Handler: Download media files directly from node thread (bypassing CORS)
  ipcMain.handle('download-media', async (event, { url, filename }) => {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Referer': 'https://www.instagram.com/'
        }
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      
      const downloadsDir = app.getPath('downloads');
      const safeFilename = filename ? filename.replace(/[^a-z0-9_.-]/gi, '_') : `insta_video_${Date.now()}.mp4`;
      const savePath = path.join(downloadsDir, safeFilename);
      
      fs.writeFileSync(savePath, buffer);
      return savePath;
    } catch (err) {
      console.error('Failed to download video:', err);
      throw new Error(`Download failed: ${err.message}`);
    }
  });

  // 8. IPC Handler: Append message to persistent log file
  ipcMain.handle('write-log', async (event, message) => {
    try {
      const logPath = path.join(__dirname, 'agent_run.log');
      fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${message}\n`, 'utf8');
      return true;
    } catch (err) {
      console.error('Failed to append log:', err);
      return false;
    }
  });

  // 9. IPC Handler: Read local source file safely (Self-Healing helper)
  ipcMain.handle('read-source-file', async (event, filename) => {
    try {
      const safePath = path.resolve(__dirname, path.basename(filename));
      if (!fs.existsSync(safePath)) {
        throw new Error(`File does not exist: ${safePath}`);
      }
      return fs.readFileSync(safePath, 'utf8');
    } catch (err) {
      console.error('Failed to read source file:', err);
      throw err;
    }
  });

  // 10. IPC Handler: Write local source file safely (Self-Healing helper)
  ipcMain.handle('write-source-file', async (event, { filename, content }) => {
    try {
      const safePath = path.resolve(__dirname, path.basename(filename));
      const backupPath = `${safePath}.bak`;
      if (fs.existsSync(safePath)) {
        fs.copyFileSync(safePath, backupPath);
      }
      fs.writeFileSync(safePath, content, 'utf8');
      console.log(`[Self-Heal] Successfully wrote patch to: ${safePath}. Backup created at: ${backupPath}`);
      return true;
    } catch (err) {
      console.error('Failed to write source file:', err);
      throw err;
    }
  });

  // 12. IPC Handler: Launch installed real Google Chrome v150 via CDP stealth port
  ipcMain.handle('launch-stealth-chrome', async () => {
    const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    if (!fs.existsSync(chromePath)) {
      throw new Error(`Google Chrome executable not found at: ${chromePath}`);
    }

    const userDataDir = path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'User Data');
    
    // Clean arguments: opens CDP remote debugging port 9222 without triggering flags warning
    const args = [
      '--remote-debugging-port=9222',
      '--no-first-run',
      '--no-default-browser-check',
      '--start-maximized'
    ];

    console.log(`[Stealth Chrome] Launching authentic Chrome v150 from: ${chromePath}`);
    const chromeProc = spawn(chromePath, args, { detached: true, stdio: 'ignore' });
    chromeProc.unref();

    return {
      success: true,
      port: 9222,
      path: chromePath,
      message: 'Authentic Google Chrome 150 launched cleanly on stealth CDP port 9222.'
    };
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (staticServer) {
    staticServer.close();
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Global exception handlers for the Main Process to prevent silent hanging
process.on('uncaughtException', (err) => {
  console.error('[CRITICAL MAIN ERROR] Uncaught Exception:', err);
  try {
    const logPath = path.join(__dirname, 'agent_run.log');
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] [CRITICAL MAIN ERROR] ${err.stack || err.message || err}\n`, 'utf8');
  } catch (e) {}
  
  // Relaunch the app to attempt recovery
  app.relaunch();
  app.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[CRITICAL MAIN ERROR] Unhandled Rejection:', reason);
  try {
    const logPath = path.join(__dirname, 'agent_run.log');
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] [CRITICAL MAIN ERROR] Unhandled Rejection: ${reason.stack || reason.message || reason}\n`, 'utf8');
  } catch (e) {}
});
