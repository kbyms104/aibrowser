async function execJS(webview, script, isRealChrome = false) {
  if (isRealChrome) {
    return await window.electronAPI.evalRealChrome({ expression: script });
  } else {
    return await webview.executeJavaScript(script);
  }
}

/**
 * Clean up page DOM and retrieve interactive elements.
 * Runs inside the Electron WebView context or Real Chrome 150 CDP context.
 */
async function getInteractiveElements(webview, isRealChrome = false) {
  const script = `
    (function() {
      const elements = [];
      let idCounter = 0;

      // Recursively remove old markings
      function removeOldMarkings(node) {
        if (!node) return;
        
        if (node.removeAttribute) {
          node.removeAttribute('data-agent-id');
        }
        
        if (node.children) {
          for (const child of node.children) {
            removeOldMarkings(child);
          }
        }
        
        if (node.shadowRoot) {
          removeOldMarkings(node.shadowRoot);
        }
        
        if (node.tagName === 'IFRAME') {
          try {
            const iframeDoc = node.contentDocument || node.contentWindow.document;
            removeOldMarkings(iframeDoc);
          } catch (e) {}
        }
      }

      // Recursively find candidates
      const candidates = [];
      function findCandidates(node) {
        if (!node) return;
        
        const interactiveSelectors = 'button, a, input, textarea, select, [role="button"], [role="link"], [role="combobox"], [role="listbox"], [role="option"], [role="menuitem"], [role="checkbox"], [role="radio"], [contenteditable="true"], [class*="category"], [id*="category"], [class*="select"], [class*="option"], [class*="btn"]';
        let isCandidate = node.matches && node.matches(interactiveSelectors);
        
        if (!isCandidate && node.innerText && node.children && node.children.length === 0) {
          const txt = node.innerText.trim();
          if (txt === '카테고리' || txt === '카테고리 선택' || txt === '완료' || txt === '발행' || txt === '발행하기' || txt === '공개') {
            isCandidate = true;
          }
        }

        if (isCandidate) {
          candidates.push(node);
        }
        
        if (node.children) {
          for (const child of node.children) {
            findCandidates(child);
          }
        }
        
        if (node.shadowRoot) {
          findCandidates(node.shadowRoot);
        }
        
        if (node.tagName === 'IFRAME') {
          try {
            const iframeDoc = node.contentDocument || node.contentWindow.document;
            findCandidates(iframeDoc);
          } catch (e) {}
        }
      }

      removeOldMarkings(document);
      findCandidates(document);

      candidates.forEach(el => {
        // Check visibility and dimensions
        const rect = el.getBoundingClientRect();
        const style = el.ownerDocument.defaultView.getComputedStyle(el);
        
        const isVisible = rect.width > 0 && 
                          rect.height > 0 && 
                          style.visibility !== 'hidden' && 
                          style.display !== 'none' && 
                          parseFloat(style.opacity || '1') > 0;
        
        if (!isVisible) return;

        const elementId = idCounter++;
        el.setAttribute('data-agent-id', elementId);

        // Extract text content and limit length
        let text = el.innerText || el.textContent || '';
        text = text.trim().replace(/\\s+/g, ' ');
        if (text.length > 80) {
          text = text.substring(0, 80) + '...';
        }

        // Extract relevant attributes
        const placeholder = el.getAttribute('placeholder') || '';
        const ariaLabel = el.getAttribute('aria-label') || '';
        const title = el.getAttribute('title') || '';
        const type = el.getAttribute('type') || '';
        const role = el.getAttribute('role') || '';
        const tagName = el.tagName.toLowerCase();
        const name = el.getAttribute('name') || '';
        const value = (el.value !== undefined && el.value !== null) ? String(el.value).substring(0, 50) : '';
        const ariaExpanded = el.getAttribute('aria-expanded') || '';
        const ariaHaspopup = el.getAttribute('aria-haspopup') || '';
        const idAttr = el.id || '';
        const className = el.className && typeof el.className === 'string' ? el.className.substring(0, 50) : '';

        elements.push({
          id: elementId,
          tagName,
          type,
          text,
          placeholder,
          ariaLabel,
          title,
          role,
          name,
          value,
          ariaExpanded,
          ariaHaspopup,
          idAttr,
          className,
          boundingBox: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height)
          }
        });
      });

      return elements;
    })()
  `;

  try {
    return await execJS(webview, script, isRealChrome);
  } catch (err) {
    console.error("DOM parsing failed:", err);
    return [];
  }
}

