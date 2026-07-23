/**
 * AetherBrowser AI Agent Module v2.0
 * Performs DOM perception, LLM reasoning, and native action execution.
 */

async function execJS(webview, script, isRealChrome = false) {
  if (isRealChrome) {
    return await window.electronAPI.evalRealChrome({ expression: script });
  } else if (webview) {
    return await webview.executeJavaScript(script);
  }
  throw new Error("No active execution target found.");
}

/**
 * Clean up page DOM and retrieve interactive elements.
 * Assigns data-agent-id attributes and extracts text, value, position, and metadata.
 */
async function getInteractiveElements(webview, isRealChrome = false) {
  const script = `
    (function() {
      const elements = [];
      let idCounter = 0;

      function removeOldMarkings(node) {
        if (!node) return;
        if (node.removeAttribute) node.removeAttribute('data-agent-id');
        if (node.children) {
          for (const child of node.children) removeOldMarkings(child);
        }
        if (node.shadowRoot) removeOldMarkings(node.shadowRoot);
        if (node.tagName === 'IFRAME') {
          try {
            const iframeDoc = node.contentDocument || node.contentWindow.document;
            removeOldMarkings(iframeDoc);
          } catch (e) {}
        }
      }

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

        if (isCandidate) candidates.push(node);
        
        if (node.children) {
          for (const child of node.children) findCandidates(child);
        }
        if (node.shadowRoot) findCandidates(node.shadowRoot);
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

        let text = el.innerText || el.textContent || '';
        text = text.trim().replace(/\\s+/g, ' ');
        if (text.length > 80) text = text.substring(0, 80) + '...';

        elements.push({
          id: elementId,
          tagName: el.tagName.toLowerCase(),
          text: text,
          value: el.value || '',
          placeholder: el.placeholder || '',
          ariaLabel: el.getAttribute('aria-label') || '',
          title: el.title || '',
          type: el.type || '',
          name: el.name || '',
          role: el.getAttribute('role') || '',
          ariaExpanded: el.getAttribute('aria-expanded') || '',
          idAttr: el.id || '',
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
    console.error("DOM perception error:", err);
    return [];
  }
}

/**
 * Format the list of elements into a structured prompt line list
 */
function formatElements(elements) {
  if (!elements || elements.length === 0) return '(No interactive elements found)';
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
 * Parse JSON block from LLM output
 */
function parseJsonFromCli(text) {
  const ansiRegex = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;
  let cleanedText = text.replace(ansiRegex, '');
  cleanedText = cleanedText.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '');

  const jsonMatch = cleanedText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`Could not find a valid JSON object in output:\n${text}`);
  }

  const jsonBlock = jsonMatch[0];
  try {
    return JSON.parse(jsonBlock);
  } catch (err) {
    const thoughtMatch = jsonBlock.match(/"thought"\s*:\s*"([^"]+)"/);
    const descMatch = jsonBlock.match(/"description"\s*:\s*"([^"]+)"/);
    const actionMatch = jsonBlock.match(/"action"\s*:\s*"([^"]+)"/);
    const idMatch = jsonBlock.match(/"elementId"\s*:\s*(\d+|null)/);
    const valMatch = jsonBlock.match(/"value"\s*:\s*"([^"]+)"/);

    if (actionMatch) {
      const action = actionMatch[1];
      const elementId = idMatch && idMatch[1] !== 'null' ? parseInt(idMatch[1], 10) : null;
      const value = valMatch ? valMatch[1] : null;
      return {
        thought: thoughtMatch ? thoughtMatch[1] : '',
        description: descMatch ? descMatch[1] : '',
        action,
        elementId,
        value
      };
    }
    throw new Error(`Failed to parse JSON block: ${err.message}`);
  }
}

/**
 * Construct system prompt
 */
function getSystemPrompt() {
  return `You are AetherBrowser AI Agent v2.0. Your goal is to achieve the user's request by inspecting page elements and taking clean, precise browser actions.

You will be given:
1. User's Goal.
2. Current Page URL.
3. Current Real-World Date/Time Anchor.
4. List of Interactive Elements [tag id=ID] properties.
5. Action History log.

Your output MUST be a single valid JSON object:
{
  "thought": "Brief explanation of screen state and why you choose the next step.",
  "description": "User-friendly description of your action (e.g. 'Entering article title', 'Selecting category')",
  "action": "GOTO" | "CLICK" | "TYPE" | "SCROLL" | "WAIT" | "EXTRACT" | "ASK_USER" | "DOWNLOAD" | "FINISH",
  "elementId": number | null,
  "value": string | null
}

Action Specifications:
- GOTO: Navigate to absolute URL.
- CLICK: Click visible element by id.
- TYPE: Type text into element by id.
- SCROLL: Scroll page ("up" or "down").
- WAIT: Delay in ms (e.g. "2000").
- EXTRACT: Save screen info into value.
- ASK_USER: Yield control for login, CAPTCHA, or credentials.
- DOWNLOAD: Download media URL.
- FINISH: Complete task with final answer text.

Information Retrieval & Temporal Accuracy (CRITICAL):
- Check the Current Real-World Date/Time. Always use TODAY'S real date for news, stock market, weather, or reports.
- Utilize Deep Search capabilities in your mind to fetch today's live stock indices/data before writing reports.

Universal Form & Content Creation Protocol (CRITICAL):
- When writing blog posts (Tistory, Naver, WordPress, Notion, GitHub):
  1. AUDIT FORM FIELDS FIRST: Check if Title, Category, Content Body, and Tags fields exist.
  2. FILL IN ALL REQUIRED FIELDS SEQUENTIALLY before clicking final Submit/Publish.
  3. Formulate rich, structured, professional Korean content matching TODAY'S real data.

Rules:
- Only choose element IDs listed in interactive elements.
- Answer in Korean as the user speaks Korean.
- Output ONLY the JSON block without extra markdown backticks around it.`;
}

/**
 * Runs one reasoning step of the agent.
 */
export async function runAgentStep({ commandTemplate, goal, history, webview, detectedVideos, logCallback, isRealChrome = false }) {
  let url = 'http://localhost';
  if (isRealChrome) {
    try {
      url = await window.electronAPI.evalRealChrome({ expression: 'window.location.href' });
    } catch (e) {
      logCallback(`Real Chrome URL Error: ${e.message}`);
    }
  } else if (webview) {
    url = webview.getURL();
  }

  logCallback(`Analyzing page [${isRealChrome ? 'External Chrome 150' : 'Internal WebView'}]: ${url}`);

  const elements = await getInteractiveElements(webview, isRealChrome);
  logCallback(`Detected ${elements.length} interactive elements on page.`);

  const formattedElements = formatElements(elements);
  const formattedHistory = history.map((h, i) => `${i + 1}. [${h.action}] ${h.description} ${h.value ? `(${h.value})` : ''}`).join('\n') || 'None';

  const systemInstruction = getSystemPrompt();
  const prompt = `${systemInstruction}

--- GOAL ---
${goal}

--- CURRENT STATE ---
Current URL: ${url}
Current Real-World Date/Time: ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'full', timeStyle: 'medium' })}

