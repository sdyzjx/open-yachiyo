const Ajv = require('ajv');

const { RPC_METHODS_V1 } = require('./constants');

const PARAM_SET_SCHEMA = {
  type: 'object',
  required: ['name', 'value'],
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 128 },
    value: { type: 'number' }
  }
};

const METHOD_SCHEMAS = Object.freeze({
  'state.get': {
    type: 'object',
    additionalProperties: false
  },
  'debug.mouthOverride.set': {
    type: 'object',
    required: ['enabled'],
    additionalProperties: false,
    properties: {
      enabled: { type: 'boolean' },
      mouthOpen: { type: 'number' },
      mouthForm: { type: 'number' }
    }
  },
  'param.set': PARAM_SET_SCHEMA,
  'model.param.set': PARAM_SET_SCHEMA,
  'model.param.batchSet': {
    type: 'object',
    required: ['updates'],
    additionalProperties: false,
    properties: {
      updates: {
        type: 'array',
        minItems: 1,
        maxItems: 60,
        items: PARAM_SET_SCHEMA
      }
    }
  },
  'model.motion.play': {
    type: 'object',
    required: ['group'],
    additionalProperties: false,
    properties: {
      group: { type: 'string', minLength: 1, maxLength: 128 },
      index: { type: 'integer', minimum: 0, maximum: 1024 }
    }
  },
  'model.expression.set': {
    type: 'object',
    required: ['name'],
    additionalProperties: false,
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 128 }
    }
  },
  'chat.show': {
    type: 'object',
    required: ['text'],
    additionalProperties: false,
    properties: {
      text: { type: 'string', minLength: 1, maxLength: 2000 },
      durationMs: { type: 'integer', minimum: 500, maximum: 30000 },
      mood: { type: 'string', minLength: 1, maxLength: 64 }
    }
  },
  'chat.bubble.show': {
    type: 'object',
    required: ['text'],
    additionalProperties: false,
    properties: {
      text: { type: 'string', minLength: 1, maxLength: 2000 },
      durationMs: { type: 'integer', minimum: 500, maximum: 30000 },
      mood: { type: 'string', minLength: 1, maxLength: 64 }
    }
  },
  'chat.panel.show': {
    type: 'object',
    additionalProperties: false
  },
  'chat.panel.hide': {
    type: 'object',
    additionalProperties: false
  },
  'chat.panel.clear': {
    type: 'object',
    additionalProperties: false
  },
  'desktop.perception.capabilities': {
    type: 'object',
    additionalProperties: false
  },
  'desktop.perception.permissions': {
    type: 'object',
    additionalProperties: false
  },
  'desktop.perception.displays.list': {
    type: 'object',
    additionalProperties: false
  },
  'desktop.perception.windows.list': {
    type: 'object',
    additionalProperties: false
  },
  'desktop.capture.desktop': {
    type: 'object',
    additionalProperties: false
  },
  'desktop.capture.screen': {
    type: 'object',
    additionalProperties: false,
    properties: {
      displayId: { anyOf: [{ type: 'integer' }, { type: 'string', minLength: 1, maxLength: 128 }] },
      display_id: { anyOf: [{ type: 'integer' }, { type: 'string', minLength: 1, maxLength: 128 }] }
    }
  },
  'desktop.capture.region': {
    type: 'object',
    required: ['x', 'y', 'width', 'height'],
    additionalProperties: false,
    properties: {
      x: { type: 'integer' },
      y: { type: 'integer' },
      width: { type: 'integer', minimum: 1 },
      height: { type: 'integer', minimum: 1 },
      displayId: { anyOf: [{ type: 'integer' }, { type: 'string', minLength: 1, maxLength: 128 }] },
      display_id: { anyOf: [{ type: 'integer' }, { type: 'string', minLength: 1, maxLength: 128 }] }
    }
  },
  'desktop.capture.window': {
    type: 'object',
    additionalProperties: false,
    properties: {
      sourceId: { type: 'string', minLength: 1, maxLength: 256 },
      source_id: { type: 'string', minLength: 1, maxLength: 256 },
      title: { type: 'string', minLength: 1, maxLength: 512 },
      windowTitle: { type: 'string', minLength: 1, maxLength: 512 },
      window_title: { type: 'string', minLength: 1, maxLength: 512 }
    },
    anyOf: [
      { required: ['sourceId'] },
      { required: ['source_id'] },
      { required: ['title'] },
      { required: ['windowTitle'] },
      { required: ['window_title'] }
    ]
  },
  'desktop.capture.get': {
    type: 'object',
    additionalProperties: false,
    properties: {
      captureId: { type: 'string', minLength: 1, maxLength: 128 },
      capture_id: { type: 'string', minLength: 1, maxLength: 128 }
    },
    anyOf: [
      { required: ['captureId'] },
      { required: ['capture_id'] }
    ]
  },
  'desktop.capture.delete': {
    type: 'object',
    additionalProperties: false,
    properties: {
      captureId: { type: 'string', minLength: 1, maxLength: 128 },
      capture_id: { type: 'string', minLength: 1, maxLength: 128 }
    },
    anyOf: [
      { required: ['captureId'] },
      { required: ['capture_id'] }
    ]
  },
  'chat.panel.append': {
    type: 'object',
    required: ['text'],
    additionalProperties: false,
    properties: {
      role: {
        type: 'string',
        enum: ['user', 'assistant', 'system', 'tool']
      },
      text: { type: 'string', minLength: 1, maxLength: 4000 },
      timestamp: { type: 'integer', minimum: 0 },
      requestId: { type: 'string', minLength: 1, maxLength: 128 }
    }
  },
  'tool.list': {
    type: 'object',
    additionalProperties: false
  },
  'tool.invoke': {
    type: 'object',
    required: ['name'],
    additionalProperties: false,
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 128 },
      arguments: { type: 'object', additionalProperties: true },
      traceId: { type: 'string', minLength: 1, maxLength: 128 }
    }
  }
});