/**
 * Format the list of elements into a readable string for the LLM
 */
function formatElements(elements) {
  return elements.map(el => {
    let parts = [`[${el.tagName}${el.idAttr ? `#${el.idAttr}` : ''} id=${el.id}]`];
    if (el.text) parts.push(`text: "${el.text}"`);
    if (el.value) parts.push(`value: "${el.value}"`);
    if (el.placeholder) parts.push(`placeholder: "${el.placeholder}"`);
    if (el.ariaLabel) parts.push(`ariaLabel: "${el.ariaLabel}"`);
    if (el.title) parts.push(`title: "${el.title}"`);
    if (el.type) parts.push(`type: "${el.type}"`);
    if (el.name) parts.push(`name: "${el.name}"`);
    if (el.role) parts.push(`role: "${el.role}"`);
    if (el.ariaExpanded) parts.push(`ariaExpanded: "${el.ariaExpanded}"`);
    parts.push(`pos: (${el.boundingBox.x}, ${el.boundingBox.y}, w: ${el.boundingBox.width}, h: ${el.boundingBox.height})`);
    return parts.join(' | ');
  }).join('\n');
}

/**
 * Robust JSON parser that extracts JSON blocks from conversational CLI outputs
 */
function parseJsonFromCli(text) {
  // 1. Strip ANSI escape sequences (e.g. \u001b[6D, \u001b[K) commonly emitted by CLI shells
  const ansiRegex = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;
  let cleanedText = text.replace(ansiRegex, '');

  // 2. Strip invalid control characters that JSON.parse rejects (0-31 except \n, \r, \t)
  cleanedText = cleanedText.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '');

  // Helper to escape raw newlines inside JSON string literals
  const escapeRawNewlines = (str) => {
    let insideString = false;
    let escaped = false;
    let result = '';
    
    for (let i = 0; i < str.length; i++) {
      const char = str[i];
      
      if (char === '"' && !escaped) {
        insideString = !insideString;
      }
      
      if (char === '\\' && insideString) {
        escaped = !escaped;
      } else {
        escaped = false;
      }
      
      if (insideString) {
        if (char === '\n') {
          result += '\\n';
        } else if (char === '\r') {
          result += '\\r';
        } else {
          result += char;
        }
      } else {
        result += char;
      }
    }
    return result;
  };

  cleanedText = escapeRawNewlines(cleanedText).trim();
  
  // Try direct parsing first
  try {
    return JSON.parse(cleanedText);
  } catch (e) {
    // Locate the first { and last } pair
    const jsonMatch = cleanedText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error(`Failed to locate JSON object { ... } in the CLI output.\nRaw CLI Output:\n${text}`);
    }

    let jsonBlock = jsonMatch[0];
    
    // Remove markdown wrapping if present
    jsonBlock = jsonBlock.replace(/```json/g, '').replace(/```/g, '').trim();

    try {
      return JSON.parse(jsonBlock);
    } catch (innerErr) {
      // 3. Fallback: Regex-based Malformed JSON recovery parser
      try {
        const actionMatch = jsonBlock.match(/"action"\s*:\s*"(\w+)"/i);
        if (actionMatch) {
          const action = actionMatch[1].toUpperCase();
          
          const thoughtMatch = jsonBlock.match(/"thought"\s*:\s*"([\s\S]*?)"\s*(?:,|\n|\r)/);
          const descMatch = jsonBlock.match(/"description"\s*:\s*"([\s\S]*?)"\s*(?:,|\n|\r)/);
          const elementIdMatch = jsonBlock.match(/"elementId"\s*:\s*(\d+|null)/i);
          const valueMatch = jsonBlock.match(/"value"\s*:\s*"([\s\S]*?)"\s*(?:\n|\r|\})/);
          
          let elementId = null;
          if (elementIdMatch && elementIdMatch[1] !== 'null') {
            elementId = parseInt(elementIdMatch[1], 10);
          }
          
          let value = null;
          if (valueMatch) {
            value = valueMatch[1];
            // If the value contains duplicated URLs due to LLM repetition, extract the last valid URL
            const urlMatches = value.match(/https?:\/\/[^\s"\\]+/g);
            if (urlMatches && urlMatches.length > 0) {
              value = urlMatches[urlMatches.length - 1];
            } else {
              value = value.replace(/"/g, '').trim();
            }
          }
          
          return {
            thought: thoughtMatch ? thoughtMatch[1].replace(/\\n/g, '\n').trim() : '',
            description: descMatch ? descMatch[1].trim() : '',
            action,
            elementId,
            value
          };
        }
      } catch (regexErr) {
        console.error("Regex recovery parser failed:", regexErr);
      }
      
      throw new Error(`Found JSON block but failed to parse it: ${innerErr.message}.\nJSON Block:\n${jsonBlock}`);
    }
  }
}

/**
 * Create the system prompt for the CLI agent
 */
function getSystemPrompt() {
  return `You are an AI Automated Browser Agent. Your job is to achieve the user's goal by navigating websites, clicking elements, typing in text, scrolling, and extracting data.

You will be given:
1. The user's goal.
2. The current page URL.
3. A list of detected media files (videos) available to download.
4. A list of interactive elements present on the page, formatted as: [tag id=ID] properties.
5. A chronological log of actions taken so far to prevent loops.

Your output MUST contain a single valid JSON object matching the following structure:
{
  "thought": "Brief explanation of what you see on the screen and why you are choosing the next step.",
  "description": "User-friendly description of your action (e.g. 'Clicking search bar', 'Entering query')",
  "action": "GOTO" | "CLICK" | "TYPE" | "SCROLL" | "WAIT" | "EXTRACT" | "ASK_USER" | "DOWNLOAD" | "FINISH",
  "elementId": number | null, // Required for CLICK, TYPE
  "value": string | null // Required for GOTO (url), TYPE (text to type), SCROLL ("up" or "down"), WAIT (ms as string e.g. "2000"), EXTRACT (fields/data description), ASK_USER (instructions for manual user step), DOWNLOAD (exact URL to download from the list), FINISH (final answer text)
}

Action Specifications:
- GOTO: Navigate to a URL. The "value" must be the absolute URL (e.g., "https://www.google.com").
- CLICK: Click on a visible element by its id.
- TYPE: Type text into an input or textarea element by its id. The text should be placed in "value". Pressing enter will be handled automatically.
- SCROLL: Scroll the page. "value" must be "down" or "up".
- WAIT: Wait for a specific duration in milliseconds. e.g., "value": "2000".
- EXTRACT: Retrieve information from the current screen. Put the extracted information in "value". You can do this multiple times if you need to gather data from different pages.
- ASK_USER: Yield control to the user and pause automation. Use this when you hit a login wall, CAPTCHA, verification panel, payment page, or anything that requires user-specific credentials or manual verification. The "value" must describe what the user needs to do (e.g. "로그인 및 본인 인증을 진행해 주세요").
- DOWNLOAD: Download a detected media URL directly to the user's Downloads folder. The "value" must be the exact URL to download from the --- DETECTED VIDEOS --- list.
- FINISH: Report that the task is complete. "value" must contain the final comprehensive answer or summary for the user.

Media Downloader Instructions (CRITICAL):
- This browser has a built-in "Media Downloader" that automatically intercepts and captures video stream URLs played on the page.
- If the user's goal is to "download a video" or "save an image" from a social media site (like Instagram, TikTok, YouTube, etc.):
  1. DO NOT search Google for third-party downloader websites (like SnapInsta, SaveFrom, etc.). These sites are often blocked, rate-limited, or insecure.
  2. Simply navigate to the target video/media page using GOTO.
  3. Ensure the video is loaded, visible, or playing (you can use CLICK to play it, or WAIT a few seconds for the page to render).
  4. Once the video has played or loaded, look at the --- DETECTED VIDEOS --- list in the prompt.
  5. Choose the best video URL (prefer URLs labeled with "소리 포함" / "High Quality Progressive Video with Audio" or the correct video stream).
  6. Execute the DOWNLOAD action with that URL to save it directly to the user's Downloads folder.
  7. Once the download succeeds, call FINISH and report to the user that the download is complete.

Information Retrieval & Deep Search Instructions (CRITICAL):
- If the goal requires gathering general information, researching, analyzing a topic, or generating report text (e.g., stock market analysis, weather reports, news articles, essays):
  1. TEMPORAL ANCHOR & ACCURACY: Always check the "Current Real-World Date/Time" in the prompt. You MUST generate or search for information matching TODAY'S EXACT REAL-WORLD DATE. Never output outdated index numbers or historical data from 2024/2025 unless explicitly asked.
  2. DEEP SEARCH: Utilize your built-in Google Search grounding / Deep Search capabilities in your thought process to retrieve TODAY'S real-time stock market indices (KOSPI, KOSDAQ), Exchange rates, and market trends.
  3. EFFICIENT BROWSER EXECUTION: Use the browser ONLY for the execution phase (e.g., navigating directly to Tistory/Naver, opening the editor, typing the pre-generated report/content matching TODAY'S date, and publishing it).
  4. Formulate the report contents matching TODAY'S real data in your mind, then proceed directly to the publication/execution page using GOTO.

Content Writing & Formatting Guidelines (CRITICAL):
- When generating blog posts, news articles, or reports, the content must NOT be short, dry, or generic.
- You MUST write high-quality, professional, and detailed content suited for the specific platform (e.g., a rich, structured blog post for Tistory).
- Always use a clean layout:
  1. Use clear, engaging headings (e.g. [제목], [본문] structure or using subheadings).
  2. Use well-structured paragraphs with professional and readable grammar in Korean.
  3. Format data or bullet points clearly with professional emojis or numbered lists to increase readability.
  4. Include a proper introduction, detailed core analysis sections, and a concluding summary.
  5. The length should be substantial (at least 3-4 rich paragraphs with detailed analysis) rather than a brief outline.

Universal Form & Content Creation Protocol (CRITICAL):
- On ANY website (Tistory, Naver Blog, WordPress, Medium, Notion, Twitter/X, GitHub, Reddit, LinkedIn, Shopify, etc.), when performing a creation, posting, editing, or submission task:
  1. SCAN ALL FORM FIELDS & ATTRIBUTES: Observe every input, textarea, dropdown/combobox, file upload, and select control available on the screen. Look at "placeholder", "text", "value", "role", and "name" attributes.
  2. COMPLETE ALL METADATA & CONTENT FIELDS BEFORE SUBMISSION:
     - Title/Subject Field: Fill in the main title/subject if empty ("placeholder" containing Title/Subject/제목). Never leave title blank.
     - Category/Topic Selector: If a category/topic selector exists (e.g. elements with ARIA roles "combobox", "listbox", "select", or text/class containing Category/Topic/카테고리/분류), CLICK to open the menu and SELECT an appropriate category BEFORE submitting.
     - Content/Body Area: Type the comprehensive, high-quality main content body into the main editor area.
     - Tags/Keywords Field: Type relevant tags or keywords if present (e.g., "placeholder" or "name" containing Tag/Keyword/태그/키워드).
  3. AUDIT BEFORE FINAL SUBMIT: NEVER click final submission or completion buttons (such as "Submit", "Publish", "Post", "Save", "Complete", "완료", "발행", "등록", "전송") while key input fields (Title, Category, Body, Tags) remain blank or unselected on the screen.
  4. HANDLE MULTI-STAGE MODALS: If clicking "Submit" or "Publish" opens a secondary confirmation modal or settings layer (e.g. asking for visibility/public/private, category, thumbnail, or tags), inspect the modal elements, select "Public/공개" or fill missing settings, and click the final confirmation button to complete.

Rules:
1. Only choose element IDs that are listed in the interactive elements list.
2. If the page is loading or elements are missing, you can WAIT or reload.
3. Be efficient. Try to achieve the goal in as few steps as possible (maximum 15 steps).
4. If you get stuck in a loop, try a different approach or search query.
5. If a login page or CAPTCHA blocks the task, you MUST use ASK_USER. Do not attempt to guess credentials.
6. Answer in Korean as the user speaks Korean.

Important: You MUST output the JSON block. Do not include extra text before or after the JSON.`;
}

/**
 * Runs one step of the agent loop.
 * Returns the parsed action object.
 */
export async function runAgentStep({ commandTemplate, goal, history, webview, detectedVideos, logCallback, isRealChrome = false }) {
  let url = 'http://localhost';
  if (isRealChrome) {
    try {
      url = await window.electronAPI.evalRealChrome({ expression: 'window.location.href' });
    } catch (e) {
      logCallback(`Real Chrome 150 URL Error: ${e.message}`);
    }
  } else if (webview) {
    url = webview.getURL();
  }

  logCallback(`Analyzing page [${isRealChrome ? 'Real Chrome 150 CDP' : 'Electron WebView'}]: ${url}`);

  // 1. Get interactive elements
  const elements = await getInteractiveElements(webview, isRealChrome);
  logCallback(`Detected ${elements.length} interactive elements on page.`);
  
  console.log(`[AGENT DEBUG] URL: ${url} | Detected ${elements.length} elements.`);
  window.electronAPI.writeLog(`[AGENT DEBUG] URL: ${url} | Detected ${elements.length} elements.`).catch(e => {});
  elements.forEach(el => {
    const isSpecial = ['input', 'textarea', 'select'].includes(el.tagName) || el.placeholder || el.text.includes('쓰기') || el.text.includes('글') || el.text.includes('완료') || el.text.includes('등록');
    if (isSpecial) {
      const elMsg = `  -> [ID ${el.id}] <${el.tagName}> text="${el.text}" placeholder="${el.placeholder}" name="${el.name}"`;
      console.log(elMsg);
      window.electronAPI.writeLog(elMsg).catch(e => {});
    }
  });

  const formattedElements = formatElements(elements);

  // 1b. Check progressive video URL
  let progressiveUrl = null;
  try {
    progressiveUrl = await webview.executeJavaScript(`
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
  } catch (e) {}

  // If a progressive URL was found and is not in detectedVideos, add it!
  const finalDetectedVideos = [...(detectedVideos || [])];
  if (progressiveUrl && !finalDetectedVideos.includes(progressiveUrl)) {
    finalDetectedVideos.unshift(progressiveUrl);
  }

  // Format detected videos list for prompt
  const formattedVideos = finalDetectedVideos.map((url, idx) => {
    const isProgressive = (url === progressiveUrl);
    return `[Index ${idx}] URL: ${url} ${isProgressive ? '(소리 포함 - High Quality Progressive Video with Audio. RECOMMEND THIS!)' : '(일반 비디오/오디오 스트림)'}`;
  }).join('\n') || 'None';

  // 2. Format history logs
  const formattedHistory = history.map((h, i) => `${i + 1}. [${h.action}] ${h.description} ${h.value ? `(${h.value})` : ''}`).join('\n') || 'None';

  // 3. Construct prompt
  const systemInstruction = getSystemPrompt();
  const prompt = `${systemInstruction}

--- GOAL ---
${goal}

--- CURRENT STATE ---
Current URL: ${url}
Current Real-World Date/Time: ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'full', timeStyle: 'medium' })}

--- DETECTED VIDEOS ---
${formattedVideos}

--- ACTION HISTORY ---
${formattedHistory}

--- INTERACTIVE ELEMENTS ---
${formattedElements || '(No interactive elements found)'}

--- INSTRUCTION ---
Decide the next action based on the state above. Return the JSON object.`;

  const isHttp = commandTemplate.startsWith('http://') || commandTemplate.startsWith('https://');

  if (isHttp) {
    logCallback(`Calling Local HTTP API: "${commandTemplate.substring(0, 50)}${commandTemplate.length > 50 ? '...' : ''}"`);
  } else {
    logCallback(`Calling Local/Cloud AI via CLI: "${commandTemplate.substring(0, 50)}${commandTemplate.length > 50 ? '...' : ''}"`);
  }

  try {
    let responseText = '';
    const isDirectApi = ['gemini-api', 'openai-api', 'claude-api'].includes(commandTemplate);

    if (isDirectApi) {
      const provider = commandTemplate.replace('-api', '');
      const apiKey = window.localStorage.getItem(`${provider}-api-key`) || '';
      logCallback(`Calling Direct ${provider.toUpperCase()} HTTP API (Ultra Fast)...`);
      responseText = await window.electronAPI.runDirectApi({
        provider,
        prompt,
        apiKey
      });
    } else if (isHttp) {
      // Parse model from URL query parameters (e.g. ?model=llama3)
      const urlObj = new URL(commandTemplate);
      const model = urlObj.searchParams.get('model') || 'llama3';
      
      // Clean query parameter from target URL
      urlObj.search = '';
      const cleanUrl = urlObj.toString();
      
      responseText = await window.electronAPI.runLocalHttp({
        url: cleanUrl,
        model,
        prompt
      });
    } else {
      // Invoke the secure IPC main command executor
      responseText = await window.electronAPI.runUniversalCli({
        commandTemplate,
        prompt
      });
    }

    logCallback(`Parsing AI output...`);
    const actionObj = parseJsonFromCli(responseText);

    logCallback(`AI Thought: "${actionObj.thought}"`);
    logCallback(`AI Decision: [${actionObj.action}] ${actionObj.description}`);

    return {
      ...actionObj,
      elements
    };
  } catch (error) {
    console.error("CLI Agent Error:", error);
    throw new Error(`Failed to generate action: ${error.message}`);
  }
}

/**
 * Executes the chosen action inside the WebView
 */
export async function executeAgentAction(webview, actionObj, logCallback, isRealChrome = false) {
  const { action, elementId, value } = actionObj;

  if (isRealChrome && ['GOTO', 'CLICK', 'TYPE', 'SCROLL'].includes(action)) {
    logCallback(`[CDP Native Action] ${action} ${value || ''}`);
    await window.electronAPI.cdpAction({ action, elementId, value });
    return;
  }

  switch (action) {
    case 'GOTO': {
      if (!value) throw new Error("GOTO action requires a URL value.");
      logCallback(`Navigating to: ${value}`);
      try {
        if (isRealChrome) {
          await window.electronAPI.evalRealChrome({ expression: `window.location.href = ${JSON.stringify(value)}` });
        } else if (webview) {
          await webview.loadURL(value);
        }
      } catch (err) {
        logCallback(`Navigation Warning: ${err.message}`);
      }
      break;
    }
    case 'CLICK': {
      if (elementId === null || elementId === undefined) throw new Error("CLICK action requires an elementId.");
      logCallback(`Clicking element with id: ${elementId}`);
      
      const success = await execJS(webview, `
        (function() {
          function findElementById(node, id) {
            if (!node) return null;
            
            if (node.getAttribute && node.getAttribute('data-agent-id') === String(id)) {
              return node;
            }
            
            if (node.children) {
              for (const child of node.children) {
                const found = findElementById(child, id);
                if (found) return found;
              }
            }
            
            if (node.shadowRoot) {
              const found = findElementById(node.shadowRoot, id);
              if (found) return found;
            }
            
            if (node.tagName === 'IFRAME') {
              try {
                const iframeDoc = node.contentDocument || node.contentWindow.document;
                const found = findElementById(iframeDoc, id);
                if (found) return found;
              } catch (e) {}
            }
            
            return null;
          }

          const el = findElementById(document, "${elementId}");
          if (el) {
            el.scrollIntoView({ block: 'center' });
            
            // Dispatch full event sequence for custom frameworks (React, Vue, Tistory, Naver)
            const opts = { bubbles: true, cancelable: true, view: window, buttons: 1 };
            try { el.dispatchEvent(new PointerEvent('pointerdown', opts)); } catch(e) {}
            try { el.dispatchEvent(new MouseEvent('mousedown', opts)); } catch(e) {}
            try { el.dispatchEvent(new PointerEvent('pointerup', opts)); } catch(e) {}
            try { el.dispatchEvent(new MouseEvent('mouseup', opts)); } catch(e) {}
            
            el.click();
            return true;
          }
          return false;
        })()
      `, isRealChrome);
      if (!success) throw new Error(`Failed to click element: [id=${elementId}]`);
      
      // Auto-wait 1.2s for dynamic popovers and modals to render in DOM
      await new Promise(r => setTimeout(r, 1200));
      break;
    }
    case 'TYPE': {
      if (elementId === null || elementId === undefined) throw new Error("TYPE action requires an elementId.");
      if (value === null || value === undefined) throw new Error("TYPE action requires a text value.");
      logCallback(`Typing "${value}" into element id: ${elementId}`);

      const jsonValue = JSON.stringify(value);
      const success = await execJS(webview, `
        (function() {
          function findElementById(node, id) {
            if (!node) return null;
            
            if (node.getAttribute && node.getAttribute('data-agent-id') === String(id)) {
              return node;
            }
            
            if (node.children) {
              for (const child of node.children) {
                const found = findElementById(child, id);
                if (found) return found;
              }
            }
            
            if (node.shadowRoot) {
              const found = findElementById(node.shadowRoot, id);
              if (found) return found;
            }
            
            if (node.tagName === 'IFRAME') {
              try {
                const iframeDoc = node.contentDocument || node.contentWindow.document;
                const found = findElementById(iframeDoc, id);
                if (found) return found;
              } catch (e) {}
            }
            
            return null;
          }

          const el = findElementById(document, "${elementId}");
          if (el) {
            el.scrollIntoView({ block: 'center' });
            el.focus();
            
            // Clear content
            if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
              el.value = '';
            } else {
              el.innerText = '';
            }

            // Type values with human-like key event dispatching
            const text = ${jsonValue};
            for(let i=0; i<text.length; i++) {
              const char = text[i];
              const keyCode = char.charCodeAt(0);
              
              const keydown = new KeyboardEvent('keydown', { key: char, code: 'Key' + char.toUpperCase(), keyCode: keyCode, which: keyCode, bubbles: true });
              const keypress = new KeyboardEvent('keypress', { key: char, code: 'Key' + char.toUpperCase(), keyCode: keyCode, which: keyCode, bubbles: true });
              
              if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
                el.value += char;
              } else {
                el.innerText += char;
              }
              
              el.dispatchEvent(keydown);
              el.dispatchEvent(keypress);
              el.dispatchEvent(new Event('input', { bubbles: true }));
              
              const keyup = new KeyboardEvent('keyup', { key: char, code: 'Key' + char.toUpperCase(), keyCode: keyCode, which: keyCode, bubbles: true });
              el.dispatchEvent(keyup);
            }
            
            el.dispatchEvent(new Event('change', { bubbles: true }));

            // Dispatch Enter key event
            const enterDown = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true });
            const enterUp = new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true });
            el.dispatchEvent(enterDown);
            el.dispatchEvent(enterUp);

            // If inside a form, trigger submit as fallback
            const form = el.closest('form');
            if (form) {
              form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
            }

            return true;
          }
          return false;
        })()
      `, isRealChrome);
      if (!success) throw new Error(`Failed to type into element: [id=${elementId}]`);
      break;
    }
    case 'SCROLL': {
      const scrollY = value === 'up' ? -500 : 500;
      logCallback(`Scrolling ${value === 'up' ? 'up' : 'down'}...`);
      await execJS(webview, `window.scrollBy(0, ${scrollY})`, isRealChrome);
      break;
    }
    case 'WAIT': {
      const ms = parseInt(value || '1000', 10);
      logCallback(`Waiting for ${ms}ms...`);
      await new Promise(resolve => setTimeout(resolve, ms));
      break;
    }
    case 'EXTRACT': {
      logCallback(`Information Extracted: ${value}`);
      break;
    }
    case 'ASK_USER': {
      logCallback(`Paused for Human Intervention: ${value}`);
      break;
    }
    case 'DOWNLOAD': {
      if (!value) throw new Error("DOWNLOAD action requires a URL value.");
      logCallback(`Downloading media URL directly: ${value}`);
      
      const fileTimestamp = Date.now();
      const outputFilename = `instagram_video_${fileTimestamp}_ai.mp4`;
      
      // Invoke the direct download bridge
      const savePath = await window.electronAPI.downloadMedia({
        url: value,
        filename: outputFilename
      });
      
      logCallback(`Direct download completed successfully! Saved to: ${savePath}`);
      break;
    }
    case 'FINISH': {
      logCallback(`Task Finished. Final Answer: ${value}`);
      break;
    }
    default:
      throw new Error(`Unknown action: ${action}`);
  }
}
