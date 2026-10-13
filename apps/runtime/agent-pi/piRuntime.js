const path = require('node:path');
const { loadPi } = require('./loadPi');
const { createModelRuntime, selectModels, isRetryableModelError } = require('./modelAdapter');
const { bridgeTools } = require('./toolBridge');
const { DeviceTools } = require('./deviceTools');
const { buildPrompt } = require('./promptBuilder');
const { SessionBridge } = require('./sessionBridge');
const { createResourceLoader } = require('./skillBridge');
const { EventBridge, contentText } = require('./eventBridge');
const { AgentSessionRegistry } = require('./agentSessionRegistry');

function imageParts(images) {
  return images.map((image) => {
    const match = /^data:(image\/[\w.+-]+);base64,([\s\S]+)$/.exec(image.data_url || '');
    if (!match) throw new Error('Invalid image data URL');
    return { type: 'image', mimeType: match[1], data: match[2].replace(/\s/g, '') };
  });
}

function sameModel(left, right) {
  return Boolean(left && right
    && left.provider === right.provider
    && left.id === right.id
    && JSON.stringify(left.input || []) === JSON.stringify(right.input || []));
}

function modelWithImages(model, tools, images) {
  if (!images.length && !tools.some((tool) => tool.originalName.startsWith('desktop.capture.'))) return model;
  return { ...model, input: ['text', 'image'] };
}

