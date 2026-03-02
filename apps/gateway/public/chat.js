const STORAGE_KEY = 'yachiyo_sessions_v1';
const THEME_STORAGE_KEY = 'yachiyo_theme_v1';
const SESSION_PERMISSION_LEVELS = ['low', 'medium', 'high'];
const DEFAULT_SESSION_PERMISSION_LEVEL = 'medium';
const THEME_PREFERENCES = ['auto', 'light', 'dark'];
const DEFAULT_THEME_PREFERENCE = 'auto';
const SERVER_SYNC_INTERVAL_MS = 2000;
const MAX_UPLOAD_IMAGES = 4;
const MAX_UPLOAD_IMAGE_BYTES = 8 * 1024 * 1024;
const LIGHTBOX_ANIMATION_MS = 220;
const DEBUG_PREFS_KEY = 'yachiyo_debug_panel_v1';
const DEBUG_MAX_LINES = 500;

const elements = {
  sidebar: document.getElementById('sidebar'),
  menuBtn: document.getElementById('menuBtn'),
  newSessionBtn: document.getElementById('newSessionBtn'),
  sessionList: document.getElementById('sessionList'),
  activeSessionName: document.getElementById('activeSessionName'),
  runtimeStatus: document.getElementById('runtimeStatus'),
  sessionPermissionSelect: document.getElementById('sessionPermissionSelect'),
  themeSelect: document.getElementById('themeSelect'),
  debugPanel: document.getElementById('debugPanel'),
  debugPanelToggleBtn: document.getElementById('debugPanelToggleBtn'),
  debugStreamStatus: document.getElementById('debugStreamStatus'),
  debugConnectBtn: document.getElementById('debugConnectBtn'),
  debugDisconnectBtn: document.getElementById('debugDisconnectBtn'),
  debugModeBtn: document.getElementById('debugModeBtn'),
  debugClearBtn: document.getElementById('debugClearBtn'),
  debugTopicsInput: document.getElementById('debugTopicsInput'),
  debugTokenInput: document.getElementById('debugTokenInput'),
  debugStreamList: document.getElementById('debugStreamList'),
  messageList: document.getElementById('messageList'),
  chatInput: document.getElementById('chatInput'),
  sendBtn: document.getElementById('sendBtn'),
  personaCustomName: document.getElementById('personaCustomName'),
  savePersonaBtn: document.getElementById('savePersonaBtn'),
  personaHint: document.getElementById('personaHint'),
  addImageBtn: document.getElementById('addImageBtn'),
  imageInput: document.getElementById('imageInput'),
  uploadPreviewList: document.getElementById('uploadPreviewList'),
  imageLightbox: document.getElementById('imageLightbox'),
  lightboxImage: document.getElementById('lightboxImage'),
  lightboxCloseBtn: document.getElementById('lightboxCloseBtn')
};

const state = {
  sessions: [],
  activeSessionId: null,
  pending: null,
  pendingUploads: [],
  messageImageCache: new Map(),
  lightboxCloseTimer: null,
  ws: null,
  wsReady: false,
  debugSource: null,
  debugConnected: false,
  debugPanelOpen: true,
  debugModeEnabled: false,
  isComposing: false,
  themePreference: DEFAULT_THEME_PREFERENCE,
  serverSyncTimer: null,
  serverSyncInitialized: false,
  followServerSessionId: null
};

function updateComposerState() {
  const hasText = elements.chatInput.value.trim().length > 0;
  const hasUploads = state.pendingUploads.length > 0;
  const disabled = state.pending !== null || (!hasText && !hasUploads);
  elements.sendBtn.disabled = disabled;
  elements.addImageBtn.disabled = state.pending !== null;
}

function nowIso() {
  return new Date().toISOString();
}

function loadDebugPrefs() {
  const raw = localStorage.getItem(DEBUG_PREFS_KEY);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed.panelOpen === 'boolean') {
      state.debugPanelOpen = parsed.panelOpen;
    }
    if (typeof parsed.topics === 'string') {
      elements.debugTopicsInput.value = parsed.topics;
    }
  } catch {
    // ignore malformed local cache
  }
}

function persistDebugPrefs() {
  const payload = {
    panelOpen: state.debugPanelOpen,
    topics: String(elements.debugTopicsInput.value || '').trim()
  };
  localStorage.setItem(DEBUG_PREFS_KEY, JSON.stringify(payload));
}

