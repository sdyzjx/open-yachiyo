const { randomUUID } = require('node:crypto');
const WebSocket = require('ws');

function createDesktopSessionId() {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return `desktop-${stamp}-${randomUUID().slice(0, 8)}`;
}

function toGatewayWsUrl(gatewayUrl) {
  const parsed = new URL(gatewayUrl);
  parsed.protocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:';

  if (parsed.pathname.endsWith('/ws')) {
    return parsed.toString();
  }

  if (parsed.pathname.endsWith('/')) {
    parsed.pathname = `${parsed.pathname}ws`;
  } else {
    parsed.pathname = `${parsed.pathname}/ws`;
  }
  return parsed.toString();
}

function mapGatewayMessageToDesktopEvent(message) {
  if (message && message.jsonrpc === '2.0' && typeof message.method === 'string') {
    if (
      message.method === 'runtime.start'
      || message.method === 'runtime.event'
      || message.method === 'runtime.final'
      || message.method === 'message.delta'
    ) {
      return {
        type: message.method,
        timestamp: Date.now(),
        data: message.params || {}
      };
    }
    return null;
  }

  if (message && typeof message.type === 'string') {
    if (message.type === 'start' || message.type === 'event' || message.type === 'final' || message.type === 'delta') {
      return {
        type: `legacy.${message.type}`,
        timestamp: Date.now(),
        data: message
      };
    }
  }

  return null;
}

function normalizeInputImages(inputImages) {
  if (!Array.isArray(inputImages)) {
    return [];
  }
  const normalized = [];
  for (const image of inputImages) {
    if (!image || typeof image !== 'object' || Array.isArray(image)) {
      continue;
    }
    const dataUrl = String(image.data_url || image.dataUrl || '').trim();
    if (!dataUrl || !/^data:image\//i.test(dataUrl)) {
      continue;
    }
    const mimeType = String(image.mime_type || image.mimeType || '').trim() || 'image/*';
    normalized.push({
      client_id: String(image.client_id || image.clientId || '').trim() || `img-${randomUUID().slice(0, 8)}`,
      name: String(image.name || 'image').trim() || 'image',
      mime_type: mimeType,
      size_bytes: Math.max(0, Number(image.size_bytes ?? image.sizeBytes) || 0),
      data_url: dataUrl
    });
    if (normalized.length >= 4) {
      break;
    }
  }
  return normalized;
}

class GatewayRuntimeClient {
  constructor({
    gatewayUrl,
    sessionId = 'desktop-live2d',
    requestTimeoutMs = 120000,
    onNotification = null,
    fetchImpl = globalThis.fetch,
    WebSocketImpl = WebSocket,
    logger = console
  }) {
    this.gatewayUrl = String(gatewayUrl);
    this.gatewayWsUrl = toGatewayWsUrl(gatewayUrl);
    this.sessionId = sessionId;
    this.requestTimeoutMs = requestTimeoutMs;
    this.onNotification = onNotification;
    this.fetchImpl = fetchImpl;
    this.WebSocketImpl = WebSocketImpl;
    this.logger = logger;
  }