async function createPiRuntime(deps) {
  const { sdk } = await loadPi();
  const sessions = deps.sessionBridge || new SessionBridge({ rootDir: deps.sessionDir, sessionStore: deps.sessionStore,
    mirrorHistory: deps.mirrorHistory !== false, compaction: deps.compaction });
  const streaming = deps.runtimeStreamingEnabled !== false;
  const maxStep = deps.maxStep || 128;
  const toolErrorMaxRetries = deps.toolErrorMaxRetries || 5;

  const createEntry = async (sessionId, initial) => {
    const { catalog, chain, cwd, seedMessages = [], systemPrompt = '' } = initial;
    const models = await createModelRuntime(catalog);
    const opened = await sessions.open({ sessionId, cwd, seedMessages, model: chain[0] });
    const state = { current: null, systemPrompt, disposed: false };
    const context = () => {
      const current = state.current;
      return {
        ...(current?.runtimeContext || {}), trace_id: current?.events?.traceId || null,
        session_id: sessionId, step_index: current?.events?.step || 0,
        reportToolError: (callId, failure) => current?.events?.toolFailures.set(callId, failure)
      };
    };
    const onlineNames = new Map();
    const localTools = bridgeTools({ executor: deps.executor, bus: deps.bus, context, onlineNames });
    const devices = new DeviceTools({ deviceHub: typeof deps.deviceHub === 'function' ? deps.deviceHub() : deps.deviceHub,
      bus: deps.bus, avatar: deps.avatar, policy: deps.executor.policy });
    const tools = [...localTools, ...devices.snapshot(context, localTools.map((tool) => tool.originalName), onlineNames)];
    const toolNames = new Map();
    for (const tool of tools) {
      if (toolNames.has(tool.name)) throw new Error(`Tool name encoding collision: ${toolNames.get(tool.name)} and ${tool.originalName}`);
      toolNames.set(tool.name, tool.originalName);
    }
    const onlineNameSet = new Set(tools.map((tool) => tool.name));
    const aliases = tools.filter((tool) => tool.name !== tool.originalName && !onlineNameSet.has(tool.originalName)).map((tool) => ({
      ...tool,
      name: tool.originalName,
      prepareLoadout: () => ({ hiddenDeclarations: [tool.originalName] })
    }));
    const loader = await createResourceLoader({ cwd: deps.cwd || process.cwd(), agentDir: path.join(sessions.rootDir, '.agent'),
      settingsManager: opened.settingsManager, getSystemPrompt: () => state.systemPrompt,
      skillConfigStore: deps.skillConfigStore });
    const model = models.getModel(chain[0].provider, chain[0].id);
    ({ session: state.session } = await sdk.createAgentSession({ cwd, agentDir: path.join(sessions.rootDir, '.agent'),
      modelRuntime: models, model, thinkingLevel: model.reasoning ? 'medium' : 'off', resourceLoader: loader,
      sessionManager: opened.manager, settingsManager: opened.settingsManager, noTools: 'builtin',
      tools: [...tools.map((tool) => tool.name), ...aliases.map((tool) => tool.name)], customTools: [...tools, ...aliases] }));
    state.unsubscribe = state.session.subscribe((event) => {
      const current = state.current;
      if (!current) return;
      current.events.accept(event);
      if (event.type === 'tool_execution_end') {
        if (event.isError) current.failures += 1;
        else {
          const originalName = current.events.toolName(event.toolName);
          if (originalName.startsWith('live2d.') || originalName === 'voice.tts_aliyun_vc') {
            state.session.setActiveToolsByName(state.session.getActiveToolNames().filter((name) =>
              originalName.startsWith('live2d.')
                ? !current.events.toolName(name).startsWith('live2d.')
                : current.events.toolName(name) !== originalName));
          }
        }
      }
      if (current.events.step > maxStep || current.failures > toolErrorMaxRetries) {
        current.limited = true;
        void state.session.abort();
      }
    });
    return {
      sessionId, state, session: state.session, manager: opened.manager, settingsManager: opened.settingsManager,
      models, catalog, devices, tools, aliases, toolNames, allToolNames: [...tools, ...aliases].map((tool) => tool.name),
      systemSeeds: opened.systemSeeds,
      isBusy: () => state.session.isStreaming || Boolean(state.current),
      async dispose() {
        if (state.disposed) return;
        state.disposed = true;
        state.unsubscribe?.();
        state.session.dispose();
        devices.dispose();
      }
    };
  };

  const registry = deps.sessionRegistry || new AgentSessionRegistry({
    createEntry,
    idleTtlMs: deps.sessionIdleTtlMs,
    maxSessions: deps.maxResidentSessions
  });

  const runtime = {
    runtimeStreamingEnabled: streaming,
    toolAsyncMode: 'serial',
    toolEarlyDispatch: false,
    maxParallelTools: 1,
    toolErrorMaxRetries,
    sessionRegistry: registry,
    async dispose() { await registry.disposeAll?.(); },
    async run(args) {
      const { sessionId, onEvent, seedMessages = [] } = args;
      const runtimeContext = { ...args.runtimeContext };
      if (args.permissionLevel) runtimeContext.permission_level = args.permissionLevel;
      let input = args.input || '';
      let catalog;
      let entry;
      let events;
      let result;
      let unsubscribe = [];
      try {
        const inputAudio = args.inputAudio || runtimeContext.input_audio;
        runtimeContext.input_type = inputAudio ? 'audio' : 'text';
        if (!input.trim() && inputAudio) {
          const transcription = inputAudio.transcribed_text
            ? { text: inputAudio.transcribed_text }
            : await deps.transcribeAudio?.({ session_id: sessionId, input_audio: inputAudio, runtime_context: runtimeContext });
          input = transcription?.text || '';
        }
        const images = imageParts(args.inputImages || []);
        if (!input.trim() && !images.length) throw new Error('Input is empty after audio transcription');
        const settings = await deps.sessionStore?.getSessionSettings(sessionId);
        const requestedModelRef = args.model_ref || args.modelRef || runtimeContext.model_ref || settings?.model_ref || null;
        catalog = typeof deps.modelCatalog === 'function' ? await deps.modelCatalog({ modelRef: requestedModelRef }) : deps.modelCatalog;
        const chain = selectModels(catalog, requestedModelRef);
        const resolvedModelRef = chain[0].ref;
        events = new EventBridge({ bus: deps.bus, sessionId, onEvent, streaming, requestedModelRef, resolvedModelRef });
        unsubscribe = ['voice.playback.electron', 'tool.call.progress'].map((topic) => deps.bus?.subscribe(topic, (payload) => {
          if (!payload.session_id || payload.session_id === sessionId) events.emit(topic === 'tool.call.progress' ? 'tool.progress' : topic, payload);
        }));
        const cwd = runtimeContext.workspace_root || deps.cwd || process.cwd();
        entry = await registry.get(sessionId, { catalog, chain, cwd, seedMessages });
        if (!entry.models.getModel(chain[0].provider, chain[0].id)) {
          await registry.dispose(sessionId);
          entry = await registry.get(sessionId, { catalog, chain, cwd, seedMessages });
        }
        events.setToolNameResolver((name) => entry.toolNames.get(name) || name);
        const { systemPrompt, persona, skills } = await buildPrompt({ ...deps, sessionId, input, tools: entry.tools,
          runtimeContext, seedMessages: entry.systemSeeds, toolErrorMaxRetries });
        entry.state.systemPrompt = systemPrompt;
        entry.state.current = { events, runtimeContext, failures: 0, limited: false };
        entry.session.setActiveToolsByName(entry.allToolNames);
        await entry.session.reload();
        await sessions.start(sessionId, input, { permission_level: runtimeContext.permission_level, input_audio: inputAudio || null,
          requested_model_ref: requestedModelRef, resolved_model_ref: resolvedModelRef });
        deps.bus?.publish('runtime.start', { session_id: sessionId, trace_id: events.traceId,
          requested_model_ref: requestedModelRef, resolved_model_ref: resolvedModelRef });
        events.emit('plan', { input, input_images: images.length, max_step: maxStep, context_messages: seedMessages.length,
          requested_model_ref: requestedModelRef, resolved_model_ref: resolvedModelRef,
          persona_mode: persona?.mode || null, skills_selected: skills?.selected?.length || entry.session.resourceLoader.getSkills().skills.length,
          skills_clipped_by: skills?.clippedBy || null,
          runtime_flags: { streaming_enabled: streaming, tool_async_mode: 'serial', tool_early_dispatch: false,
            max_parallel_tools: 1, tool_error_max_retries: toolErrorMaxRetries, persistent_session: true } });
        events.emit('llm.prompt.assembled', { message_count: 1, messages: [{ role: 'system', content: systemPrompt }],
          requested_model_ref: requestedModelRef, resolved_model_ref: resolvedModelRef });
        for (let index = 0; index < chain.length; index += 1) {
          const descriptor = chain[index];
          let model = entry.models.getModel(descriptor.provider, descriptor.id);
          model = modelWithImages(model, entry.tools, images);
          const startLeaf = entry.manager.getLeafId();
          entry.state.current.limited = false;
          entry.state.current.failures = 0;
          try {
            if (!sameModel(entry.session.model, model)) await entry.session.setModel(model, { persist: false });
            args.signal?.throwIfAborted();
            const abort = () => { void entry.session.abort(); };
            args.signal?.addEventListener('abort', abort, { once: true });
            try { await entry.session.prompt(input, { images }); } finally { args.signal?.removeEventListener('abort', abort); }
            const last = [...entry.session.messages].reverse().find((message) => message.role === 'assistant');
            if (entry.state.current.limited) throw new Error('Runtime step or tool-error retry limit reached');
            if (!last || ['error', 'aborted'].includes(last.stopReason)) throw new Error(last?.errorMessage || 'Agent did not complete');
            events.resolvedModelRef = descriptor.ref;
            result = events.finish(contentText(last.content));
            break;
          } catch (error) {
            if (descriptor.chatgpt_plan || index + 1 >= chain.length || events.hasOutput || events.hasTools
              || args.signal?.aborted || !isRetryableModelError(error)) throw error;
            if (startLeaf) entry.manager.branch(startLeaf); else entry.manager.resetLeaf();
            entry.session.refreshContext();
            events.emit('llm.fallback', { from: descriptor.ref, to: chain[index + 1].ref });
          }
        }
      } catch (error) {
        let message = String(error?.message || error);
        for (const model of catalog?.models || []) if (model.api_key) message = message.split(model.api_key).join('[redacted]');
        if (!events) events = new EventBridge({ bus: deps.bus, sessionId, onEvent, streaming });
        events.emit('tool.error', { error: message });
        deps.bus?.publish('runtime.error', { session_id: sessionId, trace_id: events.traceId, error: message });
        result = events.finish(`运行错误：${message}`, 'ERROR');
      } finally {
        if (entry?.state.current?.events === events) entry.state.current = null;
        unsubscribe.forEach((off) => off?.());
      }
      await sessions.finish(sessionId, result, events.events);
      return result;
    }
  };
  return runtime;
}

module.exports = { createPiRuntime, imageParts, sameModel, modelWithImages };
