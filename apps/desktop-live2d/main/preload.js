const { contextBridge, ipcRenderer } = require('electron');

const CHANNELS = {
  invoke: 'live2d:rpc:invoke',
  result: 'live2d:rpc:result',
  rendererReady: 'live2d:renderer:ready',
  rendererError: 'live2d:renderer:error',
  getRuntimeConfig: 'live2d:get-runtime-config',
  modelConfigRequest: 'live2d:model-config:request',
  sessionControlRequest: 'live2d:session-control:request',
  shellStateRequest: 'live2d:shell-state:request',
  shellStateSync: 'live2d:shell-state:sync',
  avatarTransferRequest: 'live2d:avatar-transfer:request',
  avatarContextMenuRequest: 'live2d:avatar-context-menu:request',
  chatInputSubmit: 'live2d:chat:input:submit',
  chatAudioSubmit: 'live2d:chat:audio:submit',
  chatAudioStateSync: 'live2d:chat:audio-state-sync',
  chatAudioPermissionRequest: 'live2d:chat:audio-permission:request',
  chatPanelToggle: 'live2d:chat:panel-toggle',
  chatStateSync: 'live2d:chat:state-sync',
  chatStreamSync: 'live2d:chat:stream-sync',
  chatToolActivitySync: 'live2d:chat:tool-activity-sync',
  chatImagePreviewOpen: 'live2d:chat:image-preview-open',
  bubbleStateSync: 'live2d:bubble:state-sync',
  bubbleMetricsUpdate: 'live2d:bubble:metrics-update',
  modelBoundsUpdate: 'live2d:model:bounds-update',
  actionTelemetry: 'live2d:action:telemetry',
  lipsyncTelemetry: 'live2d:lipsync:telemetry',
  windowDrag: 'live2d:window:drag',
  windowControl: 'live2d:window:control',
  chatPanelVisibility: 'live2d:chat:panel-visibility',
  windowResizeRequest: 'live2d:window:resize-request',
  windowStateSync: 'live2d:window:state-sync',
  windowInteractivity: 'live2d:window:interactivity'
};

contextBridge.exposeInMainWorld('desktopLive2dBridge', {
  onInvoke(handler) {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on(CHANNELS.invoke, listener);
    return () => ipcRenderer.off(CHANNELS.invoke, listener);
  },
  sendResult(payload) {
    ipcRenderer.send(CHANNELS.result, payload);
  },
  notifyReady(payload = {}) {
    ipcRenderer.send(CHANNELS.rendererReady, payload);
  },
  notifyError(payload = {}) {
    ipcRenderer.send(CHANNELS.rendererError, payload);
  },
  sendChatInput(payload = {}) {
    ipcRenderer.send(CHANNELS.chatInputSubmit, payload);
  },
  sendChatAudioInput(payload = {}) {
    ipcRenderer.send(CHANNELS.chatAudioSubmit, payload);
  },
  requestChatAudioPermission() {
    return ipcRenderer.invoke(CHANNELS.chatAudioPermissionRequest);
  },
  onChatAudioStateSync(handler) {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on(CHANNELS.chatAudioStateSync, listener);
    return () => ipcRenderer.off(CHANNELS.chatAudioStateSync, listener);
  },
  sendChatPanelToggle(payload = {}) {
    ipcRenderer.send(CHANNELS.chatPanelToggle, payload);
  },
  sendChatImagePreviewOpen(payload = {}) {
    ipcRenderer.send(CHANNELS.chatImagePreviewOpen, payload);
  },
  sendModelBounds(payload = {}) {
    ipcRenderer.send(CHANNELS.modelBoundsUpdate, payload);
  },
  sendBubbleMetrics(payload = {}) {
    ipcRenderer.send(CHANNELS.bubbleMetricsUpdate, payload);
  },
  sendActionTelemetry(payload = {}) {
    ipcRenderer.send(CHANNELS.actionTelemetry, payload);
  },
  sendLipsyncTelemetry(payload = {}) {
    ipcRenderer.send(CHANNELS.lipsyncTelemetry, payload);
  },
  onChatStateSync(handler) {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on(CHANNELS.chatStateSync, listener);
    return () => ipcRenderer.off(CHANNELS.chatStateSync, listener);
  },
  onChatStreamSync(handler) {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on(CHANNELS.chatStreamSync, listener);
    return () => ipcRenderer.off(CHANNELS.chatStreamSync, listener);
  },
  onChatToolActivitySync(handler) {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on(CHANNELS.chatToolActivitySync, listener);
    return () => ipcRenderer.off(CHANNELS.chatToolActivitySync, listener);
  },
  onBubbleStateSync(handler) {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on(CHANNELS.bubbleStateSync, listener);
    return () => ipcRenderer.off(CHANNELS.bubbleStateSync, listener);
  },
  sendWindowDrag(payload = {}) {
    ipcRenderer.send(CHANNELS.windowDrag, payload);
  },
  sendWindowControl(payload = {}) {
    ipcRenderer.send(CHANNELS.windowControl, payload);
  },
  sendWindowResize(payload = {}) {
    ipcRenderer.send(CHANNELS.windowResizeRequest, payload);
  },
  sendWindowInteractivity(payload = {}) {
    ipcRenderer.send(CHANNELS.windowInteractivity, payload);
  },
  sendChatPanelVisibility(payload = {}) {
    ipcRenderer.send(CHANNELS.chatPanelVisibility, payload);
  },
  onWindowStateSync(handler) {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on(CHANNELS.windowStateSync, listener);
    return () => ipcRenderer.off(CHANNELS.windowStateSync, listener);
  },
  getRuntimeConfig() {
    return ipcRenderer.invoke(CHANNELS.getRuntimeConfig);
  },
  modelConfigRequest(payload = {}) {
    return ipcRenderer.invoke(CHANNELS.modelConfigRequest, payload);
  },
  sessionControlRequest(payload = {}) {
    return ipcRenderer.invoke(CHANNELS.sessionControlRequest, payload);
  },
  getShellState() {
    return ipcRenderer.invoke(CHANNELS.shellStateRequest);
  },
  onShellStateSync(handler) {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on(CHANNELS.shellStateSync, listener);
    return () => ipcRenderer.off(CHANNELS.shellStateSync, listener);
  },
  requestAvatarTransfer(payload = {}) {
    return ipcRenderer.invoke(CHANNELS.avatarTransferRequest, payload);
  },
  sendAvatarContextMenu() {
    ipcRenderer.send(CHANNELS.avatarContextMenuRequest);
  },
  onVoicePlayMemory(handler) {
    const channel = 'desktop:voice:play-memory';
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.off(channel, listener);
  },
  onVoicePlayRemote(handler) {
    const channel = 'desktop:voice:play-remote';
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.off(channel, listener);
  },
  onVoiceStreamStart(handler) {
    const channel = 'desktop:voice:stream-start';
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.off(channel, listener);
  },
  onVoiceStreamChunk(handler) {
    const channel = 'desktop:voice:stream-chunk';
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.off(channel, listener);
  },
  onVoiceStreamEnd(handler) {
    const channel = 'desktop:voice:stream-end';
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.off(channel, listener);
  },
  onVoiceStreamError(handler) {
    const channel = 'desktop:voice:stream-error';
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.off(channel, listener);
  }
});
