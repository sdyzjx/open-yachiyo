const path = require('node:path');
const { loadPi } = require('./loadPi');
const { createModelRuntime, selectModels, isRetryableModelError } = require('./modelAdapter');
const { bridgeTools } = require('./toolBridge');
const { DeviceTools } = require('./deviceTools');
const { buildPrompt } = require('./promptBuilder');
const { SessionBridge } = require('./sessionBridge');
const { createResourceLoader } = require('./skillBridge');
const { EventBridge, contentText } = require('./eventBridge');

function imageParts(images) {
  return images.map((image) => {
    const match = /^data:(image\/[\w.+-]+);base64,([\s\S]+)$/.exec(image.data_url || '');
    if (!match) throw new Error('Invalid image data URL');
    return { type: 'image', mimeType: match[1], data: match[2].replace(/\s/g, '') };
  });
}

async function createPiRuntime(deps) {
  const { sdk } = await loadPi();
  const sessions = deps.sessionBridge || new SessionBridge({ rootDir: deps.sessionDir, sessionStore: deps.sessionStore,
    mirrorHistory: deps.mirrorHistory !== false, compaction: deps.compaction });
  const streaming = deps.runtimeStreamingEnabled !== false;
  const maxStep = deps.maxStep || 128;
  const toolErrorMaxRetries = deps.toolErrorMaxRetries || 5;
  return {
    runtimeStreamingEnabled: streaming, toolAsyncMode: 'serial', toolEarlyDispatch: false, maxParallelTools: 1, toolErrorMaxRetries,
    async run(args) {
      return sessions.withSession(args.sessionId, async () => {
        const { sessionId, onEvent, seedMessages = [] } = args;
        const runtimeContext = { ...args.runtimeContext };
        if (args.permissionLevel) runtimeContext.permission_level = args.permissionLevel;
        const events = new EventBridge({ bus: deps.bus, sessionId, onEvent, streaming });
        const unsubscribe = ['voice.playback.electron', 'tool.call.progress'].map((topic) => deps.bus?.subscribe(topic, (payload) => {
          if (!payload.session_id || payload.session_id === sessionId) events.emit(topic === 'tool.call.progress' ? 'tool.progress' : topic, payload);
        }));
        let session;
        let devices;
        let catalog;
        let input = args.input || '';
        let result;
        try {
          const inputAudio = args.inputAudio || runtimeContext.input_audio;
          if (!input.trim() && inputAudio) {
            const transcription = inputAudio.transcribed_text
              ? { text: inputAudio.transcribed_text }
              : await deps.transcribeAudio?.({ session_id: sessionId, input_audio: inputAudio, runtime_context: runtimeContext });
            input = transcription?.text || '';
          }
          const images = imageParts(args.inputImages || []);
          if (!input.trim() && !images.length) throw new Error('Input is empty after audio transcription');
          catalog = typeof deps.modelCatalog === 'function' ? await deps.modelCatalog() : deps.modelCatalog;
          const settings = await deps.sessionStore?.getSessionSettings(sessionId);
          const chain = selectModels(catalog, args.model_ref || args.modelRef || runtimeContext.model_ref || settings?.model_ref);
          const models = await createModelRuntime(catalog);
          const cwd = runtimeContext.workspace_root || deps.cwd || process.cwd();
          const context = () => ({ ...runtimeContext, trace_id: events.traceId, session_id: sessionId, step_index: events.step });
          const localTools = bridgeTools({ executor: deps.executor, bus: deps.bus, context });
          devices = new DeviceTools({ deviceHub: typeof deps.deviceHub === 'function' ? deps.deviceHub() : deps.deviceHub,
            bus: deps.bus, avatar: deps.avatar, policy: deps.executor.policy });
          const tools = [...localTools, ...devices.snapshot(context, localTools.map((tool) => tool.name))];
          const opened = await sessions.open({ sessionId, cwd, seedMessages, model: chain[0] });
          const { systemPrompt, persona, skills } = await buildPrompt({ ...deps, sessionId, input, tools, runtimeContext,
            seedMessages: opened.systemSeeds, toolErrorMaxRetries });
          const loader = await createResourceLoader({ cwd: deps.cwd || process.cwd(), agentDir: path.join(sessions.rootDir, '.agent'),
            settingsManager: opened.settingsManager, systemPrompt, skillConfigStore: deps.skillConfigStore });
          await sessions.start(sessionId, input, { permission_level: runtimeContext.permission_level, input_audio: inputAudio || null });
          deps.bus?.publish('runtime.start', { session_id: sessionId, trace_id: events.traceId });
          events.emit('plan', { input, input_images: images.length, max_step: maxStep, context_messages: seedMessages.length,
            persona_mode: persona?.mode || null, skills_selected: skills?.selected?.length || loader.getSkills().skills.length,
            skills_clipped_by: skills?.clippedBy || null,
            runtime_flags: { streaming_enabled: streaming, tool_async_mode: 'serial', tool_early_dispatch: false, max_parallel_tools: 1, tool_error_max_retries: toolErrorMaxRetries } });
          events.emit('llm.prompt.assembled', { message_count: 1, messages: [{ role: 'system', content: systemPrompt }] });
          let failures = 0;
          for (let index = 0; index < chain.length; index += 1) {
            let model = models.getModel(chain[index].provider, chain[index].id);
            // v1 catalog metadata defaults to text-only; preserve explicit user image input.
            if (images.length || tools.some((tool) => tool.name.startsWith('desktop.capture.'))) model = { ...model, input: ['text', 'image'] };
            const startLeaf = opened.manager.getLeafId();
            let limited = false;
            ({ session } = await sdk.createAgentSession({ cwd, agentDir: path.join(sessions.rootDir, '.agent'), modelRuntime: models, model,
              thinkingLevel: model.reasoning ? 'medium' : 'off', resourceLoader: loader, sessionManager: opened.manager,
              settingsManager: opened.settingsManager, noTools: 'builtin', tools: tools.map((tool) => tool.name), customTools: tools }));
            session.subscribe((event) => {
              events.accept(event);
              if (event.type === 'tool_execution_end') {
                if (event.isError) failures += 1;
                else if (event.toolName.startsWith('live2d.') || event.toolName === 'voice.tts_aliyun_vc') {
                  session.setActiveToolsByName(session.getActiveToolNames().filter((name) =>
                    event.toolName.startsWith('live2d.') ? !name.startsWith('live2d.') : name !== event.toolName));
                }
              }
              if (events.step > maxStep || failures > toolErrorMaxRetries) {
                limited = true;
                void session.abort();
              }
            });
            const abort = () => { void session.abort(); };
            args.signal?.addEventListener('abort', abort, { once: true });
            try {
              args.signal?.throwIfAborted();
              await session.prompt(input, { images });
              const last = [...session.messages].reverse().find((message) => message.role === 'assistant');
              if (limited) throw new Error('Runtime step or tool-error retry limit reached');
              if (!last || ['error', 'aborted'].includes(last.stopReason)) throw new Error(last?.errorMessage || 'Agent did not complete');
              result = events.finish(contentText(last.content));
              break;
            } catch (error) {
              if (index + 1 >= chain.length || events.hasOutput || events.hasTools || args.signal?.aborted || !isRetryableModelError(error)) throw error;
              session.dispose();
              session = null;
              if (startLeaf) opened.manager.branch(startLeaf); else opened.manager.resetLeaf();
              events.emit('llm.fallback', { from: chain[index].ref, to: chain[index + 1].ref });
            } finally {
              args.signal?.removeEventListener('abort', abort);
              session?.dispose();
              session = null;
            }
          }
        } catch (error) {
          let message = String(error?.message || error);
          for (const model of catalog?.models || []) if (model.api_key) message = message.split(model.api_key).join('[redacted]');
          events.emit('tool.error', { error: message });
          deps.bus?.publish('runtime.error', { session_id: sessionId, trace_id: events.traceId, error: message });
          result = events.finish(`运行错误：${message}`, 'ERROR');
        } finally {
          session?.dispose();
          devices?.dispose();
          unsubscribe.forEach((off) => off?.());
        }
        await sessions.finish(sessionId, result, events.events);
        return result;
      });
    }
  };
}

module.exports = { createPiRuntime, imageParts };