  async emitDebug(topic, msg, meta = {}) {
    if (typeof this.fetchImpl !== 'function') return;
    const normalizedMeta = meta && typeof meta === 'object' && !Array.isArray(meta) ? meta : {};
    try {
      const url = new URL('/api/debug/emit', this.gatewayUrl);
      await this.fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          event: 'log',
          topic,
          level: 'info',
          msg,
          source_file: String(normalizedMeta.source_file || 'apps/desktop-live2d/main/gatewayRuntimeClient.js'),
          ...normalizedMeta
        })
      });
    } catch {
      // best-effort telemetry
    }
  }

  getSessionId() {
    return this.sessionId;
  }

  setSessionId(sessionId) {
    const normalized = String(sessionId || '').trim();
    if (!normalized) {
      throw new Error('sessionId must be non-empty');
    }
    this.sessionId = normalized;
    return this.sessionId;
  }

  async createAndUseNewSession({ permissionLevel = 'high' } = {}) {
    const sessionId = createDesktopSessionId();
    this.setSessionId(sessionId);
    await this.ensureSession({ sessionId, permissionLevel });
    return sessionId;
  }

  async ensureSession({ sessionId = this.sessionId, permissionLevel = 'high' } = {}) {
    if (typeof this.fetchImpl !== 'function') {
      throw new Error('fetch is unavailable for gateway session bootstrap');
    }

    const url = new URL(`/api/sessions/${encodeURIComponent(sessionId)}/settings`, this.gatewayUrl);
    void this.emitDebug('chain.electron.ensure_session.start', 'electron ensure session start', {
      session_id: sessionId,
      permission_level: permissionLevel
    });
    const response = await this.fetchImpl(url, {
      method: 'PUT',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        settings: {
          permission_level: permissionLevel
        }
      })
    });

    if (!response.ok) {
      let bodyText = '';
      try {
        bodyText = await response.text();
      } catch {
        bodyText = '';
      }
      throw new Error(`failed to ensure gateway session ${sessionId}: status=${response.status} body=${bodyText}`);
    }

    void this.emitDebug('chain.electron.ensure_session.completed', 'electron ensure session completed', {
      session_id: sessionId,
      permission_level: permissionLevel
    });

    try {
      return await response.json();
    } catch {
      return { ok: true };
    }
  }

  async runInput({ input, permissionLevel, inputImages, modelRef } = {}) {
    const content = String(input || '').trim();
    const normalizedInputImages = normalizeInputImages(inputImages);
    if (!content && normalizedInputImages.length === 0) {
      throw new Error('gateway runtime input or inputImages must be non-empty');
    }

    const requestId = `desktop-${randomUUID()}`;
    const payload = {
      jsonrpc: '2.0',
      id: requestId,
      method: 'runtime.run',
      params: {
        session_id: this.sessionId
      }
    };
    if (content) {
      payload.params.input = content;
    }
    if (normalizedInputImages.length > 0) {
      payload.params.input_images = normalizedInputImages;
    }
    if (permissionLevel) {
      payload.params.permission_level = permissionLevel;
    }
    if (typeof modelRef === 'string' && modelRef.trim()) {
      payload.params.model_ref = modelRef.trim();
    }
    void this.emitDebug('chain.electron.run.start', 'electron runInput start', {
      session_id: this.sessionId,
      request_id: requestId,
      input_chars: content.length,
      input_images: normalizedInputImages.length,
      permission_level: permissionLevel || null
    });

    return new Promise((resolve, reject) => {
      const ws = new this.WebSocketImpl(this.gatewayWsUrl);
      let settled = false;

      const timer = setTimeout(() => {
        settled = true;
        ws.terminate();
        void this.emitDebug('chain.electron.run.timeout', 'electron runInput timeout', {
          session_id: this.sessionId,
          request_id: requestId,
          timeout_ms: this.requestTimeoutMs
        });
        reject(new Error(`gateway runtime timeout after ${this.requestTimeoutMs}ms`));
      }, this.requestTimeoutMs);

      const finish = (fn, value) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        try {
          ws.close();
        } catch {
          // ignore close errors during shutdown
        }
        fn(value);
      };

      ws.on('open', () => {
        void this.emitDebug('chain.electron.ws.connected', 'electron gateway ws connected', {
          session_id: this.sessionId,
          request_id: requestId
        });
        ws.send(JSON.stringify(payload));
        void this.emitDebug('chain.electron.ws.sent', 'electron gateway ws sent runtime.run', {
          session_id: this.sessionId,
          request_id: requestId
        });
      });

      ws.on('message', (raw) => {
        let message;
        try {
          message = JSON.parse(String(raw));
        } catch {
          return;
        }

        const desktopEvent = mapGatewayMessageToDesktopEvent(message);
        if (desktopEvent && typeof this.onNotification === 'function') {
          try {
            this.onNotification(desktopEvent, message);
          } catch (err) {
            this.logger.error?.('[desktop-live2d] failed to process gateway notification', err);
          }
        }

        if (message?.id !== requestId) {
          return;
        }

        if (message.error) {
          void this.emitDebug('chain.electron.run.error', 'electron runInput rpc error', {
            session_id: this.sessionId,
            request_id: requestId,
            error: message.error.message || 'gateway runtime call failed'
          });
          finish(reject, new Error(message.error.message || 'gateway runtime call failed'));
          return;
        }

        void this.emitDebug('chain.electron.run.completed', 'electron runInput completed', {
          session_id: this.sessionId,
          request_id: requestId,
          trace_id: message.result?.trace_id || null
        });
        finish(resolve, message.result || null);
      });

      ws.on('error', (err) => {
        void this.emitDebug('chain.electron.ws.error', 'electron gateway ws error', {
          session_id: this.sessionId,
          request_id: requestId,
          error: err?.message || String(err)
        });
        finish(reject, err);
      });

      ws.on('close', () => {
        void this.emitDebug('chain.electron.ws.closed', 'electron gateway ws closed', {
          session_id: this.sessionId,
          request_id: requestId
        });
        if (!settled) {
          finish(reject, new Error('gateway connection closed before runtime result'));
        }
      });
    });
  }

  startNotificationStream() {
    if (this._notifWs) return;

    const connect = () => {
      if (this._notifStopped) return;
      const ws = new this.WebSocketImpl(this.gatewayWsUrl);
      this._notifWs = ws;

      ws.on('message', (raw) => {
        let message;
        try { message = JSON.parse(String(raw)); } catch { return; }
        const desktopEvent = mapGatewayMessageToDesktopEvent(message);
        if (desktopEvent && typeof this.onNotification === 'function') {
          try { this.onNotification(desktopEvent, message); } catch { /* ignore */ }
        }
      });

      ws.on('close', () => {
        this._notifWs = null;
        if (!this._notifStopped) {
          setTimeout(connect, 2000);
        }
      });

      ws.on('error', () => { /* reconnect handled by close */ });
    };

    this._notifStopped = false;
    connect();
  }

  stopNotificationStream() {
    this._notifStopped = true;
    if (this._notifWs) {
      try { this._notifWs.close(); } catch { /* ignore */ }
      this._notifWs = null;
    }
  }
}

module.exports = {
  createDesktopSessionId,
  toGatewayWsUrl,
  mapGatewayMessageToDesktopEvent,
  GatewayRuntimeClient
};
