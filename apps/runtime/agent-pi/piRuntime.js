const path = require('node:path');
const { loadPi } = require('./loadPi');
const { createModelRuntime, selectModels, isRetryableModelError } = require('./modelAdapter');
const { bridgeTools } = require('./toolBridge');
const { DeviceTools } = require('./deviceTools');
const { buildPrompt } = require('./promptBuilder');
const { SessionBridge } = require('./sessionBridge');
const { createResourceLoader } = require('./skillBridge');
const { EventBridge } = require('./eventBridge');
const { AgentSessionRegistry } = require('./agentSessionRegistry');
const { TurnCoordinator } = require('./turnCoordinator');
const { ApprovalCoordinator } = require('../approval/approvalCoordinator');
const { normalizeSessionApprovalMode } = require('../session/sessionPermissions');
const { SessionEventSubscriptions } = require('./sessionEventSubscriptions');
const { createBusTools } = require('./busTools');
const { createStandardTools } = require('./standardTools');
const { createPiPolicyExtension } = require('./piPolicyExtension');
const { createUiChatTool, UI_CHAT_TOOL_NAME } = require('./uiChatTool');

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
  if (!images.length && !tools.some((tool) => String(tool.originalName || tool.name).startsWith('desktop.capture.'))) return model;
  return { ...model, input: [...new Set([...(model.input || ['text']), 'image'])] };
}