--- ACTION HISTORY ---
${formattedHistory}

--- INTERACTIVE ELEMENTS ---
${formattedElements}

--- INSTRUCTION ---
Decide the next action based on the state above. Return the JSON object.`;

  const isHttp = commandTemplate.startsWith('http://') || commandTemplate.startsWith('https://');
  const isDirectApi = ['gemini-api', 'openai-api', 'claude-api'].includes(commandTemplate);

  let responseText = '';
  if (isDirectApi) {
    const provider = commandTemplate.replace('-api', '');
    const apiKey = window.localStorage.getItem(`${provider}-api-key`) || '';
    logCallback(`Calling Direct ${provider.toUpperCase()} API...`);
    responseText = await window.electronAPI.runDirectApi({ provider, prompt, apiKey });
  } else if (isHttp) {
    const urlObj = new URL(commandTemplate);
    const model = urlObj.searchParams.get('model') || 'llama3';
    urlObj.search = '';
    responseText = await window.electronAPI.runLocalHttp({ url: urlObj.toString(), model, prompt });
  } else {
    responseText = await window.electronAPI.runUniversalCli({ commandTemplate, prompt });
  }

  const actionObj = parseJsonFromCli(responseText);
  return {
    ...actionObj,
    elements
  };
}

/**
 * Executes the chosen action on WebView or External Chrome CDP
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
      if (webview) await webview.loadURL(value);
      break;
    }
    case 'CLICK': {
      if (elementId === null || elementId === undefined) throw new Error("CLICK action requires an elementId.");
      logCallback(`Clicking element with id: ${elementId}`);

      const success = await execJS(webview, `
        (function() {
          function findElementById(node, id) {
            if (!node) return null;
            if (node.getAttribute && node.getAttribute('data-agent-id') === String(id)) return node;
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
            if (node.getAttribute && node.getAttribute('data-agent-id') === String(id)) return node;
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
            if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') el.value = '';
            else el.innerText = '';

            const text = ${jsonValue};
            for(let i=0; i<text.length; i++) {
              const char = text[i];
              const keyCode = char.charCodeAt(0);
              const keydown = new KeyboardEvent('keydown', { key: char, code: 'Key' + char.toUpperCase(), keyCode, which: keyCode, bubbles: true });
              const keypress = new KeyboardEvent('keypress', { key: char, code: 'Key' + char.toUpperCase(), keyCode, which: keyCode, bubbles: true });
              
              if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') el.value += char;
              else el.innerText += char;
              
              el.dispatchEvent(keydown);
              el.dispatchEvent(keypress);
              el.dispatchEvent(new Event('input', { bubbles: true }));
              const keyup = new KeyboardEvent('keyup', { key: char, code: 'Key' + char.toUpperCase(), keyCode, which: keyCode, bubbles: true });
              el.dispatchEvent(keyup);
            }
            
            el.dispatchEvent(new Event('change', { bubbles: true }));
            const enterDown = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true });
            const enterUp = new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true });
            el.dispatchEvent(enterDown);
            el.dispatchEvent(enterUp);

            const form = el.closest('form');
            if (form) form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

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
      logCallback(`Extracted Info: ${value}`);
      break;
    }
    case 'ASK_USER': {
      logCallback(`Paused for Human Action: ${value}`);
      break;
    }
    case 'DOWNLOAD': {
      if (!value) throw new Error("DOWNLOAD action requires a URL value.");
      logCallback(`Downloading media URL: ${value}`);
      const fileTimestamp = Date.now();
      const outputFilename = `media_${fileTimestamp}_ai.mp4`;
      const savePath = await window.electronAPI.downloadMedia({ url: value, filename: outputFilename });
      logCallback(`Download completed! Saved to: ${savePath}`);
      break;
    }
    case 'FINISH': {
      logCallback(`Task Complete. Final Answer: ${value}`);
      break;
    }
    default:
      throw new Error(`Unknown action: ${action}`);
  }
}
