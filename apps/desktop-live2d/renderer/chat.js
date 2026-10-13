(function chatWindowMain() {
  const bridge = window.desktopLive2dBridge;
  const chatPanelElement = document.getElementById('chat-panel');
  const messagesElement = document.getElementById('chat-panel-messages');
  const chatInputElement = document.getElementById('chat-input');
  const chatSendElement = document.getElementById('chat-send');
  const chatImagePickElement = document.getElementById('chat-image-pick');
  const chatMicElement = document.getElementById('chat-mic');
  const chatImageInputElement = document.getElementById('chat-image-input');
  const chatUploadPreviewElement = document.getElementById('chat-upload-preview');
  const chatComposerElement = document.getElementById('chat-panel-composer');
  const chatHideElement = document.getElementById('chat-hide');
  const openWebUiElement = document.getElementById('open-webui');
  const newChatElement = document.getElementById('new-chat');
  const sessionNewElement = document.getElementById('chat-session-new');
  const sessionListElement = document.getElementById('chat-session-list');
  const sessionEmptyElement = document.getElementById('chat-session-empty');
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
  const sessionControlToggleElement = document.getElementById('session-control-toggle');
  const sessionControlPanelElement = document.getElementById('session-control-panel');
  const sessionControlSessionElement = document.getElementById('session-control-session');
  const sessionControlStatusElement = document.getElementById('session-control-status');
  const sessionModeDescriptionElement = document.getElementById('session-mode-description');
  const sessionPendingListElement = document.getElementById('session-pending-list');
  const sessionApprovalEmptyElement = document.getElementById('session-approval-empty');
  const sessionApprovalCountElement = document.getElementById('session-approval-count');
  const toolActivityElement = document.getElementById('chat-tool-activity');
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
    selectedModelRef: '',
    sessions: { currentId: '', items: [], busy: false, error: '' },
    sessionControl: { sessionId: '', mode: 'manual', pending: [], busy: false, available: false, error: '' },
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
  const toolActivity = new Map();

  function renderToolActivity() {
    if (!toolActivityElement) return;
    toolActivityElement.replaceChildren(...[...toolActivity.values()].slice(-5).map((item) => {
      const card = document.createElement('article');
      card.className = `chat-tool-card ${item.status}`;
      const name = document.createElement('div');
      name.className = 'chat-tool-name';
      name.textContent = item.name;
      const status = document.createElement('div');
      status.className = 'chat-tool-status';
      status.textContent = { running: '正在执行', done: '已完成', failed: '执行失败' }[item.status];
      card.append(name, status);
      return card;
    }));
  }

  function handleToolActivity(event = {}) {
    if (event.session_id && state.sessions.currentId && event.session_id !== state.sessions.currentId) return;
    const payload = event.payload || {};
    const key = String(payload.call_id || payload.tool_call_id || `${event.trace_id || 'run'}:${payload.name || payload.tool_name || 'tool'}`);
    const failed = /failed|error/.test(String(event.event || '')) || payload.ok === false || payload.error === true;
    const done = /completed|result/.test(String(event.event || ''));
    const item = { name: String(payload.name || payload.tool_name || '工具调用'), status: failed ? 'failed' : done ? 'done' : 'running' };
    toolActivity.set(key, item);
    renderToolActivity();
    if (item.status !== 'running') setTimeout(() => { toolActivity.delete(key); renderToolActivity(); }, 8000);
  }
  let chatInputComposing = false;
  let voiceCapture = null;
  const allowedRoles = new Set(['user', 'assistant', 'system', 'tool']);
  const approvalModes = Object.freeze({
    manual: { label: '每次询问', description: '高风险命令执行前，由你逐次允许或拒绝。' },
    auto_approve: { label: '自动批准', description: '自动批准需要确认的命令，同时保留工具安全边界。' },
    full_access: { label: '完全访问', description: '允许 Agent 在当前会话中使用完整电脑能力。' }
  });

  function normalizeApprovalMode(value) {
    const mode = String(value || '').trim().toLowerCase();
    return approvalModes[mode] ? mode : 'manual';
  }

  function normalizePendingApprovals(values) {
    if (!Array.isArray(values)) return [];
    const byId = new Map();
    for (const value of values) {
      const approvalId = String(value?.approval_id || '').trim();
      if (!approvalId) continue;
      byId.set(approvalId, {
        approval_id: approvalId,
        tool_name: String(value?.tool_name || 'shell.exec'),
        command: String(value?.command || ''),
        reason: String(value?.reason || ''),
        created_at_ms: Number(value?.created_at_ms) || 0,
        expires_at_ms: Number(value?.expires_at_ms) || 0
      });
    }
    return [...byId.values()]
      .filter((item) => !item.expires_at_ms || item.expires_at_ms > Date.now())
      .sort((a, b) => a.created_at_ms - b.created_at_ms);
  }

  function renderSessionControl() {
    const control = state.sessionControl;
    const mode = normalizeApprovalMode(control.mode);
    if (sessionControlToggleElement) {
      sessionControlToggleElement.disabled = !control.available;
      sessionControlToggleElement.title = control.available ? `执行权限：${approvalModes[mode].label}` : '执行权限暂不可用';
    }
    if (sessionControlSessionElement) sessionControlSessionElement.textContent = control.sessionId || '尚未同步';
    if (sessionControlStatusElement) sessionControlStatusElement.textContent = control.busy ? '正在同步…' : (control.error || `${control.pending.length} 项`);
    if (sessionModeDescriptionElement) sessionModeDescriptionElement.textContent = approvalModes[mode].description;
    if (sessionApprovalCountElement) {
      sessionApprovalCountElement.textContent = String(control.pending.length);
      sessionApprovalCountElement.hidden = control.pending.length === 0;
    }
    for (const button of document.querySelectorAll('[data-session-mode]')) {
      button.setAttribute('aria-checked', String(button.dataset.sessionMode === mode));
      button.disabled = control.busy || !control.available;
    }
    if (!sessionPendingListElement || !sessionApprovalEmptyElement) return;
    sessionApprovalEmptyElement.hidden = control.pending.length > 0;
    sessionPendingListElement.replaceChildren(...control.pending.map((request) => {
      const card = document.createElement('article');
      card.className = 'session-approval-card';
      const tool = document.createElement('div');
      tool.className = 'session-approval-tool';
      tool.textContent = request.tool_name;
      const command = document.createElement('div');
      command.className = 'session-approval-command';
      command.textContent = request.command || '未提供命令详情';
      const reason = document.createElement('div');
      reason.className = 'session-approval-reason';
      reason.textContent = request.reason ? `原因：${request.reason}` : '此操作需要你的许可';
      const actions = document.createElement('div');
      actions.className = 'session-approval-actions';
      for (const [label, approved, className] of [['拒绝', false, ''], ['允许', true, 'approve']]) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = label;
        button.className = className;
        button.disabled = control.busy;
        button.addEventListener('click', () => { void decideSessionApproval(request.approval_id, approved); });
        actions.append(button);
      }
      card.append(tool, command, reason, actions);
      return card;
    }));
  }

  async function refreshSessionControl({ quiet = false } = {}) {
    if (state.sessionControl.busy || typeof bridge?.sessionControlRequest !== 'function') return;
    state.sessionControl.busy = true;
    state.sessionControl.error = '';
    renderSessionControl();
    try {
      const snapshot = await bridge.sessionControlRequest({ action: 'get' });
      state.sessionControl.sessionId = String(snapshot?.session_id || '');
      state.sessionControl.mode = normalizeApprovalMode(snapshot?.settings?.approval_mode);
      state.sessionControl.pending = normalizePendingApprovals(snapshot?.pending);
      state.sessionControl.available = true;
    } catch (err) {
      state.sessionControl.available = false;
      state.sessionControl.error = quiet ? '' : `同步失败：${err?.message || err}`;
    } finally {
      state.sessionControl.busy = false;
      renderSessionControl();
    }
  }

  async function updateSessionApprovalMode(mode) {
    const normalized = normalizeApprovalMode(mode);
    if (state.sessionControl.busy || !state.sessionControl.available || normalized === state.sessionControl.mode) return;
    state.sessionControl.busy = true;
    state.sessionControl.error = '';
    renderSessionControl();
    try {
      const result = await bridge.sessionControlRequest({ action: 'set_approval_mode', approval_mode: normalized });
      state.sessionControl.sessionId = String(result?.session_id || state.sessionControl.sessionId);
      state.sessionControl.mode = normalizeApprovalMode(result?.settings?.approval_mode);
      state.sessionControl.available = true;
    } catch (err) {
      state.sessionControl.error = `设置失败：${err?.message || err}`;
    } finally {
      state.sessionControl.busy = false;
      renderSessionControl();
    }
  }

  async function decideSessionApproval(approvalId, approved) {
    if (state.sessionControl.busy || !state.sessionControl.available) return;
    state.sessionControl.busy = true;
    state.sessionControl.error = '';
    renderSessionControl();
    try {
      await bridge.sessionControlRequest({ action: 'decide_approval', approval_id: approvalId, approved, scope: 'once' });
      state.sessionControl.pending = state.sessionControl.pending.filter((item) => item.approval_id !== approvalId);
    } catch (err) {
      state.sessionControl.error = `处理失败：${err?.message || err}`;
    } finally {
      state.sessionControl.busy = false;
      renderSessionControl();
    }
  }

  function setSessionControlOpen(open) {
    if (!sessionControlPanelElement) return;
    sessionControlPanelElement.hidden = !open;
    sessionControlToggleElement?.setAttribute('aria-expanded', String(open));
    if (open) void refreshSessionControl();
  }

  function formatSessionDate(value) {
    const date = new Date(value || 0);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
  }

  function renderSessionList() {
    if (!sessionListElement || !sessionEmptyElement) return;
    sessionEmptyElement.hidden = state.sessions.items.length > 0;
    sessionListElement.replaceChildren(...state.sessions.items.map((session) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `chat-session-item${session.session_id === state.sessions.currentId ? ' active' : ''}`;
      button.dataset.sessionId = session.session_id;
      button.disabled = state.sessions.busy;
      const title = document.createElement('span');
      title.className = 'chat-session-title';
      title.textContent = String(session.title || '新对话');
      const meta = document.createElement('span');
      meta.className = 'chat-session-meta';
      meta.textContent = `${Number(session.message_count) || 0} 条 · ${formatSessionDate(session.updated_at)}`;
      button.append(title, meta);
      return button;
    }));
    if (sessionNewElement) sessionNewElement.disabled = state.sessions.busy;
  }

  async function loadSessions() {
    if (state.sessions.busy || typeof bridge?.sessionControlRequest !== 'function') return;
    state.sessions.busy = true;
    renderSessionList();
    try {
      const result = await bridge.sessionControlRequest({ action: 'list_sessions', limit: 80 });
      state.sessions.currentId = String(result?.current_session_id || '');
      state.sessions.items = Array.isArray(result?.items) ? result.items : [];
      state.sessions.error = '';
    } catch (err) {
      state.sessions.error = String(err?.message || err);
    } finally {
      state.sessions.busy = false;
      renderSessionList();
    }
  }

  async function selectSession(sessionId) {
    const normalized = String(sessionId || '').trim();
    if (!normalized || state.sessions.busy || normalized === state.sessions.currentId) return;
    state.sessions.busy = true;
    renderSessionList();
    try {
      await bridge.sessionControlRequest({ action: 'select_session', session_id: normalized });
      state.sessions.currentId = normalized;
      await Promise.all([refreshSessionControl({ quiet: true }), loadModelConfig({ quiet: true })]);
    } catch (err) {
      state.sessions.error = String(err?.message || err);
    } finally {
      state.sessions.busy = false;
      renderSessionList();
      void loadSessions();
    }
  }

  async function createSession() {
    if (state.sessions.busy) return;
    state.sessions.busy = true;
    renderSessionList();
    try {
      const result = await bridge.sessionControlRequest({ action: 'new_session' });
      state.sessions.currentId = String(result?.session_id || '');
      state.pendingUploads = [];
      renderUploadPreview();
      await refreshSessionControl({ quiet: true });
    } catch (err) {
      state.sessions.error = String(err?.message || err);
    } finally {
      state.sessions.busy = false;
      void loadSessions();
    }
  }

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
    return `${name}${provider ? ` · ${provider}` : ''}${model?.has_api_key === false ? ' · 缺少密钥' : ''}${model?.available === false ? ' · 配置不可用' : ''}`;
  }

  function renderModelConfig() {
    const snapshot = state.models;
    if (!modelActiveElement) return;
    modelActiveElement.replaceChildren();
    const enabledRefs = new Set(Array.isArray(snapshot?.enabled) ? snapshot.enabled : []);
    const enabledModels = Array.isArray(snapshot?.models)
      ? snapshot.models.filter((model) => model?.enabled === true || enabledRefs.has(model?.ref) || model?.ref === snapshot.active)
      : [];
    const availableModels = enabledModels.filter((model) => model.available !== false);
    if (!snapshot || enabledModels.length === 0) {
      modelActiveElement.append(new Option('没有可用模型', ''));
      modelActiveElement.title = '没有已启用的模型';
      setModelControlsDisabled(true);
      return;
    }
    for (const model of enabledModels) {
      const option = new Option(modelLabel(model), model.ref);
      option.disabled = model.available === false;
      option.title = model.availability_reason || '';
      option.selected = model.ref === (state.selectedModelRef || snapshot.active);
      modelActiveElement.append(option);
    }
    if (!availableModels.some((model) => model.ref === state.selectedModelRef)) {
      const configuredActive = availableModels.find((model) => model.ref === snapshot.active);
      state.selectedModelRef = configuredActive?.ref || availableModels[0]?.ref || '';
      modelActiveElement.value = state.selectedModelRef;
    }
    const active = snapshot.models.find((model) => model.ref === state.selectedModelRef);
    modelActiveElement.title = active ? `本次对话：${modelLabel(active)}` : '选择对话模型';
    setModelControlsDisabled(availableModels.length === 0);
  }

  async function loadModelConfig({ quiet = false } = {}) {
    if (state.modelsLoading || typeof bridge?.modelConfigRequest !== 'function') return;
    state.modelsLoading = true;
    setModelControlsDisabled(true);
    if (modelActiveElement) modelActiveElement.title = '正在读取模型…';
    if (!quiet) setModelStatus('正在从本机网关加载模型…');
    try {
      state.models = await bridge.modelConfigRequest({ method: 'GET', path: '/api/config/models' });
      if (!state.selectedModelRef || !state.models.models?.some((model) => model.ref === state.selectedModelRef && model.enabled && model.available !== false)) {
        const enabled = new Set(state.models.enabled || []);
        state.selectedModelRef = state.models.models?.find((model) =>
          model.available !== false && (model.enabled || enabled.has(model.ref)))?.ref || '';
      }
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

  function selectChatModel() {
    const ref = String(modelActiveElement?.value || '');
    if (!ref || !state.models) return;
    state.selectedModelRef = ref;
    renderModelConfig();
    const model = state.models.models.find((item) => item.ref === ref);
    setModelStatus(`本次对话使用 ${modelLabel(model)}`);
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
    if (chatMicElement && !chatMicElement.classList.contains('sending')) {
      chatMicElement.disabled = !state.inputEnabled;
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
      source: 'chat-panel-window',
      model_ref: state.selectedModelRef || undefined
    });
    if (chatInputElement) {
      chatInputElement.value = '';
      chatInputElement.focus();
      resizeComposerInput();
    }
    clearPendingUploads();
    updateComposerState();
  }

  function encodePcmWav(chunks, sourceRate) {
    const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const merged = new Float32Array(length);
    let offset = 0;
    for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.length; }
    const ratio = Math.max(1, Number(sourceRate) / 16000);
    const outputLength = Math.max(1, Math.floor(merged.length / ratio));
    const buffer = new ArrayBuffer(44 + outputLength * 2);
    const view = new DataView(buffer);
    const write = (at, value) => { for (let i = 0; i < value.length; i += 1) view.setUint8(at + i, value.charCodeAt(i)); };
    write(0, 'RIFF'); view.setUint32(4, 36 + outputLength * 2, true); write(8, 'WAVE'); write(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    write(36, 'data'); view.setUint32(40, outputLength * 2, true);
    for (let i = 0; i < outputLength; i += 1) {
      const start = Math.floor(i * ratio);
      const end = Math.min(merged.length, Math.max(start + 1, Math.floor((i + 1) * ratio)));
      let sample = 0;
      for (let j = start; j < end; j += 1) sample += merged[j];
      sample = Math.max(-1, Math.min(1, sample / Math.max(1, end - start)));
      view.setInt16(44 + i * 2, sample < 0 ? sample * 32768 : sample * 32767, true);
    }
    return new Uint8Array(buffer);
  }

  function bytesToBase64(bytes) {
    let binary = '';
    const size = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += size) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + size));
    }
    return btoa(binary);
  }

  function setMicState(stateName, message = '') {
    if (!chatMicElement) return;
    chatMicElement.classList.toggle('recording', stateName === 'recording');
    chatMicElement.classList.toggle('sending', stateName === 'sending');
    chatMicElement.disabled = stateName === 'sending' || !state.inputEnabled;
    chatMicElement.textContent = stateName === 'recording' ? '■' : '🎙';
    chatMicElement.title = message || (stateName === 'recording' ? '停止并发送录音' : '开始录音');
    chatMicElement.setAttribute('aria-label', chatMicElement.title);
  }

  async function startVoiceCapture() {
    if (voiceCapture || !navigator.mediaDevices?.getUserMedia) return;
    if (typeof bridge?.requestChatAudioPermission === 'function') {
      const permission = await bridge.requestChatAudioPermission();
      if (permission?.granted !== true) throw new Error('请在系统设置中允许 Open Yachiyo 使用麦克风');
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: {
      channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true
    } });
    const AudioContextImpl = window.AudioContext || window.webkitAudioContext;
    const context = new AudioContextImpl();
    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(4096, 1, 1);
    const mute = context.createGain(); mute.gain.value = 0;
    const chunks = [];
    processor.onaudioprocess = (event) => chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
    source.connect(processor); processor.connect(mute); mute.connect(context.destination);
    voiceCapture = { stream, context, source, processor, mute, chunks, sampleRate: context.sampleRate, startedAt: performance.now() };
    setMicState('recording');
  }

  async function stopVoiceCapture() {
    const capture = voiceCapture;
    if (!capture) return;
    voiceCapture = null;
    capture.processor.disconnect(); capture.source.disconnect(); capture.mute.disconnect();
    capture.stream.getTracks().forEach((track) => track.stop());
    await capture.context.close();
    if (performance.now() - capture.startedAt < 280 || capture.chunks.length === 0) {
      setMicState('idle', '录音太短，请重试');
      return;
    }
    const wav = encodePcmWav(capture.chunks, capture.sampleRate);
    setMicState('sending', '正在发送语音');
    bridge?.sendChatAudioInput?.({
      audio_base64: bytesToBase64(wav), format: 'wav', sample_rate: 16000,
      model_ref: state.selectedModelRef || undefined
    });
  }

  bridge?.onChatStateSync?.((payload) => {
    applyChatState(payload).catch(err => {
      console.error('Error applying chat state:', err);
    });
  });
  bridge?.onChatStreamSync?.((payload) => {
    handleChatStreamSync(payload);
  });
  bridge?.onChatToolActivitySync?.(handleToolActivity);

  chatSendElement?.addEventListener('click', submitInput);
  chatMicElement?.addEventListener('click', () => {
    if (voiceCapture) void stopVoiceCapture();
    else void startVoiceCapture().catch((error) => setMicState('idle', `录音失败：${error?.message || error}`));
  });
  bridge?.onChatAudioStateSync?.((payload) => {
    if (payload?.state === 'sending') setMicState('sending', '正在发送语音');
    else if (payload?.state === 'error') setMicState('idle', `语音失败：${payload.error || '未知错误'}`);
    else setMicState('idle');
  });
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
  newChatElement?.addEventListener('click', () => { void createSession(); });
  sessionNewElement?.addEventListener('click', () => { void createSession(); });
  sessionListElement?.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest('[data-session-id]') : null;
    if (button) void selectSession(button.dataset.sessionId);
  });
  modelActiveElement?.addEventListener('change', selectChatModel);
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
  modelSaveElement?.addEventListener('click', selectChatModel);
  modelDiscoverElement?.addEventListener('click', () => { void discoverProviderModels(); });
  sessionControlToggleElement?.addEventListener('click', () => {
    setSessionControlOpen(sessionControlPanelElement?.hidden !== false);
  });
  for (const button of document.querySelectorAll('[data-session-mode]')) {
    button.addEventListener('click', () => { void updateSessionApprovalMode(button.dataset.sessionMode); });
  }
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
  void loadSessions();
  renderSessionControl();
  void refreshSessionControl({ quiet: true });
  setInterval(() => { void refreshSessionControl({ quiet: true }); }, 5000);
})();
