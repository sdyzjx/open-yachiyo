const { loadModelCatalog } = require('../../runtime/config/modelCatalog');
const { realtimeUrl } = require('../../runtime/agent-pi/qwenRealtimeAdapter');

function modelAvailability(model) {
  if (model.chatgpt_plan) return { available: true, reason: null };
  if (!model.api_key) return { available: false, reason: `No API key for provider ${model.provider}` };
  if (model.transport === 'realtime') {
    try { realtimeUrl(model); } catch (error) { return { available: false, reason: error.message }; }
  }
  return { available: true, reason: null };
}

function attachModelControl({ hub, llmManager }) {
  if (!hub || !llmManager) return null;

  const getCatalog = () => {
    const catalog = loadModelCatalog({ store: llmManager.store });
    const enabledRefs = new Set(catalog.enabled.map((model) => model.ref));
    return {
      active: catalog.active?.ref || null,
      models: catalog.enabled.map((model) => ({
        ref: model.ref,
        provider: model.provider,
        id: model.id,
        name: model.name,
        input: [...model.input],
        output: [...model.output],
        transport: model.transport,
        audio: model.audio ? {
          mode: model.audio.mode || null,
          input_format: model.audio.input_format || null,
          input_sample_rate: Number(model.audio.input_sample_rate) || null,
          output_format: model.audio.output_format || null,
          output_sample_rate: Number(model.audio.output_sample_rate) || null
        } : null,
        enabled: enabledRefs.has(model.ref),
        ...modelAvailability(model)
      }))
    };
  };

  hub.methods.set('model.catalog.get', getCatalog);
  hub.once('shutdown', () => hub.methods.delete('model.catalog.get'));
  return { getCatalog };
}

module.exports = { attachModelControl, modelAvailability };
