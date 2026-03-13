const builtin = require('./adapters/builtin');
const fsAdapters = require('./adapters/fs');
const shellAdapters = require('./adapters/shell');
const memoryAdapters = require('./adapters/memory');
const voiceAdapters = require('./adapters/voice');
const asrAdapters = require('./adapters/asr');
const live2dAdapters = require('./adapters/live2d');
const desktopPerceptionAdapters = require('./adapters/desktopPerception');
const desktopVisionAdapters = require('./adapters/desktopVision');
const desktopLocateAdapters = require('./adapters/desktopLocate');
const { ToolingError, ErrorCode } = require('./errors');

const ADAPTERS = {
  ...builtin,
  ...fsAdapters,
  ...shellAdapters,
  ...memoryAdapters,
  ...voiceAdapters,
  ...asrAdapters,
  ...live2dAdapters,
  ...desktopPerceptionAdapters,
  ...desktopVisionAdapters,
  ...desktopLocateAdapters
};

class ToolRegistry {
  constructor({ config }) {
    this.config = config;
    this.tools = new Map();

    for (const def of config.tools || []) {
      const run = ADAPTERS[def.adapter];
      if (!run) {
        throw new ToolingError(ErrorCode.CONFIG_ERROR, `adapter not found: ${def.adapter}`);
      }

      this.tools.set(def.name, {
        name: def.name,
        type: def.type || 'local',
        description: def.description || '',
        input_schema: def.input_schema,
        side_effect_level: def.side_effect_level || null,
        requires_lock: Boolean(def.requires_lock),
        run,
        adapter: def.adapter
      });
    }
  }

  get(name) {
    return this.tools.get(name) || null;
  }

  list() {
    return Array.from(this.tools.values()).map((tool) => ({
      name: tool.name,
      type: tool.type,
      description: tool.description,
      input_schema: tool.input_schema,
      side_effect_level: tool.side_effect_level || null,
      requires_lock: Boolean(tool.requires_lock)
    }));
  }
}

module.exports = { ToolRegistry };