const ajv = new Ajv({ allErrors: true, strict: false });
const validators = new Map(Object.entries(METHOD_SCHEMAS).map(([method, schema]) => [method, ajv.compile(schema)]));

function buildRpcError(code, message, data) {
  const error = { code, message };
  if (data !== undefined) {
    error.data = data;
  }
  return error;
}

function isValidRpcId(id) {
  return typeof id === 'string' || typeof id === 'number' || id === null;
}

function validateRpcRequest(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, error: buildRpcError(-32600, 'invalid request payload') };
  }

  if (payload.jsonrpc !== '2.0') {
    return { ok: false, error: buildRpcError(-32600, 'jsonrpc must be 2.0'), id: payload.id };
  }

  if (payload.id !== undefined && !isValidRpcId(payload.id)) {
    return { ok: false, error: buildRpcError(-32600, 'invalid id type'), id: payload.id };
  }

  const { method } = payload;
  if (typeof method !== 'string' || !method) {
    return { ok: false, error: buildRpcError(-32600, 'method must be a non-empty string'), id: payload.id };
  }

  if (!RPC_METHODS_V1.includes(method)) {
    return { ok: false, error: buildRpcError(-32601, `method not found: ${method}`), id: payload.id };
  }

  const params = payload.params == null ? {} : payload.params;
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    return { ok: false, error: buildRpcError(-32602, 'params must be an object'), id: payload.id };
  }

  const validate = validators.get(method);
  if (!validate(params)) {
    return {
      ok: false,
      error: buildRpcError(-32602, 'invalid params', validate.errors || []),
      id: payload.id
    };
  }

  return {
    ok: true,
    request: {
      id: payload.id,
      method,
      params
    }
  };
}

module.exports = {
  METHOD_SCHEMAS,
  validateRpcRequest,
  buildRpcError
};