async function createPiRuntime(deps) {
  const { sdk } = await loadPi();
  const sessions = deps.sessionBridge || new SessionBridge({ rootDir: deps.sessionDir, sessionStore: deps.sessionStore,
    mirrorHistory: deps.mirrorHistory !== false, compaction: deps.compaction });
  const streaming = deps.runtimeStreamingEnabled !== false;
  const maxStep = deps.maxStep || 128;
  const toolErrorMaxRetries = deps.toolErrorMaxRetries || 5;
  const approvalCoordinator = deps.approvalCoordinator || new ApprovalCoordinator({ bus: deps.bus });
  const ownsApprovalCoordinator = !deps.approvalCoordinator;

  const createEntry = async (sessionId, initial) => {
    const { catalog, chain, cwd, seedMessages = [], systemPrompt = '' } = initial;
    const models = await createModelRuntime(catalog, {
      sessionId,
      WebSocketImpl: deps.realtimeWebSocket,
      onRealtimeAudio: ({ sessionId: audioSessionId, requestId, topic, data }) => {
        const target = String(audioSessionId || '').startsWith('device-')
          ? String(audioSessionId).slice('device-'.length)
          : undefined;
        deps.bus?.publish(topic, {
          ...data,
          request_id: requestId,
          session_id: audioSessionId,
          ...(target ? { __target: target } : {})
        });
      },
      onRealtimeTranscript: ({ sessionId: audioSessionId, streamId, text }) => {
        const target = String(audioSessionId || '').startsWith('device-')
          ? String(audioSessionId).slice('device-'.length)
          : undefined;
        deps.bus?.publish('audio.input.transcript', {
          stream_id: streamId || null,
          text,
          final: true,
          session_id: audioSessionId,
          ...(target ? { __target: target } : {})
        });
      }
    });
    const opened = await sessions.open({ sessionId, cwd, seedMessages, model: chain[0] });
    const state = { current: null, coordinator: null, systemPrompt, disposed: false, lastRuntimeContext: {} };
    const context = () => {
      const current = state.current;
      return {
        ...(current?.runtimeContext || {}), trace_id: current?.events?.traceId || null,
        session_id: sessionId, step_index: current?.events?.step || 0,
        reportToolError: (callId, failure) => current?.events?.toolFailures.set(callId, failure),
        publishRuntimeEvent: (event, payload) => current?.events?.emit(event, payload)
      };
    };
    const onlineNames = new Map();
    const localTools = bridgeTools({
      executor: deps.executor,
      bus: deps.bus,
      context,
      onlineNames,
      approvalCoordinator,
      // Pi's native definitions are clearer and richer. Keep these adapters as
      // policy-controlled backends without presenting duplicate choices to the model.
      excludeNames: ['shell.exec', 'workspace.write_file']
    });
    const standardTools = createStandardTools({ sdk, cwd, context });
    const uiTools = [createUiChatTool({ context, onlineNames })];
    let dispatchBusSteer = () => {};
    const eventSubscriptions = new SessionEventSubscriptions({
      bus: deps.bus,
      sessionId,
      onSteer: (event) => dispatchBusSteer(event)
    });
    const busTools = createBusTools({ subscriptions: eventSubscriptions, bus: deps.bus,
      policy: deps.executor.policy, context, onlineNames });
    const devices = new DeviceTools({ deviceHub: typeof deps.deviceHub === 'function' ? deps.deviceHub() : deps.deviceHub,
      bus: deps.bus, avatar: deps.avatar, policy: deps.executor.policy });
    const reservedNames = [...localTools, ...standardTools, ...uiTools, ...busTools].map((tool) => tool.originalName || tool.name);
    const tools = [...localTools, ...standardTools, ...uiTools, ...busTools, ...devices.snapshot(context, reservedNames, onlineNames)];
    const toolNames = new Map();
    for (const tool of tools) {
      if (toolNames.has(tool.name)) throw new Error(`Tool name encoding collision: ${toolNames.get(tool.name)} and ${tool.originalName}`);
      toolNames.set(tool.name, tool.originalName || tool.name);
    }
    const onlineNameSet = new Set(tools.map((tool) => tool.name));
    const aliases = tools.filter((tool) => tool.originalName && tool.name !== tool.originalName && !onlineNameSet.has(tool.originalName)).map((tool) => ({
      ...tool,
      name: tool.originalName,
      prepareLoadout: () => ({ hiddenDeclarations: [tool.originalName] })
    }));
    const policyExtension = createPiPolicyExtension({ cwd, context, approvalCoordinator });
    const loader = await createResourceLoader({ cwd, agentDir: path.join(sessions.rootDir, '.agent'),
      settingsManager: opened.settingsManager, getSystemPrompt: () => state.systemPrompt,
      skillConfigStore: deps.skillConfigStore,
      extensionFactories: [{ name: 'yachiyo-pi-policy', factory: policyExtension, hidden: true }] });
    const model = models.getModel(chain[0].provider, chain[0].id);
    ({ session: state.session } = await sdk.createAgentSession({ cwd, agentDir: path.join(sessions.rootDir, '.agent'),
      modelRuntime: models, model, thinkingLevel: model.reasoning ? 'medium' : 'off', resourceLoader: loader,
      sessionManager: opened.manager, settingsManager: opened.settingsManager, noTools: 'builtin',
      tools: [...tools.map((tool) => tool.name), ...aliases.map((tool) => tool.name)], customTools: [...tools, ...aliases] }));
    state.coordinator = new TurnCoordinator({ onActivate: (tracker) => {
      state.current = tracker;
      state.systemPrompt = tracker.systemPrompt;
      state.session.setActiveToolsByName([...tools, ...aliases].map((tool) => tool.name));
    } });
    state.unsubscribe = state.session.subscribe((event) => {
      const before = state.coordinator.current();
      state.coordinator.accept(event);
      const current = before || state.coordinator.current();
      if (!current) return;
      if (event.type === 'tool_execution_end') {
        if (event.isError) current.failures += 1;
        else {
          const originalName = current.events.toolName(event.toolName);
          if (originalName.startsWith('live2d.') || originalName === 'voice.tts_aliyun_vc' || originalName === UI_CHAT_TOOL_NAME) {
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
    dispatchBusSteer = (event) => {
      if (state.disposed) return;
      const input = [
        'A high-priority subscribed event arrived from the Yachiyo event bus.',
        `Topic: ${event.topic}`,
        `Payload: ${JSON.stringify(event.data)}`,
        'Handle it with the same tools and policy as this session. Do not claim it was a new user message.'
      ].join('\n');
      const events = new EventBridge({ bus: deps.bus, sessionId, streaming });
      events.setToolNameResolver((name) => toolNames.get(name) || name);
      const alreadyRunning = Boolean(state.session.agent.signal || state.session.isStreaming
        || state.coordinator.current());
      const tracker = state.coordinator.register({
        input,
        events,
        runtimeContext: { ...state.lastRuntimeContext, input_type: 'event' },
        systemPrompt: state.systemPrompt,
        startsImmediately: !alreadyRunning
      });
      const prompting = alreadyRunning
        ? state.session.steer(input)
        : state.session.prompt(input, {
          preflightResult: (disposition) => { tracker.disposition = disposition; }
        });
      if (alreadyRunning) tracker.disposition = 'queued';
      prompting.catch((error) => state.coordinator.fail(tracker, error));
      tracker.promise.then((turn) => {
        events.finish(turn.output, turn.state === 'DONE' ? 'DONE' : turn.state === 'SUPERSEDED' ? 'ABORTED' : 'ERROR');
      }).catch((error) => {
        events.finish(String(error?.message || error), 'ERROR');
      });
    };
    return {
      sessionId, state, session: state.session, manager: opened.manager, settingsManager: opened.settingsManager,
      models, catalog, devices, tools, aliases, toolNames, allToolNames: [...tools, ...aliases].map((tool) => tool.name),
      systemSeeds: opened.systemSeeds,
      isBusy: () => state.session.isStreaming || state.coordinator.size > 0,
      async dispose() {
        if (state.disposed) return;
        state.disposed = true;
        state.unsubscribe?.();
        state.session.dispose();
        models.closeRealtimeConnections?.();
        devices.dispose();
        eventSubscriptions.dispose();
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
    toolAsyncMode: 'parallel',
    toolEarlyDispatch: false,
    maxParallelTools: null,
    toolErrorMaxRetries,
    supportsNativeQueueing: true,
    sessionRegistry: registry,
    async dispose() {
      await registry.disposeAll?.();
      if (ownsApprovalCoordinator) approvalCoordinator.dispose();
    },
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
        const settings = await deps.sessionStore?.getSessionSettings(sessionId);
        runtimeContext.approval_mode = normalizeSessionApprovalMode(
          args.approvalMode || runtimeContext.approval_mode || settings?.approval_mode
        );
        if (runtimeContext.approval_mode === 'full_access') runtimeContext.permission_level = 'high';
        const requestedModelRef = args.model_ref || args.modelRef || runtimeContext.model_ref || settings?.model_ref || null;
        catalog = typeof deps.modelCatalog === 'function' ? await deps.modelCatalog({ modelRef: requestedModelRef }) : deps.modelCatalog;
        const chain = selectModels(catalog, requestedModelRef);
        runtimeContext.explicit_ui_delivery = true;
        runtimeContext.native_voice_available = Boolean(chain[0].transport === 'realtime'
          && chain[0].realtime_output === 'native' && chain[0].output?.includes('audio'));
        const directRealtimeAudio = Boolean(inputAudio && chain[0].transport === 'realtime'
          && chain[0].input?.includes('audio'));
        if (!input.trim() && inputAudio && !directRealtimeAudio) {
          const transcription = inputAudio.transcribed_text
            ? { text: inputAudio.transcribed_text }
            : await deps.transcribeAudio?.({ session_id: sessionId, input_audio: inputAudio, runtime_context: runtimeContext });
          input = transcription?.text || '';
        }
        if (directRealtimeAudio && !input.trim()) input = '[实时语音输入]';
        const images = imageParts(args.inputImages || []);
        if (!input.trim() && !images.length) throw new Error('Input is empty after audio transcription');
        const resolvedModelRef = chain[0].ref;
        events = new EventBridge({ bus: deps.bus, sessionId, onEvent, streaming, requestedModelRef, resolvedModelRef,
          uiHidden: runtimeContext.explicit_ui_delivery });
        const cwd = runtimeContext.workspace_root || deps.cwd || process.cwd();
        entry = await registry.get(sessionId, { catalog, chain, cwd, seedMessages });
        if (!entry.models.getModel(chain[0].provider, chain[0].id)) {
          await registry.dispose(sessionId);
          entry = await registry.get(sessionId, { catalog, chain, cwd, seedMessages });
        }
        events.setToolNameResolver((name) => entry.toolNames.get(name) || name);
        entry.state.lastRuntimeContext = { ...runtimeContext };
        const { systemPrompt, persona, skills } = await buildPrompt({ ...deps, sessionId, input, tools: entry.tools,
          runtimeContext, seedMessages: entry.systemSeeds, toolErrorMaxRetries });
        unsubscribe = ['voice.playback.electron', 'tool.call.progress', 'approval.requested', 'approval.resolved']
          .map((topic) => deps.bus?.subscribe(topic, (payload) => {
          if ((!payload.session_id || payload.session_id === sessionId)
            && entry.state.coordinator.current()?.events === events) {
            events.emit(topic === 'tool.call.progress' ? 'tool.progress' : topic, payload);
          }
          }));
        await sessions.start(sessionId, input, { permission_level: runtimeContext.permission_level,
          approval_mode: runtimeContext.approval_mode, input_audio: inputAudio || null,
          requested_model_ref: requestedModelRef, resolved_model_ref: resolvedModelRef });
        deps.bus?.publish('runtime.start', { session_id: sessionId, trace_id: events.traceId,
          requested_model_ref: requestedModelRef, resolved_model_ref: resolvedModelRef });
        events.emit('plan', { input, input_images: images.length, max_step: maxStep, context_messages: seedMessages.length,
          requested_model_ref: requestedModelRef, resolved_model_ref: resolvedModelRef,
          persona_mode: persona?.mode || null, skills_selected: skills?.selected?.length || entry.session.resourceLoader.getSkills().skills.length,
          skills_clipped_by: skills?.clippedBy || null,
          runtime_flags: { streaming_enabled: streaming, tool_async_mode: 'parallel', tool_early_dispatch: false,
            max_parallel_tools: null, tool_error_max_retries: toolErrorMaxRetries, persistent_session: true,
            native_queueing: true } });
        events.emit('llm.prompt.assembled', { message_count: 1, messages: [{ role: 'system', content: systemPrompt }],
          requested_model_ref: requestedModelRef, resolved_model_ref: resolvedModelRef });
        for (let index = 0; index < chain.length; index += 1) {
          const descriptor = chain[index];
          let model = entry.models.getModel(descriptor.provider, descriptor.id);
          model = modelWithImages(model, entry.tools, images);
          const startLeaf = entry.manager.getLeafId();
          const alreadyRunning = Boolean(entry.session.agent.signal || entry.session.isStreaming
            || entry.state.coordinator.current());
          if (alreadyRunning && !sameModel(entry.session.model, model)) {
            throw new Error('Cannot change the session model while another turn is running; retry after it settles');
          }
          if (!alreadyRunning) {
            entry.state.systemPrompt = systemPrompt;
            entry.session.setActiveToolsByName(entry.allToolNames);
            await entry.session.reload();
            if (!sameModel(entry.session.model, model)) await entry.session.setModel(model, { persist: false });
          }
          const tracker = entry.state.coordinator.register({
            input, events, runtimeContext, systemPrompt, startsImmediately: !alreadyRunning
          });
          try {
            args.signal?.throwIfAborted();
            const abort = () => {
              if (entry.state.coordinator.current() === tracker) void entry.session.abort();
              else entry.state.coordinator.fail(tracker, args.signal?.reason || new Error('Queued turn aborted'), 'ABORTED');
            };
            args.signal?.addEventListener('abort', abort, { once: true });
            const behavior = args.deliveryMode || (inputAudio ? 'steer' : 'followUp');
            let prompting;
            if (directRealtimeAudio) {
              const message = {
                role: 'user',
                content: [{ type: 'text', text: input }],
                timestamp: Date.now(),
                yachiyoInputAudio: { ...inputAudio }
              };
              if (alreadyRunning) {
                if (behavior === 'followUp') entry.session.agent.followUp(message);
                else entry.session.agent.steer(message);
                tracker.disposition = 'queued';
                prompting = Promise.resolve();
              } else {
                tracker.disposition = 'started';
                prompting = entry.session.agent.prompt(message);
              }
            } else {
              if (alreadyRunning) {
                prompting = behavior === 'followUp'
                  ? entry.session.followUp(input, images)
                  : entry.session.steer(input, images);
                tracker.disposition = 'queued';
              } else {
                prompting = entry.session.prompt(input, {
                  images,
                  preflightResult: (disposition) => { tracker.disposition = disposition; }
                });
              }
            }
            prompting.catch((error) => entry.state.coordinator.fail(tracker, error));
            const turn = await tracker.promise;
            if (entry.state.coordinator.size === 0) await entry.session.waitForIdle();
            args.signal?.removeEventListener('abort', abort);
            if (tracker.limited) throw new Error('Runtime step or tool-error retry limit reached');
            if (turn.state === 'SUPERSEDED') {
              events.resolvedModelRef = descriptor.ref;
              result = events.finish(turn.output, 'ABORTED');
              break;
            }
            if (turn.state !== 'DONE') throw turn.error || new Error(turn.output || 'Agent did not complete');
            events.resolvedModelRef = descriptor.ref;
            result = events.finish(turn.output);
            break;
          } catch (error) {
            await entry.session.waitForIdle();
            if (directRealtimeAudio || descriptor.chatgpt_plan || index + 1 >= chain.length || events.hasOutput || events.hasTools
              || alreadyRunning || args.signal?.aborted || !isRetryableModelError(error)) throw error;
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
        unsubscribe.forEach((off) => off?.());
      }
      await sessions.finish(sessionId, result, events.events);
      return result;
    }
  };
  return runtime;
}

module.exports = { createPiRuntime, imageParts, sameModel, modelWithImages };
