const { buildRpcError } = require('./rpcValidator');

const DESKTOP_TOOL_DEFINITIONS = Object.freeze([
  {
    name: 'desktop_perception_capabilities',
    method: 'desktop.perception.capabilities',
    description: 'Report desktop capture capabilities and whether screen capture is currently available.',
    input_schema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'desktop_displays_list',
    method: 'desktop.perception.displays.list',
    description: 'List desktop displays and their bounds for screen capture planning.',
    input_schema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'desktop_windows_list',
    method: 'desktop.perception.windows.list',
    description: 'List capturable desktop windows and their source identifiers for window-oriented capture.',
    input_schema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'desktop_capture_screen',
    method: 'desktop.capture.screen',
    description: 'Capture a full desktop display into a temporary image record.',
    input_schema: {
      type: 'object',
      properties: {
        displayId: { anyOf: [{ type: 'integer' }, { type: 'string' }] },
        display_id: { anyOf: [{ type: 'integer' }, { type: 'string' }] }
      }
    }
  },
  {
    name: 'desktop_capture_region',
    method: 'desktop.capture.region',
    description: 'Capture one rectangular desktop region into a temporary image record.',
    input_schema: {
      type: 'object',
      required: ['x', 'y', 'width', 'height'],
      properties: {
        x: { type: 'integer' },
        y: { type: 'integer' },
        width: { type: 'integer' },
        height: { type: 'integer' },
        displayId: { anyOf: [{ type: 'integer' }, { type: 'string' }] },
        display_id: { anyOf: [{ type: 'integer' }, { type: 'string' }] }
      }
    }
  },
  {
    name: 'desktop_capture_window',
    method: 'desktop.capture.window',
    description: 'Capture one desktop window into a temporary image record by source id or title.',
    input_schema: {
      type: 'object',
      properties: {
        sourceId: { type: 'string' },
        source_id: { type: 'string' },
        title: { type: 'string' },
        windowTitle: { type: 'string' },
        window_title: { type: 'string' }
      }
    }
  },
  {
    name: 'desktop_chat_show',
    method: 'chat.bubble.show',
    description: 'Show transient bubble text above the desktop model.',
    input_schema: {
      type: 'object',
      required: ['text'],
      properties: {
        text: { type: 'string' },
        durationMs: { type: 'integer' },
        mood: { type: 'string' }
      }
    }
  },
  {
    name: 'desktop_chat_panel_append',
    method: 'chat.panel.append',
    description: 'Append one message item into desktop chat panel history.',
    input_schema: {
      type: 'object',
      required: ['text'],
      properties: {
        role: { type: 'string' },
        text: { type: 'string' },
        timestamp: { type: 'integer' },
        requestId: { type: 'string' }
      }
    }
  },
  {
    name: 'desktop_model_set_param',
    method: 'model.param.set',
    description: 'Set one Live2D parameter value.',
    input_schema: {
      type: 'object',
      required: ['name', 'value'],
      properties: {
        name: { type: 'string' },
        value: { type: 'number' }
      }
    }
  },
  {
    name: 'desktop_model_batch_set',
    method: 'model.param.batchSet',
    description: 'Set multiple Live2D parameter values in one call.',
    input_schema: {
      type: 'object',
      required: ['updates'],
      properties: {
        updates: {
          type: 'array',
          items: {
            type: 'object',
            required: ['name', 'value'],
            properties: {
              name: { type: 'string' },
              value: { type: 'number' }
            }
          }
        }
      }
    }
  },
  {
    name: 'desktop_model_play_motion',
    method: 'model.motion.play',
    description: 'Play one Live2D motion group/index.',
    input_schema: {
      type: 'object',
      required: ['group'],
      properties: {
        group: { type: 'string' },
        index: { type: 'integer' }
      }
    }
  },
  {
    name: 'desktop_model_set_expression',
    method: 'model.expression.set',
    description: 'Set one Live2D expression by name.',
    input_schema: {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string' }
      }
    }
  }
]);

const TOOL_NAME_TO_METHOD = new Map(DESKTOP_TOOL_DEFINITIONS.map((item) => [item.name, item.method]));

function listDesktopTools() {
  return DESKTOP_TOOL_DEFINITIONS.map((item) => ({ ...item }));
}

function resolveToolInvoke({ name, args } = {}) {
  const normalizedName = String(name || '').trim();
  if (!normalizedName) {
    throw buildRpcError(-32602, 'tool.invoke requires non-empty name');
  }

  const method = TOOL_NAME_TO_METHOD.get(normalizedName);
  if (!method) {
    throw buildRpcError(-32006, `tool is not allowed: ${normalizedName}`);
  }

  const params = args && typeof args === 'object' && !Array.isArray(args) ? args : {};
  return {
    toolName: normalizedName,
    method,
    params
  };
}

module.exports = {
  DESKTOP_TOOL_DEFINITIONS,
  listDesktopTools,
  resolveToolInvoke
};
