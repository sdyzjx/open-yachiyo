(function chatWindowMain() {
  const bridge = window.desktopLive2dBridge;
  const messagesElement = document.getElementById('chat-panel-messages');
  const chatInputElement = document.getElementById('chat-input');
  const chatSendElement = document.getElementById('chat-send');
  const chatComposerElement = document.getElementById('chat-panel-composer');
  const chatHideElement = document.getElementById('chat-hide');
  const openWebUiElement = document.getElementById('open-webui');

  const state = {
    inputEnabled: true,
    messages: [],
    stream: {
      active: false,
      sessionId: null,
      traceId: null,
      text: '',
      stagedDelta: '',
      flushTimer: null,
      deltaCount: 0,
      previewNode: null,
      previewBody: null
    }
  };
  let chatInputComposing = false;
  const allowedRoles = new Set(['user', 'assistant', 'system', 'tool']);

  function normalizeRole(role) {
    const normalized = String(role || '').trim();
    return allowedRoles.has(normalized) ? normalized : 'assistant';
  }

  function scrollMessagesToBottom() {
    if (!messagesElement) {
      return;
    }
    messagesElement.scrollTop = messagesElement.scrollHeight;
  }

  function clearStreamingPreviewNode() {
    const { previewNode } = state.stream;
    if (previewNode && previewNode.parentNode) {
      previewNode.parentNode.removeChild(previewNode);
    }
    state.stream.previewNode = null;
    state.stream.previewBody = null;
  }

  function resetStreamingPreview() {
    if (state.stream.flushTimer) {
      clearTimeout(state.stream.flushTimer);
      state.stream.flushTimer = null;
    }
    state.stream.active = false;
    state.stream.sessionId = null;
    state.stream.traceId = null;
    state.stream.text = '';
    state.stream.stagedDelta = '';
    state.stream.deltaCount = 0;
    clearStreamingPreviewNode();
  }

  function ensureStreamingPreviewBody() {
    if (!messagesElement) {
      return null;
    }
    if (state.stream.previewBody && state.stream.previewBody.isConnected) {
      return state.stream.previewBody;
    }
    const node = document.createElement('div');
    node.className = 'chat-message assistant streaming';
    const body = document.createElement('div');
    body.className = 'chat-streaming-body';
    node.appendChild(body);
    messagesElement.appendChild(node);
    state.stream.previewNode = node;
    state.stream.previewBody = body;
    return body;
  }

  function renderStreamingPreview() {
    if (!state.stream.active) {
      clearStreamingPreviewNode();
      return;
    }
    if (!state.stream.text) {
      return;
    }
    const body = ensureStreamingPreviewBody();
    if (!body) {
      return;
    }
    body.textContent = state.stream.text;
    scrollMessagesToBottom();
  }

  function flushStreamingPreviewDelta() {
    if (!state.stream.active) {
      return;
    }
    if (state.stream.flushTimer) {
      clearTimeout(state.stream.flushTimer);
      state.stream.flushTimer = null;
    }
    const chunk = String(state.stream.stagedDelta || '');
    if (!chunk) {
      return;
    }
    state.stream.stagedDelta = '';
    state.stream.text += chunk;
    renderStreamingPreview();
  }

  function handleChatStreamSync(payload = {}) {
    const type = String(payload?.type || '').trim().toLowerCase();
    if (!type) {
      return;
    }

    if (type === 'reset') {
      resetStreamingPreview();
      return;
    }

    if (type !== 'delta') {
      return;
    }

    const delta = String(payload?.delta || '');
    if (!delta) {
      return;
    }

    const nextSessionId = payload?.sessionId ?? null;
    const nextTraceId = payload?.traceId ?? null;

    if (
      state.stream.active &&
      (
        (nextSessionId && state.stream.sessionId && nextSessionId !== state.stream.sessionId) ||
        (nextTraceId && state.stream.traceId && nextTraceId !== state.stream.traceId)
      )
    ) {
      resetStreamingPreview();
    }

    if (!state.stream.active) {
      state.stream.active = true;
      state.stream.sessionId = nextSessionId;
      state.stream.traceId = nextTraceId;
      state.stream.text = '';
      state.stream.stagedDelta = '';
      state.stream.deltaCount = 0;
    } else {
      if (!state.stream.sessionId && nextSessionId) {
        state.stream.sessionId = nextSessionId;
      }
      if (!state.stream.traceId && nextTraceId) {
        state.stream.traceId = nextTraceId;
      }
    }
    state.stream.stagedDelta += delta;
    state.stream.deltaCount += 1;
    if (!state.stream.flushTimer) {
      const flushDelay = state.stream.deltaCount === 1 ? 20 : 45;
      state.stream.flushTimer = setTimeout(() => {
        flushStreamingPreviewDelta();
      }, flushDelay);
    }
  }

  function renderLatex(text) {
    if (typeof katex === 'undefined') {
      return text;
    }

    try {
      // Replace display math: $$...$$
      text = text.replace(/\$\$([\s\S]+?)\$\$/g, (match, formula) => {
        try {
          return katex.renderToString(formula.trim(), {
            displayMode: true,
            throwOnError: false
          });
        } catch (err) {
          console.error('KaTeX display math error:', err);
          return match;
        }
      });

      // Replace inline math: $...$
      text = text.replace(/\$([^\$\n]+?)\$/g, (match, formula) => {
        try {
          return katex.renderToString(formula.trim(), {
            displayMode: false,
            throwOnError: false
          });
        } catch (err) {
          console.error('KaTeX inline math error:', err);
          return match;
        }
      });

      return text;
    } catch (err) {
      console.error('LaTeX render error:', err);
      return text;
    }
  }

  function escapeHtml(text) {
    return String(text)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  async function renderMarkdownWithMermaid(text) {
    if (typeof marked === 'undefined') {
      return text;
    }
    try {
      // First render LaTeX formulas
      const textWithLatex = renderLatex(text);

      // Configure marked renderer to handle mermaid code blocks
      const renderer = new marked.Renderer();
      const originalCodeRenderer = renderer.code.bind(renderer);

      renderer.code = function(code, language) {
        if (language === 'mermaid') {
          // Return mermaid diagram placeholder without pre/code wrapper
          return `<div class="mermaid-diagram" data-mermaid="${escapeHtml(code)}">${escapeHtml(code)}</div>`;
        }
        // Use default renderer for other code blocks
        return originalCodeRenderer(code, language);
      };

      return marked.parse(textWithLatex, {
        breaks: true,
        gfm: true,
        renderer: renderer
      });
    } catch (err) {
      console.error('Markdown parse error:', err);
      return text;
    }
  }

  function fixMermaidSyntax(code) {
    // Fix nested brackets in node labels by wrapping them in quotes
    // This handles cases like: A[text with [nested] brackets] --> B{text}

    const lines = code.split('\n');
    const fixedLines = lines.map(line => {
      let result = '';
      let i = 0;

      while (i < line.length) {
        // Look for node ID followed by [ or {
        const match = line.substring(i).match(/^(\w+)([\[\{])/);
        if (!match) {
          result += line[i];
          i++;
          continue;
        }

        const nodeId = match[1];
        const openBracket = match[2];
        const closeBracket = openBracket === '[' ? ']' : '}';

        // Find the matching closing bracket
        let depth = 1;
        let j = i + match[0].length;
        let text = '';
        let hasNestedBrackets = false;

        while (j < line.length && depth > 0) {
          const char = line[j];
          if (char === openBracket) {
            depth++;
            hasNestedBrackets = true;
          } else if (char === closeBracket) {
            depth--;
            if (depth === 0) break;
          }
          text += char;
          j++;
        }

        // Check if text is already quoted
        const isQuoted = (text.startsWith('"') && text.endsWith('"')) ||
                         (text.startsWith("'") && text.endsWith("'"));

        // Add quotes if there are nested brackets and not already quoted
        if (hasNestedBrackets && !isQuoted) {
          const escapedText = text.replace(/"/g, '&quot;');
          result += nodeId + openBracket + '"' + escapedText + '"' + closeBracket;
        } else {
          result += nodeId + openBracket + text + closeBracket;
        }

        i = j + 1;
      }

      return result;
    });

    return fixedLines.join('\n');
  }

  async function renderMermaidDiagrams(container) {
    if (typeof window.mermaid === 'undefined') {
      console.warn('Mermaid library not loaded');
      return;
    }

    const diagrams = container.querySelectorAll('.mermaid-diagram:not(.mermaid-rendered):not(.mermaid-error)');

    for (const diagram of diagrams) {
      let code = diagram.getAttribute('data-mermaid');
      if (!code) continue;

      try {
        // Fix common mermaid syntax issues with nested brackets
        code = fixMermaidSyntax(code);
        // Generate a valid CSS ID (no dots, starts with letter)
        const uniqueId = `mermaid-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        const { svg } = await window.mermaid.render(uniqueId, code);
        diagram.innerHTML = svg;
        diagram.classList.add('mermaid-rendered');
      } catch (err) {
        console.error('Mermaid render error:', err);
        diagram.innerHTML = `<pre><code>${escapeHtml(code)}</code></pre>`;
        diagram.classList.add('mermaid-error');
      }
    }
  }

  function renderMarkdown(text) {
    if (typeof marked === 'undefined') {
      return text;
    }
    try {
      // First render LaTeX formulas
      const textWithLatex = renderLatex(text);

      return marked.parse(textWithLatex, {
        breaks: true,
        gfm: true
      });
    } catch (err) {
      console.error('Markdown parse error:', err);
      return text;
    }
  }

  function renderToolCall(toolData) {
    if (!toolData || !toolData.name) {
      return '';
    }
    const name = String(toolData.name || '');
    const args = toolData.arguments ? JSON.stringify(toolData.arguments, null, 2) : '';
    return `<div class="tool-call">
      <div class="tool-call-name">🔧 ${name}</div>
      ${args ? `<div class="tool-call-args">${args}</div>` : ''}
    </div>`;
  }

  async function renderMessages() {
    if (!messagesElement) {
      return;
    }
    state.stream.previewNode = null;
    state.stream.previewBody = null;
    messagesElement.innerHTML = '';
    const fragment = document.createDocumentFragment();
    for (const message of state.messages) {
      const node = document.createElement('div');
      node.className = `chat-message ${normalizeRole(message.role)}`;

      let content = String(message.text || '');

      // Render tool calls if present
      if (message.role === 'tool' && message.toolCall) {
        content = renderToolCall(message.toolCall) + (content ? `<div>${await renderMarkdownWithMermaid(content)}</div>` : '');
        node.innerHTML = content;
      } else {
        // Render markdown with mermaid for all other messages
        node.innerHTML = await renderMarkdownWithMermaid(content);
      }

      fragment.appendChild(node);
    }
    messagesElement.appendChild(fragment);

    // Render mermaid diagrams after all messages are added
    await renderMermaidDiagrams(messagesElement);

    scrollMessagesToBottom();
  }

  async function applyChatState(payload) {
    const nextInputEnabled = payload?.inputEnabled !== false;
    state.inputEnabled = nextInputEnabled;
    state.messages = Array.isArray(payload?.messages) ? payload.messages : [];

    if (chatComposerElement) {
      chatComposerElement.style.display = nextInputEnabled ? 'flex' : 'none';
    }
    if (chatInputElement) {
      chatInputElement.disabled = !nextInputEnabled;
    }
    if (chatSendElement) {
      chatSendElement.disabled = !nextInputEnabled;
    }
    await renderMessages();
    flushStreamingPreviewDelta();
    renderStreamingPreview();
  }

  function submitInput() {
    if (!state.inputEnabled) {
      return;
    }
    const text = String(chatInputElement?.value || '').trim();
    if (!text) {
      return;
    }
    bridge?.sendChatInput?.({
      role: 'user',
      text,
      timestamp: Date.now(),
      source: 'chat-panel-window'
    });
    if (chatInputElement) {
      chatInputElement.value = '';
      chatInputElement.focus();
    }
  }

  bridge?.onChatStateSync?.((payload) => {
    applyChatState(payload).catch(err => {
      console.error('Error applying chat state:', err);
    });
  });
  bridge?.onChatStreamSync?.((payload) => {
    handleChatStreamSync(payload);
  });

  chatSendElement?.addEventListener('click', submitInput);
  chatInputElement?.addEventListener('compositionstart', () => {
    chatInputComposing = true;
  });
  chatInputElement?.addEventListener('compositionend', () => {
    chatInputComposing = false;
  });
  chatInputElement?.addEventListener('blur', () => {
    chatInputComposing = false;
  });
  chatInputElement?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') {
      return;
    }
    if (event.isComposing || Number(event.keyCode) === 229 || chatInputComposing) {
      return;
    }
    event.preventDefault();
    submitInput();
  });

  chatHideElement?.addEventListener('click', () => {
    bridge?.sendWindowControl?.({ action: 'hide_chat' });
  });
  openWebUiElement?.addEventListener('click', () => {
    bridge?.sendWindowControl?.({ action: 'open_webui' });
  });
})();
