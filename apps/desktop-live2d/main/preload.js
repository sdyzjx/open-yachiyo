const { contextBridge, ipcRenderer } = require('electron');

const CHANNELS = {
  invoke: 'live2d:rpc:invoke',
  result: 'live2d:rpc:result',
  rendererReady: 'live2d:renderer:ready',
  rendererError: 'live2d:renderer:error',
  getRuntimeConfig: 'live2d:get-runtime-config',
  chatInputSubmit: 'live2d:chat:input:submit',
  chatPanelToggle: 'live2d:chat:panel-toggle',
  chatStateSync: 'live2d:chat:state-sync',
  chatStreamSync: 'live2d:chat:stream-sync',
  bubbleStateSync: 'live2d:bubble:state-sync',
  bubbleMetricsUpdate: 'live2d:bubble:metrics-update',
  modelBoundsUpdate: 'live2d:model:bounds-update',
  actionTelemetry: 'live2d:action:telemetry',
  lipsyncTelemetry: 'live2d:lipsync:telemetry',
  windowDrag: 'live2d:window:drag',
  windowControl: 'live2d:window:control',
  chatPanelVisibility: 'live2d:chat:panel-visibility',
  windowResizeRequest: 'live2d:window:resize-request',
  windowStateSync: 'live2d:window:state-sync'
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
  sendChatPanelToggle(payload = {}) {
    ipcRenderer.send(CHANNELS.chatPanelToggle, payload);
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
  }
});
