(function chatWindowMain() {
  const bridge = window.desktopLive2dBridge;
  const chatPanelElement = document.getElementById('chat-panel');
  const messagesElement = document.getElementById('chat-panel-messages');
  const chatInputElement = document.getElementById('chat-input');
  const chatSendElement = document.getElementById('chat-send');
  const chatImagePickElement = document.getElementById('chat-image-pick');
  const chatImageInputElement = document.getElementById('chat-image-input');
  const chatUploadPreviewElement = document.getElementById('chat-upload-preview');
  const chatComposerElement = document.getElementById('chat-panel-composer');
  const chatHideElement = document.getElementById('chat-hide');
  const openWebUiElement = document.getElementById('open-webui');
  const newChatElement = document.getElementById('new-chat');
  const presenceLabelElement = document.getElementById('presence-label');
  const transferSelectElement = document.getElementById('transfer-select');
  const transferButtonElement = document.getElementById('transfer-button');
  const transferStatusElement = document.getElementById('transfer-status');
  const modelPickerToggleElement = document.getElementById('model-picker-toggle');
  const modelPickerElement = document.getElementById('model-picker');
  const modelPickerCloseElement = document.getElementById('model-picker-close');
  const modelActiveElement = document.getElementById('model-active');
  const modelProviderElement = document.getElementById('model-provider');
  const modelSaveElement = document.getElementById('model-save');
  const modelDiscoverElement = document.getElementById('model-discover');
  const modelStatusElement = document.getElementById('model-picker-status');
  const modelDiscoveryResultsElement = document.getElementById('model-discovery-results');
  const MAX_UPLOAD_IMAGES = 4;
  const MAX_UPLOAD_IMAGE_BYTES = 8 * 1024 * 1024;
  const MAX_COMPOSER_HEIGHT = 142;
  const COMPACT_CHAT_WIDTH = 520;

  const state = {
    inputEnabled: true,
    messages: [],
    compact: false,
    pendingUploads: [],
    models: null,
    modelsLoading: false,
    followOutput: true,
    shell: { connected: false, phones: [], send: { canSend: false, reason: '网关未连接' } },
    selectedTransferTarget: '',
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

  function setModelStatus(message, error = false) {
    if (!modelStatusElement) return;
    modelStatusElement.textContent = String(message || '');
    modelStatusElement.classList.toggle('error', error);
  }

  function setModelControlsDisabled(disabled) {
    for (const element of [modelActiveElement]) {
      if (element) element.disabled = Boolean(disabled);
    }
  }

  function modelLabel(model) {
    const name = String(model?.name || model?.id || model?.ref || '未命名模型');
    const provider = String(model?.provider || '').trim();
    return `${name}${provider ? ` · ${provider}` : ''}${model?.has_api_key === false ? ' · 缺少密钥' : ''}`;
  }

  function renderModelConfig() {
    const snapshot = state.models;
    if (!modelActiveElement) return;
    modelActiveElement.replaceChildren();
    const enabledRefs = new Set(Array.isArray(snapshot?.enabled) ? snapshot.enabled : []);
    const enabledModels = Array.isArray(snapshot?.models)
      ? snapshot.models.filter((model) => model?.enabled === true || enabledRefs.has(model?.ref) || model?.ref === snapshot.active)
      : [];
    if (!snapshot || enabledModels.length === 0) {
      modelActiveElement.append(new Option('没有可用模型', ''));
      modelActiveElement.title = '没有已启用的模型';
      setModelControlsDisabled(true);
      return;
    }
    for (const model of enabledModels) {
      const option = new Option(modelLabel(model), model.ref);
      option.selected = model.ref === snapshot.active;
      modelActiveElement.append(option);
    }
    const active = snapshot.models.find((model) => model.ref === snapshot.active);
    modelActiveElement.title = active ? `当前模型：${modelLabel(active)}` : '选择对话模型';
    setModelControlsDisabled(false);
  }

  async function loadModelConfig({ quiet = false } = {}) {
    if (state.modelsLoading || typeof bridge?.modelConfigRequest !== 'function') return;
    state.modelsLoading = true;
    setModelControlsDisabled(true);
    if (modelActiveElement) modelActiveElement.title = '正在读取模型…';
    if (!quiet) setModelStatus('正在从本机网关加载模型…');
    try {
      state.models = await bridge.modelConfigRequest({ method: 'GET', path: '/api/config/models' });
      renderModelConfig();
      if (!quiet) setModelStatus(`已加载 ${state.models.models?.length || 0} 个模型`);
    } catch (err) {
      state.models = null;
      renderModelConfig();
      if (modelActiveElement) modelActiveElement.title = `加载失败：${err?.message || err}`;
      setModelStatus(`加载失败：${err?.message || err}`, true);
    } finally {
      state.modelsLoading = false;
    }
  }

  async function saveActiveModel() {
    const ref = String(modelActiveElement?.value || '');
    if (!ref || !state.models) return;
    setModelControlsDisabled(true);
    setModelStatus('正在保存模型选择…');
    try {
      state.models = await bridge.modelConfigRequest({
        method: 'PUT',
        path: '/api/config/models/selection',
        body: { active_model: ref }
      });
      renderModelConfig();
      setModelStatus('模型选择已保存，下一次对话开始生效');
    } catch (err) {
      setModelStatus(`保存失败：${err?.message || err}`, true);
      setModelControlsDisabled(false);
    }
  }

  async function discoverProviderModels() {
    const provider = String(modelProviderElement?.value || '');
    if (!provider) return;
    setModelControlsDisabled(true);
    modelDiscoveryResultsElement?.replaceChildren();
    setModelStatus('正在从 Provider 拉取模型列表…');
    try {
      const result = await bridge.modelConfigRequest({
        method: 'POST',
        path: '/api/config/models/discover',
        body: { provider }
      });
      if (!result?.ok) throw new Error(result?.error || `Provider 返回 ${result?.status || '错误'}`);
      const models = Array.isArray(result.models) ? result.models : [];
      for (const model of models.slice(0, 24)) {
        const chip = document.createElement('span');
        chip.className = 'model-result-chip';
        chip.textContent = model.name && model.name !== model.id ? `${model.name} · ${model.id}` : model.id;
        chip.title = model.id;
        modelDiscoveryResultsElement?.append(chip);
      }
      setModelStatus(models.length ? `Provider 返回 ${models.length} 个模型${models.length > 24 ? '，下方显示前 24 个' : ''}` : 'Provider 没有返回模型');
    } catch (err) {
      setModelStatus(`拉取失败：${err?.message || err}`, true);
    } finally {
      setModelControlsDisabled(false);
    }
  }

  function setModelPickerOpen(open) {
    if (!modelPickerElement) return;
    modelPickerElement.hidden = !open;
    modelPickerToggleElement?.setAttribute('aria-expanded', String(open));
    if (open && !state.models && !state.modelsLoading) void loadModelConfig();
  }

  function normalizeRole(role) {
    const normalized = String(role || '').trim();
    return allowedRoles.has(normalized) ? normalized : 'assistant';
  }

  function normalizeMessageImages(rawImages) {
    if (!Array.isArray(rawImages)) {
      return [];
    }
    const normalized = [];
    for (const image of rawImages) {
      if (!image || typeof image !== 'object' || Array.isArray(image)) {
        continue;
      }
      const name = String(image.name || 'image').trim() || 'image';
      const mimeType = String(image.mimeType || image.mime_type || '').trim() || 'image/*';
      const sizeBytes = Math.max(0, Number(image.sizeBytes ?? image.size_bytes) || 0);
      const url = String(image.url || '').trim();
      const dataUrl = String(image.dataUrl || image.data_url || '').trim();
      const previewUrl = String(image.previewUrl || image.preview_url || url || dataUrl).trim();
      normalized.push({
        name,
        mimeType,
        sizeBytes,
        url,
        previewUrl,
        dataUrl
      });
      if (normalized.length >= 8) {
        break;
      }
    }
    return normalized;
  }

  function normalizeMessage(rawMessage) {
    if (!rawMessage || typeof rawMessage !== 'object' || Array.isArray(rawMessage)) {
      return {
        role: 'assistant',
        text: '',
        timestamp: Date.now(),
        images: []
      };
    }
    return {
      ...rawMessage,
      role: normalizeRole(rawMessage.role),
      text: String(rawMessage.text || ''),
      timestamp: Number.isFinite(Number(rawMessage.timestamp)) ? Number(rawMessage.timestamp) : Date.now(),
      images: normalizeMessageImages(rawMessage.images)
    };
  }

  function imagePreviewSource(image) {
    return String(image?.previewUrl || image?.dataUrl || image?.url || '').trim();
  }

  function applyCompactLayout(width) {
    const nextCompact = Number(width) > 0 && Number(width) < COMPACT_CHAT_WIDTH;
    state.compact = nextCompact;
    if (chatPanelElement) {
      chatPanelElement.classList.toggle('compact', nextCompact);
    }
    return nextCompact;
  }

  function syncCompactLayout() {
    const nextWidth = Number(chatPanelElement?.clientWidth) || Number(window.innerWidth) || 0;
    return applyCompactLayout(nextWidth);
  }

  function scrollMessagesToBottom() {
    if (!messagesElement || !state.followOutput) {
      return;
    }
    messagesElement.scrollTop = messagesElement.scrollHeight;
  }

  function randomId(prefix = 'id') {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function formatBytes(value) {
    const bytes = Math.max(0, Number(value) || 0);
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error(`read file failed: ${file?.name || 'unknown'}`));
      reader.readAsDataURL(file);
    });
  }

  function updateComposerState() {
    const hasText = String(chatInputElement?.value || '').trim().length > 0;
    const hasUploads = state.pendingUploads.length > 0;
    const canSubmit = state.inputEnabled && (hasText || hasUploads);

    if (chatComposerElement) {
      chatComposerElement.style.display = state.inputEnabled ? 'flex' : 'none';
    }
    if (chatInputElement) {
      chatInputElement.disabled = !state.inputEnabled;
    }
    if (chatImagePickElement) {
      chatImagePickElement.disabled = !state.inputEnabled;
    }
    if (chatSendElement) {
      chatSendElement.disabled = !canSubmit;
    }
  }

  function resizeComposerInput() {
    if (!chatInputElement) return;
    chatInputElement.style.height = 'auto';
    const nextHeight = Math.min(MAX_COMPOSER_HEIGHT, chatInputElement.scrollHeight);
    chatInputElement.style.height = `${nextHeight}px`;
    chatInputElement.style.overflowY = chatInputElement.scrollHeight > MAX_COMPOSER_HEIGHT ? 'auto' : 'hidden';
  }

  function formatMessageTime(timestamp) {
    const date = new Date(Number(timestamp));
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(date);
  }

  function createMessageFrame(role, timestamp) {
    const normalizedRole = normalizeRole(role);
    const row = document.createElement('div');
    row.className = `chat-message-row ${normalizedRole}`;
    if (normalizedRole === 'assistant') {
      const avatar = document.createElement('span');
      avatar.className = 'chat-message-avatar';
      avatar.textContent = '八';
      avatar.setAttribute('aria-hidden', 'true');
      row.appendChild(avatar);
    }
    const bubble = document.createElement('div');
    bubble.className = `chat-message ${normalizedRole}`;
    row.appendChild(bubble);
    const timeText = formatMessageTime(timestamp);
    let time = null;
    if (timeText) {
      time = document.createElement('time');
      time.className = 'chat-message-time';
      time.dateTime = new Date(Number(timestamp)).toISOString();
      time.textContent = timeText;
      bubble.appendChild(time);
    }
    return { row, bubble, time };
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
    const { row: node, bubble } = createMessageFrame('assistant', Date.now());
    bubble.classList.add('streaming');
    const body = document.createElement('div');
    body.className = 'chat-streaming-body';
    bubble.prepend(body);
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

  function renderUploadPreview() {
    if (!chatUploadPreviewElement) {
      return;
    }
    chatUploadPreviewElement.innerHTML = '';
    for (const upload of state.pendingUploads) {
      const item = document.createElement('div');
      item.className = 'chat-upload-item';
      item.innerHTML = `
        <img class="chat-upload-thumb" src="${escapeHtml(upload.dataUrl)}" alt="${escapeHtml(upload.name)}" />
        <div class="chat-upload-meta">
          <div class="chat-upload-name">${escapeHtml(upload.name)}</div>
          <div class="chat-upload-size">${escapeHtml(upload.mimeType)} · ${escapeHtml(formatBytes(upload.sizeBytes))}</div>
        </div>
        <button class="chat-upload-remove" type="button" data-upload-id="${escapeHtml(upload.id)}" aria-label="移除图片">移除</button>
      `;
      chatUploadPreviewElement.appendChild(item);
    }
  }

  function removePendingUpload(uploadId) {
    state.pendingUploads = state.pendingUploads.filter((upload) => upload.id !== uploadId);
    renderUploadPreview();
    updateComposerState();
  }

  function clearPendingUploads() {
    state.pendingUploads = [];
    if (chatImageInputElement) {
      chatImageInputElement.value = '';
    }
    renderUploadPreview();
    updateComposerState();
  }

  async function onImageFilesSelected(fileList) {
    const files = Array.from(fileList || []);
    if (files.length === 0) {
      return;
    }
    const remaining = Math.max(0, MAX_UPLOAD_IMAGES - state.pendingUploads.length);
    if (remaining <= 0) {
      return;
    }
    for (const file of files.slice(0, remaining)) {
      if (!String(file?.type || '').startsWith('image/')) {
        continue;
      }
      if (Number(file?.size || 0) > MAX_UPLOAD_IMAGE_BYTES) {
        continue;
      }
      try {
        const dataUrl = await readFileAsDataUrl(file);
        state.pendingUploads.push({
          id: randomId('upload'),
          clientId: randomId('imgc'),
          name: String(file.name || 'image'),
          mimeType: String(file.type || 'image/*'),
          sizeBytes: Number(file.size || 0),
          dataUrl
        });
      } catch (err) {
        console.error('Failed to read image file:', err);
      }
    }
    if (chatImageInputElement) {
      chatImageInputElement.value = '';
    }
    renderUploadPreview();
    updateComposerState();
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

  function buildCompactImageItem(image, index) {
    const button = document.createElement('button');
    const previewSrc = imagePreviewSource(image);
    button.type = 'button';
    button.className = 'chat-image-chip';
    button.setAttribute('data-chat-image', '1');
    button.setAttribute('data-preview-src', previewSrc);
    button.setAttribute('data-image-name', String(image.name || `image-${index + 1}`));
    button.setAttribute('data-image-mime', String(image.mimeType || 'image/*'));
    button.setAttribute('data-image-size', String(image.sizeBytes || 0));
    button.textContent = `🖼 ${image.name || `image-${index + 1}`}`;
    if (!previewSrc) {
      button.disabled = true;
    }
    return button;
  }

  function buildLargeImageItem(image, index) {
    const button = document.createElement('button');
    const previewSrc = imagePreviewSource(image);
    button.type = 'button';
    button.className = 'chat-image-card';
    button.setAttribute('data-chat-image', '1');
    button.setAttribute('data-preview-src', previewSrc);
    button.setAttribute('data-image-name', String(image.name || `image-${index + 1}`));
    button.setAttribute('data-image-mime', String(image.mimeType || 'image/*'));
    button.setAttribute('data-image-size', String(image.sizeBytes || 0));

    const thumb = document.createElement(previewSrc ? 'img' : 'div');
    thumb.className = 'chat-image-thumb';
    if (previewSrc) {
      thumb.src = previewSrc;
      thumb.alt = String(image.name || `image-${index + 1}`);
    } else {
      thumb.textContent = '🖼';
    }

    const meta = document.createElement('div');
    meta.className = 'chat-image-meta';
    meta.textContent = `${String(image.name || `image-${index + 1}`)} · ${formatBytes(image.sizeBytes)}`;

    button.appendChild(thumb);
    button.appendChild(meta);
    if (!previewSrc) {
      button.disabled = true;
    }
    return button;
  }

  function buildMessageImages(images) {
    const wrapper = document.createElement('div');
    wrapper.className = state.compact ? 'chat-message-images compact' : 'chat-message-images';
    images.forEach((image, index) => {
      const item = state.compact
        ? buildCompactImageItem(image, index)
        : buildLargeImageItem(image, index);
      wrapper.appendChild(item);
    });
    return wrapper;
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
      const { row, bubble: node, time } = createMessageFrame(message.role, message.timestamp);

      let content = String(message.text || '');

      // Render tool calls if present
      if (message.role === 'tool' && message.toolCall) {
        content = renderToolCall(message.toolCall) + (content ? `<div>${await renderMarkdownWithMermaid(content)}</div>` : '');
        node.innerHTML = content;
      } else {
        // Render markdown with mermaid for all other messages
        node.innerHTML = await renderMarkdownWithMermaid(content);
      }

      if (Array.isArray(message.images) && message.images.length > 0) {
        node.appendChild(buildMessageImages(message.images));
      }
      if (time) node.appendChild(time);

      fragment.appendChild(row);
    }
    messagesElement.appendChild(fragment);

    // Render mermaid diagrams after all messages are added
    await renderMermaidDiagrams(messagesElement);

    scrollMessagesToBottom();
  }

  function renderShellState(next) {
    if (next && typeof next === 'object') state.shell = next;
    if (presenceLabelElement) {
      presenceLabelElement.textContent = String(state.shell.statusLabel || '在电脑上').replace(/^八千代/, '').trim();
    }
    const view = window.DesktopChatState?.resolveTransferView?.(state.shell, state.selectedTransferTarget) || {
      disabled: true, label: '送到手机', reason: '状态同步中', phones: []
    };
    if (transferButtonElement) {
      transferButtonElement.disabled = view.disabled;
      transferButtonElement.textContent = view.requiresSelection ? '送出' : view.label;
      transferButtonElement.title = view.reason || view.label;
      transferButtonElement.dataset.target = view.target || '';
      transferButtonElement.setAttribute('aria-busy', String(Boolean(view.pending)));
    }
    if (transferStatusElement) transferStatusElement.textContent = view.reason || '';
    if (transferSelectElement) {
      transferSelectElement.hidden = !view.requiresSelection;
      transferSelectElement.disabled = Boolean(view.pending);
      transferSelectElement.title = view.requiresSelection ? (view.reason || '选择要接收八千代的手机') : '';
      if (view.requiresSelection) {
        const stillOnline = view.phones.some((phone) => phone.device_id === state.selectedTransferTarget);
        if (!stillOnline) state.selectedTransferTarget = '';
        transferSelectElement.replaceChildren(
          new Option('选择手机…', ''),
          ...view.phones.map((phone) => new Option(phone.name, phone.device_id))
        );
        transferSelectElement.value = state.selectedTransferTarget;
      }
    }
  }

  async function transferAvatar() {
    const target = String(transferButtonElement?.dataset.target || '');
    if (!target || transferButtonElement?.disabled) return;
    transferButtonElement.disabled = true;
    transferButtonElement.textContent = '送出中…';
    if (transferStatusElement) transferStatusElement.textContent = '正在请求迁移…';
    try {
      const next = await bridge?.requestAvatarTransfer?.({ to: target });
      if (next) renderShellState(next);
    } catch (err) {
      renderShellState(state.shell);
      if (transferStatusElement) transferStatusElement.textContent = `迁移失败：${err?.message || err}`;
    }
  }

  async function applyChatState(payload) {
    const nextInputEnabled = payload?.inputEnabled !== false;
    state.inputEnabled = nextInputEnabled;
    state.messages = Array.isArray(payload?.messages)
      ? payload.messages.map((message) => normalizeMessage(message))
      : [];
    updateComposerState();
    await renderMessages();
    flushStreamingPreviewDelta();
    renderStreamingPreview();
  }

  function submitInput() {
    if (!state.inputEnabled) {
      return;
    }
    const text = String(chatInputElement?.value || '').trim();
    const uploads = [...state.pendingUploads];
    if (!text && uploads.length === 0) {
      return;
    }
    bridge?.sendChatInput?.({
      role: 'user',
      text,
      input_images: uploads.map((upload) => ({
        client_id: upload.clientId,
        name: upload.name,
        mime_type: upload.mimeType,
        size_bytes: upload.sizeBytes,
        data_url: upload.dataUrl
      })),
      timestamp: Date.now(),
      source: 'chat-panel-window'
    });
    if (chatInputElement) {
      chatInputElement.value = '';
      chatInputElement.focus();
      resizeComposerInput();
    }
    clearPendingUploads();
    updateComposerState();
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
  chatImagePickElement?.addEventListener('click', () => {
    if (!state.inputEnabled) {
      return;
    }
    chatImageInputElement?.click();
  });
  chatImageInputElement?.addEventListener('change', () => {
    void onImageFilesSelected(chatImageInputElement?.files);
  });
  chatUploadPreviewElement?.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const button = target.closest('[data-upload-id]');
    if (!button) {
      return;
    }
    const uploadId = String(button.getAttribute('data-upload-id') || '');
    if (!uploadId) {
      return;
    }
    removePendingUpload(uploadId);
  });
  messagesElement?.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const trigger = target.closest('[data-chat-image="1"]');
    if (!trigger) {
      return;
    }
    const imageUrl = String(trigger.getAttribute('data-preview-src') || '').trim();
    if (!imageUrl) {
      return;
    }
    bridge?.sendChatImagePreviewOpen?.({
      url: imageUrl,
      name: String(trigger.getAttribute('data-image-name') || 'image'),
      mime_type: String(trigger.getAttribute('data-image-mime') || 'image/*'),
      size_bytes: Number(trigger.getAttribute('data-image-size') || 0)
    });
  });
  chatInputElement?.addEventListener('input', () => {
    resizeComposerInput();
    updateComposerState();
  });
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
    if (event.shiftKey) return;
    event.preventDefault();
    submitInput();
  });
  chatInputElement?.addEventListener('paste', (event) => {
    const clipboardItems = Array.from(event.clipboardData?.items || []);
    const imageFiles = clipboardItems
      .filter((item) => item.kind === 'file' && String(item.type || '').startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter(Boolean);
    if (imageFiles.length === 0) {
      return;
    }
    event.preventDefault();
    void onImageFilesSelected(imageFiles);
  });

  chatHideElement?.addEventListener('click', () => {
    bridge?.sendWindowControl?.({ action: 'hide_chat' });
  });
  openWebUiElement?.addEventListener('click', () => {
    bridge?.sendWindowControl?.({ action: 'open_webui' });
  });
  newChatElement?.addEventListener('click', () => {
    bridge?.sendChatInput?.({ role: 'user', text: '/new', input_images: [] });
  });
  modelActiveElement?.addEventListener('change', () => { void saveActiveModel(); });
  transferSelectElement?.addEventListener('change', () => {
    state.selectedTransferTarget = transferSelectElement.value;
    renderShellState(state.shell);
  });
  transferButtonElement?.addEventListener('click', () => { void transferAvatar(); });
  messagesElement?.addEventListener('scroll', () => {
    state.followOutput = window.DesktopChatState?.shouldFollowOutput?.({
      scrollTop: messagesElement.scrollTop,
      scrollHeight: messagesElement.scrollHeight,
      clientHeight: messagesElement.clientHeight
    }) !== false;
  }, { passive: true });
  bridge?.onShellStateSync?.((next) => renderShellState(next));
  modelPickerToggleElement?.addEventListener('click', () => setModelPickerOpen(modelPickerElement?.hidden !== false));
  modelPickerCloseElement?.addEventListener('click', () => setModelPickerOpen(false));
  modelSaveElement?.addEventListener('click', () => { void saveActiveModel(); });
  modelDiscoverElement?.addEventListener('click', () => { void discoverProviderModels(); });
  syncCompactLayout();
  if (typeof ResizeObserver === 'function' && chatPanelElement) {
    const observer = new ResizeObserver(() => {
      const previous = state.compact;
      const next = syncCompactLayout();
      if (previous !== next) {
        void renderMessages();
      }
    });
    observer.observe(chatPanelElement);
  } else {
    window.addEventListener('resize', () => {
      const previous = state.compact;
      const next = syncCompactLayout();
      if (previous !== next) {
        void renderMessages();
      }
    });
  }
  updateComposerState();
  resizeComposerInput();
  renderUploadPreview();
  renderShellState(state.shell);
  Promise.resolve(bridge?.getShellState?.()).then((next) => renderShellState(next)).catch((err) => {
    if (transferStatusElement) transferStatusElement.textContent = `状态读取失败：${err?.message || err}`;
  });
  void loadModelConfig({ quiet: true });
})();