function normalizeDebugTopics(value) {
  const topics = String(value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return Array.from(new Set(topics)).join(',');
}

function formatTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function randomId(prefix = 'sess') {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36)}`;
}

function createSession() {
  const id = randomId('chat');
  const createdAt = nowIso();
  return {
    id,
    name: 'New chat',
    createdAt,
    updatedAt: createdAt,
    permissionLevel: DEFAULT_SESSION_PERMISSION_LEVEL,
    messages: []
  };
}

function sessionFromServerSummary(summary) {
  return {
    id: summary.session_id,
    name: summary.title || 'New chat',
    createdAt: typeof summary.created_at === 'string' ? summary.created_at : nowIso(),
    updatedAt: typeof summary.updated_at === 'string' ? summary.updated_at : nowIso(),
    permissionLevel: normalizePermissionLevel(summary.permission_level),
    messages: []
  };
}

function messageFromServer(raw) {
  return {
    id: raw.id || randomId('msg'),
    role: raw.role || 'assistant',
    content: String(raw.content || ''),
    createdAt: typeof raw.created_at === 'string' ? raw.created_at : nowIso()
  };
}

function normalizePermissionLevel(value) {
  if (typeof value === 'string' && SESSION_PERMISSION_LEVELS.includes(value)) {
    return value;
  }
  return DEFAULT_SESSION_PERMISSION_LEVEL;
}

function normalizeThemePreference(value) {
  if (typeof value === 'string' && THEME_PREFERENCES.includes(value)) {
    return value;
  }
  return DEFAULT_THEME_PREFERENCE;
}

function resolveTheme(preference) {
  if (preference === 'auto') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return preference;
}

function applyTheme(preference) {
  const normalizedPreference = normalizeThemePreference(preference);
  const theme = resolveTheme(normalizedPreference);
  document.documentElement.setAttribute('data-theme', theme);
  state.themePreference = normalizedPreference;
  elements.themeSelect.value = normalizedPreference;
}

function loadThemePreference() {
  const raw = localStorage.getItem(THEME_STORAGE_KEY);
  applyTheme(raw);
}

function persistThemePreference(preference) {
  localStorage.setItem(THEME_STORAGE_KEY, normalizeThemePreference(preference));
}

function normalizeSessionShape(raw) {
  if (!raw || typeof raw !== 'object') return createSession();
  const normalizedMessages = Array.isArray(raw.messages)
    ? raw.messages.map((msg) => ({
      id: msg?.id || randomId('msg'),
      role: msg?.role === 'assistant' ? 'assistant' : 'user',
      content: String(msg?.content || ''),
      createdAt: typeof msg?.createdAt === 'string' ? msg.createdAt : nowIso(),
      images: Array.isArray(msg?.images)
        ? msg.images
          .filter((image) => image && typeof image === 'object')
          .map((image) => ({
            name: typeof image.name === 'string' ? image.name : 'image',
            mimeType: typeof image.mimeType === 'string' ? image.mimeType : 'image/*',
            sizeBytes: Number(image.sizeBytes) || 0,
            previewUrl: typeof image.previewUrl === 'string' ? image.previewUrl : '',
            clientId: typeof image.clientId === 'string' ? image.clientId : ''
          }))
        : []
    }))
    : [];
  return {
    id: raw.id || randomId('chat'),
    name: typeof raw.name === 'string' ? raw.name : 'New chat',
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : nowIso(),
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : nowIso(),
    permissionLevel: normalizePermissionLevel(raw.permissionLevel),
    messages: normalizedMessages
  };
}

function loadSessions() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    const initial = createSession();
    state.sessions = [initial];
    state.activeSessionId = initial.id;
    persist();
    return;
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('invalid');
    state.sessions = parsed.map((session) => normalizeSessionShape(session));
    state.activeSessionId = state.sessions[0].id;
    persist();
  } catch {
    const initial = createSession();
    state.sessions = [initial];
    state.activeSessionId = initial.id;
    persist();
  }
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.sessions));
}

function getActiveSession() {
  return state.sessions.find((s) => s.id === state.activeSessionId) || null;
}

function getSessionById(sessionId) {
  return state.sessions.find((s) => s.id === sessionId) || null;
}

function sortSessions() {
  state.sessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

function setStatus(text) {
  const statusText = String(text || '');
  elements.runtimeStatus.textContent = statusText;
  elements.runtimeStatus.classList.toggle('running', /^Running\b/.test(statusText));
}

function ensureSessionTitle(session) {
  if (!session || session.name !== 'New chat') return;
  const firstUser = session.messages.find((m) => m.role === 'user');
  if (!firstUser) return;
  if (Array.isArray(firstUser.images) && firstUser.images.length > 0 && !firstUser.content.trim()) {
    session.name = `Image chat (${firstUser.images.length})`;
    return;
  }
  const title = firstUser.content.trim().slice(0, 26);
  if (title === '[Image]' && Array.isArray(firstUser.images) && firstUser.images.length > 0) {
    session.name = `Image chat (${firstUser.images.length})`;
    return;
  }
  session.name = title || 'New chat';
}

function renderSessions() {
  sortSessions();
  elements.sessionList.innerHTML = '';

  state.sessions.forEach((session) => {
    const btn = document.createElement('button');
    btn.className = `session-item ${session.id === state.activeSessionId ? 'active' : ''}`;
    btn.innerHTML = `
      <div class="session-item-name">${escapeHtml(session.name)}</div>
      <div class="session-item-time">${formatTime(session.updatedAt)}</div>
    `;
    btn.onclick = () => {
      state.activeSessionId = session.id;
      state.followServerSessionId = null;
      clearPendingUploads();
      render();
      if (window.matchMedia('(max-width: 920px)').matches) {
        elements.sidebar.classList.remove('open');
      }
    };
    elements.sessionList.appendChild(btn);
  });
}

function addMessage(session, role, content, options = {}) {
  const message = {
    id: randomId('msg'),
    role,
    content: String(content || ''),
    createdAt: nowIso(),
    images: Array.isArray(options.images)
      ? options.images.map((image) => ({
        name: typeof image.name === 'string' ? image.name : 'image',
        mimeType: typeof image.mimeType === 'string' ? image.mimeType : 'image/*',
        sizeBytes: Number(image.sizeBytes) || 0,
        previewUrl: typeof image.previewUrl === 'string' ? image.previewUrl : '',
        clientId: typeof image.clientId === 'string' ? image.clientId : ''
      }))
      : []
  };
  session.messages.push(message);
  session.updatedAt = message.createdAt;
  ensureSessionTitle(session);
  persist();
  return message;
}

function updateMessage(session, messageId, patch) {
  const msg = session.messages.find((m) => m.id === messageId);
  if (!msg) return;
  Object.assign(msg, patch);
  session.updatedAt = nowIso();
  persist();
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
    return escapeHtml(text);
  }

  try {
    // First render LaTeX formulas before markdown
    let processedText = text;
    if (typeof katex !== 'undefined') {
      // Replace display math: $$...$$
      processedText = processedText.replace(/\$\$([\s\S]+?)\$\$/g, (match, formula) => {
        try {
          const rendered = katex.renderToString(formula.trim(), {
            displayMode: true,
            throwOnError: false
          });
          // Wrap in a special marker to prevent markdown processing
          return `<div class="katex-display-wrapper">${rendered}</div>`;
        } catch (err) {
          console.error('KaTeX display math error:', err);
          return match;
        }
      });

      // Replace inline math: $...$
      processedText = processedText.replace(/\$([^\$\n]+?)\$/g, (match, formula) => {
        try {
          const rendered = katex.renderToString(formula.trim(), {
            displayMode: false,
            throwOnError: false
          });
          return `<span class="katex-inline-wrapper">${rendered}</span>`;
        } catch (err) {
          console.error('KaTeX inline math error:', err);
          return match;
        }
      });
    }

    // Configure marked renderer to handle mermaid code blocks
    const renderer = new marked.Renderer();
    const originalCodeRenderer = renderer.code.bind(renderer);

    renderer.code = function(code, language) {
      if (language === 'mermaid') {
        console.log('Detected mermaid code block, language:', language);
        // Return mermaid diagram placeholder without pre/code wrapper
        return `<div class="mermaid-diagram" data-mermaid="${escapeHtml(code)}">${escapeHtml(code)}</div>`;
      }
      // Use default renderer for other code blocks
      return originalCodeRenderer(code, language);
    };

    const html = marked.parse(processedText, {
      breaks: true,
      gfm: true,
      renderer: renderer
    });

    return html;
  } catch (err) {
    console.error('Markdown parse error:', err);
    return escapeHtml(text);
  }
}

function fixMermaidSyntax(code) {
  // Fix nested brackets in node labels by wrapping them in quotes
  // This handles cases like: A[text with [nested] brackets] --> B{text}

  // Split by lines to process each line
  const lines = code.split('\n');
  const fixedLines = lines.map(line => {
    // Match node definitions with brackets: NodeId[text] or NodeId{text}
    // Look for patterns where the text contains nested brackets
    return line.replace(/(\w+)([\[\{])([^\]\}]*[\[\{][^\]\}]*[\]\}][^\]\}]*)([\]\}])/g,
      (match, nodeId, openBracket, text, closeBracket) => {
        // Check if text is already quoted
        if ((text.startsWith('"') && text.endsWith('"')) ||
            (text.startsWith("'") && text.endsWith("'"))) {
          return match;
        }
        // Wrap text in quotes and escape any existing quotes
        const escapedText = text.replace(/"/g, '&quot;');
        return `${nodeId}${openBracket}"${escapedText}"${closeBracket}`;
      });
  });

  return fixedLines.join('\n');
}

async function renderMermaidDiagrams(container) {
  if (typeof window.mermaid === 'undefined') {
    console.warn('Mermaid library not loaded');
    return;
  }

  const diagrams = container.querySelectorAll('.mermaid-diagram');
  console.log(`Found ${diagrams.length} mermaid diagrams to render`);

  for (const diagram of diagrams) {
    let code = diagram.getAttribute('data-mermaid');
    if (!code) continue;

    try {
      // Fix common mermaid syntax issues with nested brackets
      code = fixMermaidSyntax(code);
      console.log('Rendering mermaid diagram:', code.substring(0, 50) + '...');
      // Generate a valid CSS ID (no dots, starts with letter)
      const uniqueId = `mermaid-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      const { svg } = await window.mermaid.render(uniqueId, code);
      diagram.innerHTML = svg;
      diagram.classList.add('mermaid-rendered');
      console.log('Mermaid diagram rendered successfully');
    } catch (err) {
      console.error('Mermaid render error:', err);
      diagram.innerHTML = `<pre><code>${escapeHtml(code)}</code></pre>`;
      diagram.classList.add('mermaid-error');
    }
  }
}

