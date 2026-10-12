# Gateway

WebSocket ingress for runtime.

Responsibilities:
- Accept legacy `type=run` debug messages
- Accept JSON-RPC 2.0 requests (`runtime.run`)
- Push all runtime input into `RpcInputQueue`
- Build prompt context from:
  - session-start long-term memory SOP/bootstrap
  - short-term persisted session history
- Forward runtime notifications/responses back to client
- Expose provider-config APIs:
  - `GET /api/config/providers`
  - `GET /api/config/providers/config`
  - `PUT /api/config/providers/config`
  - `GET /api/config/providers/raw`
  - `PUT /api/config/providers/raw`
- Expose session persistence APIs:
  - `GET /api/sessions`
  - `GET /api/sessions/:sessionId`
  - `GET /api/sessions/:sessionId/events`
  - `GET /api/sessions/:sessionId/memory`
- Expose long-term memory APIs:
  - `GET /api/memory`
  - `GET /api/memory/search?q=<keyword>`
- Serve front-end pages:
  - `/` chatbox UI with session sidebar
  - `/config-v2.html` settings WebUI (overview / models / voice / advanced; loopback-only writes); `/config.html` redirects there