function formatBytes(size) {
  const n = Number(size) || 0;
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / (1024 * 1024)).toFixed(1)}MB`;
}

function setDebugPanelOpen(open) {
  state.debugPanelOpen = Boolean(open);
  elements.debugPanel.classList.toggle('collapsed', !state.debugPanelOpen);
  elements.debugPanelToggleBtn.textContent = state.debugPanelOpen ? 'Hide Debug' : 'Show Debug';
  persistDebugPrefs();
}

function setDebugStreamStatus(text, kind = '') {
  elements.debugStreamStatus.textContent = String(text || '');
  elements.debugStreamStatus.classList.remove('connected', 'error');
  if (kind) {
    elements.debugStreamStatus.classList.add(kind);
  }
}

function setDebugModeButton() {
  elements.debugModeBtn.textContent = state.debugModeEnabled ? 'Debug ON' : 'Debug OFF';
}

function safeJsonStringify(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function emitClientDebug(topic, msg, extra = {}) {
  const normalizedTopic = String(topic || '').trim();
  if (!normalizedTopic) return;
  const normalizedExtra = extra && typeof extra === 'object' && !Array.isArray(extra) ? extra : {};
  const payload = {
    event: 'log',
    topic: normalizedTopic,
    level: 'info',
    msg: String(msg || normalizedTopic),
    source_file: String(normalizedExtra.source_file || 'apps/gateway/public/chat.js'),
    ...normalizedExtra,
    active_session_id: state.activeSessionId || null
  };
  fetch('/api/debug/emit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    keepalive: true
  }).catch(() => {
    // non-blocking telemetry path
  });
}

function appendDebugLine({ ts, topic, event, payload }) {
  const line = document.createElement('div');
  line.className = 'debug-line';
  const d = Number(ts) ? new Date(Number(ts)) : new Date();
  const timeText = d.toLocaleTimeString('zh-CN', { hour12: false });
  const meta = `[${timeText}] [${String(topic || 'unknown')}] [${String(event || 'log')}]`;
  line.innerHTML = `
    <span class="debug-line-meta">${escapeHtml(meta)}</span>
    <span class="debug-line-topic"> ${escapeHtml(safeJsonStringify(payload))}</span>
  `;
  elements.debugStreamList.appendChild(line);

  while (elements.debugStreamList.childElementCount > DEBUG_MAX_LINES) {
    elements.debugStreamList.removeChild(elements.debugStreamList.firstElementChild);
  }
  elements.debugStreamList.scrollTop = elements.debugStreamList.scrollHeight;
}

function disconnectDebugStream() {
  if (state.debugSource) {
    state.debugSource.close();
    state.debugSource = null;
  }
  state.debugConnected = false;
  setDebugStreamStatus('Disconnected');
}

function buildDebugStreamUrl() {
  const topics = normalizeDebugTopics(elements.debugTopicsInput.value);
  const token = String(elements.debugTokenInput.value || '').trim();
  const params = new URLSearchParams();
  if (topics) params.set('topics', topics);
  if (token) params.set('token', token);
  const query = params.toString();
  return query ? `/api/debug/events?${query}` : '/api/debug/events';
}

function handleDebugSsePayload(raw, eventType = 'log') {
  let parsed = null;
  try {
    parsed = JSON.parse(String(raw || '{}'));
  } catch {
    parsed = { topic: 'unknown', ts: Date.now(), raw: String(raw || '') };
  }

  appendDebugLine({
    ts: parsed.ts || Date.now(),
    topic: parsed.topic || 'unknown',
    event: parsed.event || eventType,
    payload: parsed.payload ?? parsed
  });
}

function connectDebugStream() {
  const streamUrl = buildDebugStreamUrl();
  const normalizedTopics = normalizeDebugTopics(elements.debugTopicsInput.value);
  elements.debugTopicsInput.value = normalizedTopics;
  persistDebugPrefs();
  disconnectDebugStream();
  setDebugStreamStatus('Connecting...');

  const source = new EventSource(streamUrl);
  state.debugSource = source;

  const onAnyEvent = (event, typeHint = 'log') => {
    handleDebugSsePayload(event.data, typeHint);
  };

  source.onopen = () => {
    state.debugConnected = true;
    setDebugStreamStatus('Streaming', 'connected');
    emitClientDebug('chain.webui.debug.connected', 'webui debug stream connected', { stream_url: streamUrl });
  };

  source.onmessage = (event) => onAnyEvent(event, 'message');
  source.addEventListener('log', (event) => onAnyEvent(event, 'log'));
  source.addEventListener('metric', (event) => onAnyEvent(event, 'metric'));
  source.addEventListener('system', (event) => onAnyEvent(event, 'system'));

  source.onerror = () => {
    state.debugConnected = false;
    setDebugStreamStatus('Reconnecting...', 'error');
    emitClientDebug('chain.webui.debug.error', 'webui debug stream reconnecting');
  };
}

async function loadDebugMode() {
  try {
    const res = await fetch('/api/debug/mode');
    const data = await res.json();
    state.debugModeEnabled = Boolean(data?.data?.debug);
    setDebugModeButton();
  } catch {
    state.debugModeEnabled = false;
    setDebugModeButton();
  }
}

async function toggleDebugMode() {
  const next = !state.debugModeEnabled;
  try {
    const res = await fetch('/api/debug/mode', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ debug: next })
    });
    const data = await res.json();
    if (!res.ok || !data?.ok) {
      throw new Error(data?.error || 'toggle debug mode failed');
    }
    state.debugModeEnabled = Boolean(data?.data?.debug);
    setDebugModeButton();
    setDebugStreamStatus(`Debug mode ${state.debugModeEnabled ? 'enabled' : 'disabled'}`);
  } catch (err) {
    setDebugStreamStatus(`Debug mode update failed: ${err.message || err}`, 'error');
  }
}

function extensionFromMimeType(mimeType) {
  const normalized = String(mimeType || '').toLowerCase();
  if (normalized === 'image/jpeg' || normalized === 'image/jpg') return 'jpg';
  if (normalized === 'image/png') return 'png';
  if (normalized === 'image/webp') return 'webp';
  if (normalized === 'image/gif') return 'gif';
  if (normalized === 'image/bmp') return 'bmp';
  if (normalized === 'image/avif') return 'avif';
  return 'img';
}

function buildSessionImageUrl(sessionId, clientId, mimeType) {
  if (!sessionId || !clientId) return '';
  const ext = extensionFromMimeType(mimeType);
  return `/api/session-images/${encodeURIComponent(sessionId)}/${encodeURIComponent(`${clientId}.${ext}`)}`;
}

function cacheMessageImages(messageId, uploads) {
  if (!messageId || !Array.isArray(uploads) || uploads.length === 0) return;
  state.messageImageCache.set(
    messageId,
    uploads.map((upload) => ({
      clientId: upload.clientId,
      name: upload.name,
      mimeType: upload.mimeType,
      sizeBytes: upload.sizeBytes,
      dataUrl: upload.dataUrl
    }))
  );
}

function getCachedImageForMessage(messageId, imageIndex) {
  const list = state.messageImageCache.get(messageId);
  if (!Array.isArray(list)) return null;
  return list[imageIndex] || null;
}

function openImageLightbox(src, altText = 'image') {
  if (!src) return;
  if (state.lightboxCloseTimer) {
    clearTimeout(state.lightboxCloseTimer);
    state.lightboxCloseTimer = null;
  }
  elements.lightboxImage.src = src;
  elements.lightboxImage.alt = altText;
  elements.imageLightbox.classList.add('open');
  elements.imageLightbox.setAttribute('aria-hidden', 'false');
}

function closeImageLightbox() {
  elements.imageLightbox.classList.remove('open');
  elements.imageLightbox.setAttribute('aria-hidden', 'true');
  if (state.lightboxCloseTimer) {
    clearTimeout(state.lightboxCloseTimer);
  }
  state.lightboxCloseTimer = setTimeout(() => {
    if (!elements.imageLightbox.classList.contains('open')) {
      elements.lightboxImage.src = '';
    }
    state.lightboxCloseTimer = null;
  }, LIGHTBOX_ANIMATION_MS);
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error(`Failed to read file: ${file.name}`));
    reader.readAsDataURL(file);
  });
}

function renderUploadPreview() {
  elements.uploadPreviewList.innerHTML = '';
  if (state.pendingUploads.length === 0) return;

  state.pendingUploads.forEach((upload) => {
    const item = document.createElement('div');
    item.className = 'upload-preview-item';
    item.innerHTML = `
      <img class="upload-preview-thumb" src="${escapeHtml(upload.dataUrl)}" alt="${escapeHtml(upload.name)}" />
      <div class="upload-preview-meta">
        <div class="upload-preview-name">${escapeHtml(upload.name)}</div>
        <div class="upload-preview-size">${escapeHtml(upload.mimeType)} · ${formatBytes(upload.sizeBytes)}</div>
      </div>
      <button class="btn upload-remove-btn" data-upload-id="${escapeHtml(upload.id)}" type="button">Remove</button>
    `;
    elements.uploadPreviewList.appendChild(item);
  });
}

function removePendingUpload(uploadId) {
  state.pendingUploads = state.pendingUploads.filter((upload) => upload.id !== uploadId);
  renderUploadPreview();
  updateComposerState();
}

function clearPendingUploads() {
  state.pendingUploads = [];
  elements.imageInput.value = '';
  renderUploadPreview();
  updateComposerState();
}

async function onImageFilesSelected(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;

  const remaining = Math.max(0, MAX_UPLOAD_IMAGES - state.pendingUploads.length);
  if (remaining <= 0) {
    setStatus(`最多上传 ${MAX_UPLOAD_IMAGES} 张图片`);
    return;
  }

  const acceptedFiles = files.slice(0, remaining);
  for (const file of acceptedFiles) {
    if (!file.type.startsWith('image/')) {
      setStatus(`跳过非图片文件: ${file.name}`);
      continue;
    }

    if (file.size > MAX_UPLOAD_IMAGE_BYTES) {
      setStatus(`图片过大（>${formatBytes(MAX_UPLOAD_IMAGE_BYTES)}）: ${file.name}`);
      continue;
    }

    try {
      const dataUrl = await readFileAsDataUrl(file);
      state.pendingUploads.push({
        id: randomId('img'),
        clientId: randomId('imgc'),
        name: file.name,
        mimeType: file.type || 'image/*',
        sizeBytes: file.size,
        dataUrl
      });
    } catch (err) {
      setStatus(err.message || String(err));
    }
  }

  elements.imageInput.value = '';
  renderUploadPreview();
  updateComposerState();
}

async function renderMessages() {
  const session = getActiveSession();

  if (!session || session.messages.length === 0) {
    elements.messageList.innerHTML = '';
    const hint = document.createElement('div');
    hint.className = 'empty-hint';
    hint.textContent = 'Start a new conversation.';
    elements.messageList.appendChild(hint);
    return;
  }

  // 只在消息数量变化时才重建 DOM，避免每次 sync 都清空重建导致气泡跳动
  const renderedCount = elements.messageList.querySelectorAll('.message-wrap').length;
  if (renderedCount === session.messages.length) return;

  // 记录用户是否已经在底部（距底部 60px 内视为在底部）
  const atBottom = elements.messageList.scrollHeight - elements.messageList.scrollTop - elements.messageList.clientHeight < 60;

  elements.messageList.innerHTML = '';

  for (const msg of session.messages) {
    const wrap = document.createElement('div');
    wrap.className = `message-wrap ${msg.role}`;

    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    const body = document.createElement('div');
    body.className = 'message-body';

    // Render markdown with mermaid support
    body.innerHTML = await renderMarkdownWithMermaid(msg.content);
    bubble.appendChild(body);

    if (Array.isArray(msg.images) && msg.images.length > 0) {
      const attachmentList = document.createElement('div');
      attachmentList.className = 'message-attachments';
      msg.images.forEach((image, imageIndex) => {
        const cachedImage = getCachedImageForMessage(msg.id, imageIndex);
        if (cachedImage?.dataUrl) {
          const card = document.createElement('button');
          card.className = 'message-image-card';
          card.type = 'button';
          card.dataset.previewSrc = cachedImage.dataUrl;
          card.dataset.previewAlt = image.name || `image-${imageIndex + 1}`;
          card.innerHTML = `
            <img class="message-image-thumb" src="${escapeHtml(cachedImage.dataUrl)}" alt="${escapeHtml(image.name || `image-${imageIndex + 1}`)}" />
            <div class="message-image-meta">${escapeHtml(image.name)} · ${formatBytes(image.sizeBytes)}</div>
          `;
          attachmentList.appendChild(card);
          return;
        }

        if (image.previewUrl) {
          const card = document.createElement('button');
          card.className = 'message-image-card';
          card.type = 'button';
          card.dataset.previewSrc = image.previewUrl;
          card.dataset.previewAlt = image.name || `image-${imageIndex + 1}`;
          card.innerHTML = `
            <img class="message-image-thumb" src="${escapeHtml(image.previewUrl)}" alt="${escapeHtml(image.name || `image-${imageIndex + 1}`)}" />
            <div class="message-image-meta">${escapeHtml(image.name)} · ${formatBytes(image.sizeBytes)}</div>
          `;
          attachmentList.appendChild(card);
          return;
        }

        const chip = document.createElement('div');
        chip.className = 'message-attachment-chip';
        chip.textContent = `🖼 ${image.name} (${formatBytes(image.sizeBytes)})`;
        attachmentList.appendChild(chip);
      });
      bubble.appendChild(attachmentList);
    }

    const meta = document.createElement('div');
    meta.className = 'message-meta';
    meta.textContent = `${msg.role === 'user' ? 'You' : 'Assistant'} · ${formatTime(msg.createdAt)}`;

    wrap.appendChild(bubble);
    wrap.appendChild(meta);
    elements.messageList.appendChild(wrap);
  }

  // Render mermaid diagrams after all messages are added
  await renderMermaidDiagrams(elements.messageList);

  // 只在用户本来就在底部时才自动滚底，不强制打断用户滚动
  if (atBottom) {
    elements.messageList.scrollTop = elements.messageList.scrollHeight;
  }
}

function renderHeader() {
  const session = getActiveSession();
  elements.activeSessionName.textContent = session?.name || 'New chat';
  elements.sessionPermissionSelect.value = normalizePermissionLevel(session?.permissionLevel);
}

function render() {
  renderSessions();
  renderHeader();
  // Call async renderMessages without blocking
  renderMessages().catch(err => {
    console.error('Error rendering messages:', err);
  });
}

function resolvePendingSession() {
  if (!state.pending) return null;
  return getSessionById(state.pending.sessionId);
}

function finishPendingResponse({ content, statusText }) {
  const pendingSession = resolvePendingSession();
  if (pendingSession) {
    updateMessage(pendingSession, state.pending.assistantMsgId, { content: String(content || '') });
  }

  state.pending = null;
  setStatus(statusText);
  updateComposerState();
  render();
}

function connectWs() {
  if (state.ws && (state.ws.readyState === 0 || state.ws.readyState === 1)) return;

  state.ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  emitClientDebug('chain.webui.ws.connecting', 'webui ws connecting');

  state.ws.onopen = () => {
    state.wsReady = true;
    setStatus('Connected');
    updateComposerState();
    emitClientDebug('chain.webui.ws.connected', 'webui ws connected');
  };

  state.ws.onclose = () => {
    state.wsReady = false;
    setStatus('Disconnected');
    emitClientDebug('chain.webui.ws.closed', 'webui ws closed');
    if (state.pending) {
      finishPendingResponse({
        content: 'Error: websocket disconnected before tool finished.',
        statusText: 'Disconnected'
      });
    }
    setTimeout(connectWs, 600);
  };

  state.ws.onerror = () => {
    state.wsReady = false;
    setStatus('Connection error');
    emitClientDebug('chain.webui.ws.error', 'webui ws error');
    if (state.pending) {
      finishPendingResponse({
        content: 'Error: websocket error before tool finished.',
        statusText: 'Connection error'
      });
    }
  };

  state.ws.onmessage = (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }

    if (!state.pending) return;

    if (msg.type === 'event') {
      emitClientDebug('chain.webui.ws.event', 'webui received runtime event', {
        event: msg.data?.event || null,
        session_id: msg.data?.session_id || null
      });
      if (msg.data?.session_id && msg.data.session_id !== state.pending.sessionId) return;
      if (msg.data?.event === 'tool.call') {
        setStatus(`Running tool: ${msg.data.payload?.name || 'unknown'}`);
      }
      return;
    }

    if (msg.type === 'error') {
      emitClientDebug('chain.webui.ws.error_message', 'webui received runtime error', {
        message: msg.message || 'Unknown error'
      });
      finishPendingResponse({
        content: `Error: ${msg.message || 'Unknown error'}`,
        statusText: 'Error'
      });
      return;
    }

    if (msg.type === 'final') {
      emitClientDebug('chain.webui.ws.final', 'webui received runtime final', {
        session_id: msg.session_id || null,
        output_chars: String(msg.output || '').length
      });
      if (msg.session_id && msg.session_id !== state.pending.sessionId) return;
      finishPendingResponse({
        content: msg.output || '',
        statusText: 'Idle'
      });
    }
  };
}

function autosizeInput() {
  elements.chatInput.style.height = '0px';
  const next = Math.min(elements.chatInput.scrollHeight, 220);
  elements.chatInput.style.height = `${next}px`;
}

function sendMessage() {
  const text = elements.chatInput.value.trim();
  const uploads = [...state.pendingUploads];
  if ((!text && uploads.length === 0) || state.pending) return;

  const session = getActiveSession();
  if (!session) return;

  if (!state.wsReady) {
    setStatus('WebSocket connecting, retry in 1s.');
    connectWs();
    return;
  }

  const userMsg = addMessage(
    session,
    'user',
    text || '[Image]',
    {
      images: uploads.map((upload) => ({
        clientId: upload.clientId,
        name: upload.name,
        mimeType: upload.mimeType,
        sizeBytes: upload.sizeBytes,
        previewUrl: buildSessionImageUrl(session.id, upload.clientId, upload.mimeType)
      }))
    }
  );
  const assistantMsg = addMessage(session, 'assistant', 'Thinking...');
  cacheMessageImages(userMsg.id, uploads);
  state.pending = {
    sessionId: session.id,
    userMsgId: userMsg.id,
    assistantMsgId: assistantMsg.id
  };

  elements.chatInput.value = '';
  state.pendingUploads = [];
  autosizeInput();
  renderUploadPreview();
  updateComposerState();
  render();
  setStatus('Running');

  state.ws.send(JSON.stringify({
    type: 'run',
    session_id: session.id,
    input: text,
    permission_level: normalizePermissionLevel(session.permissionLevel),
    input_images: uploads.map((upload) => ({
      client_id: upload.clientId,
      name: upload.name,
      mime_type: upload.mimeType,
      size_bytes: upload.sizeBytes,
      data_url: upload.dataUrl
    }))
  }));
  emitClientDebug('chain.webui.ws.sent', 'webui sent run request', {
    session_id: session.id,
    input_chars: text.length,
    input_images: uploads.length,
    permission_level: normalizePermissionLevel(session.permissionLevel)
  });
}

function createNewSession() {
  const session = createSession();
  state.sessions.unshift(session);
  state.activeSessionId = session.id;
  state.followServerSessionId = null;
  clearPendingUploads();
  persist();
  render();
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`request failed: ${url} status=${response.status}`);
  }
  return response.json();
}

async function syncSessionDetailFromServer(sessionId) {
  const detail = await fetchJson(`/api/sessions/${encodeURIComponent(sessionId)}`);
  if (!detail?.ok || !detail?.data) {
    return null;
  }

  const serverSession = detail.data;
  let localSession = getSessionById(serverSession.session_id);
  if (!localSession) {
    localSession = createSession();
    localSession.id = serverSession.session_id;
    state.sessions.push(localSession);
  }

  localSession.name = typeof serverSession.title === 'string' ? serverSession.title : localSession.name;
  localSession.createdAt = typeof serverSession.created_at === 'string' ? serverSession.created_at : localSession.createdAt;
  localSession.updatedAt = typeof serverSession.updated_at === 'string' ? serverSession.updated_at : localSession.updatedAt;
  localSession.permissionLevel = normalizePermissionLevel(serverSession.settings?.permission_level || localSession.permissionLevel);
  localSession.messages = Array.isArray(serverSession.messages)
    ? serverSession.messages.map(messageFromServer)
    : localSession.messages;

  return localSession;
}

async function syncSessionsFromServer() {
  const payload = await fetchJson('/api/sessions?limit=80');
  if (!payload?.ok || !payload?.data || !Array.isArray(payload.data.items)) {
    return;
  }
  const latestServerId = payload.data.items[0]?.session_id || null;

  for (const summary of payload.data.items) {
    if (summary.session_id === 'config-v2-agent') continue; // 隐藏 config 编辑会话
    let localSession = getSessionById(summary.session_id);
    if (!localSession) {
      localSession = sessionFromServerSummary(summary);
      state.sessions.push(localSession);
    } else {
      localSession.name = typeof summary.title === 'string' ? summary.title : localSession.name;
      localSession.updatedAt = typeof summary.updated_at === 'string' ? summary.updated_at : localSession.updatedAt;
      localSession.permissionLevel = normalizePermissionLevel(summary.permission_level || localSession.permissionLevel);
    }
  }

  if (latestServerId && !state.pending) {
    const activeExists = Boolean(state.activeSessionId && getSessionById(state.activeSessionId));
    if (!state.serverSyncInitialized || !activeExists) {
      // 首次初始化或当前 session 已不存在时，跟随服务端最新 session
      state.activeSessionId = latestServerId;
      state.followServerSessionId = latestServerId;
    } else if (state.followServerSessionId && state.activeSessionId === state.followServerSessionId) {
      // 用户未手动切换过（followServerSessionId 未被清空），跟随服务端
      state.activeSessionId = latestServerId;
      state.followServerSessionId = latestServerId;
    }
    // 用户已手动选择 session（followServerSessionId === null），不强制跳转
    state.serverSyncInitialized = true;
  }

  const activeId = state.activeSessionId;
  if (activeId) {
    await syncSessionDetailFromServer(activeId);
  }

  persist();
  render();
}

function startServerSyncLoop() {
  if (state.serverSyncTimer) {
    clearInterval(state.serverSyncTimer);
  }

  const run = async () => {
    try {
      await syncSessionsFromServer();
    } catch {
      // Keep UI interactive even when sync request fails.
    }
  };

  void run();
  state.serverSyncTimer = setInterval(() => {
    void run();
  }, SERVER_SYNC_INTERVAL_MS);
}

async function persistSessionPermission(session) {
  try {
    await fetch(`/api/sessions/${encodeURIComponent(session.id)}/settings`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        settings: {
          permission_level: normalizePermissionLevel(session.permissionLevel)
        }
      })
    });
  } catch {
    // Keep UI responsive even when network is temporarily unavailable.
  }
}

function setPersonaHint(text) {
  elements.personaHint.textContent = text || '';
}

async function loadPersonaProfile() {
  try {
    const resp = await fetch('/api/persona/profile');
    const data = await resp.json();
    if (!data?.ok) throw new Error(data?.error || 'load persona failed');
    const customName = data?.data?.addressing?.custom_name || '';
    elements.personaCustomName.value = customName;
    setPersonaHint(customName ? '当前使用自定义称呼。' : '当前使用默认称呼：主人');
  } catch {
    setPersonaHint('人格配置加载失败');
  }
}

async function savePersonaProfile() {
  const customName = String(elements.personaCustomName.value || '').trim();
  setPersonaHint('保存中...');
  try {
    const resp = await fetch('/api/persona/profile', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        profile: {
          addressing: {
            custom_name: customName
          }
        }
      })
    });
    const data = await resp.json();
    if (!resp.ok || !data?.ok) throw new Error(data?.error || 'save persona failed');
    setPersonaHint(customName ? `已更新称呼：${customName}` : '已恢复默认称呼：主人');
  } catch (err) {
    setPersonaHint(`保存失败：${err.message || err}`);
  }
}

function bindEvents() {
  elements.sendBtn.onclick = sendMessage;
  elements.newSessionBtn.onclick = createNewSession;
  elements.savePersonaBtn.onclick = () => { void savePersonaProfile(); };
  elements.addImageBtn.onclick = () => elements.imageInput.click();
  elements.imageInput.onchange = async (event) => {
    await onImageFilesSelected(event.target.files);
  };
  elements.uploadPreviewList.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const uploadId = target.dataset.uploadId;
    if (!uploadId) return;
    removePendingUpload(uploadId);
  });
  elements.messageList.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const trigger = target.closest('.message-image-card');
    if (!(trigger instanceof HTMLElement)) return;
    openImageLightbox(trigger.dataset.previewSrc, trigger.dataset.previewAlt || 'image');
  });
  elements.lightboxCloseBtn.onclick = closeImageLightbox;
  elements.imageLightbox.addEventListener('click', (event) => {
    if (event.target === elements.imageLightbox) {
      closeImageLightbox();
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && elements.imageLightbox.classList.contains('open')) {
      closeImageLightbox();
    }
  });

  elements.chatInput.addEventListener('input', autosizeInput);
  elements.chatInput.addEventListener('input', updateComposerState);
  elements.chatInput.addEventListener('compositionstart', () => {
    state.isComposing = true;
  });
  elements.chatInput.addEventListener('compositionend', () => {
    state.isComposing = false;
  });
  elements.chatInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.shiftKey) return;
    if (event.isComposing || state.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    sendMessage();
  });

  elements.menuBtn.onclick = () => {
    elements.sidebar.classList.toggle('open');
  };

  elements.sessionPermissionSelect.addEventListener('change', () => {
    const session = getActiveSession();
    if (!session) return;
    session.permissionLevel = normalizePermissionLevel(elements.sessionPermissionSelect.value);
    session.updatedAt = nowIso();
    persist();
    renderSessions();
    void persistSessionPermission(session);
  });

  elements.themeSelect.addEventListener('change', () => {
    const nextPreference = normalizeThemePreference(elements.themeSelect.value);
    persistThemePreference(nextPreference);
    applyTheme(nextPreference);
  });

  elements.debugPanelToggleBtn.onclick = () => {
    setDebugPanelOpen(!state.debugPanelOpen);
  };

  elements.debugConnectBtn.onclick = connectDebugStream;
  elements.debugDisconnectBtn.onclick = disconnectDebugStream;
  elements.debugModeBtn.onclick = () => { void toggleDebugMode(); };
  elements.debugClearBtn.onclick = () => {
    elements.debugStreamList.innerHTML = '';
  };
  elements.debugTopicsInput.addEventListener('change', () => {
    elements.debugTopicsInput.value = normalizeDebugTopics(elements.debugTopicsInput.value);
    persistDebugPrefs();
    connectDebugStream();
  });

  const themeMedia = window.matchMedia('(prefers-color-scheme: dark)');
  const handleThemeMediaChange = () => {
    if (state.themePreference !== 'auto') return;
    applyTheme('auto');
  };
  if (typeof themeMedia.addEventListener === 'function') {
    themeMedia.addEventListener('change', handleThemeMediaChange);
  } else if (typeof themeMedia.addListener === 'function') {
    themeMedia.addListener(handleThemeMediaChange);
  }
}

function bootstrap() {
  loadSessions();
  loadDebugPrefs();
  setDebugPanelOpen(state.debugPanelOpen);
  loadThemePreference();
  bindEvents();
  setDebugModeButton();
  setStatus('Idle');
  connectWs();
  connectDebugStream();
  void loadDebugMode();
  window.addEventListener('beforeunload', disconnectDebugStream);
  startServerSyncLoop();
  void loadPersonaProfile();
  void loadPersonaProfile();
  startServerSyncLoop();
  autosizeInput();
  renderUploadPreview();
  updateComposerState();
  render();
  void loadGitBranch();
}

async function loadGitBranch() {
  try {
    const res = await fetch('/api/version');
    const data = await res.json();
    if (data.ok && data.data && data.data.branch) {
      const tag = document.getElementById('versionTag');
      if (tag) {
        tag.textContent = `branch: ${data.data.branch}`;
      }
    }
  } catch {
    // silently ignore
  }
}

bootstrap();
