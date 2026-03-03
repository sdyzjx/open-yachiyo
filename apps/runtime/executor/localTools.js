function getTime() {
  return new Date().toLocaleString('zh-CN', { hour12: false });
}

function add({ a, b }) {
  const x = Number(a);
  const y = Number(b);
  if (Number.isNaN(x) || Number.isNaN(y)) throw new Error('a/b 必须是数字');
  return String(x + y);
}

function echo({ text }) {
  return `echo: ${text || ''}`;
}

function createMemoryWriteTool(memoryStore) {
  return {
    type: 'local',
    description: 'Write a durable long-term memory entry. Use for stable preferences/facts only.',
    side_effect_level: 'write',
    requires_lock: true,
    input_schema: {
      type: 'object',
      properties: {
        content: { type: 'string' },
        keywords: {
          type: 'array',
          items: { type: 'string' }
        }
      },
      required: ['content'],
      additionalProperties: false
    },
    run: async ({ content, keywords = [] }, context = {}) => {
      if (!memoryStore) {
        throw new Error('long-term memory store not configured');
      }
      const entry = await memoryStore.addEntry({
        content,
        keywords,
        source_session_id: context.session_id || null,
        source_trace_id: context.trace_id || null,
        metadata: { step_index: context.step_index || null }
      });
      return JSON.stringify({
        ok: true,
        id: entry.id,
        content: entry.content,
        keywords: entry.keywords
      });
    }
  };
}

function createMemorySearchTool(memoryStore) {
  return {
    type: 'local',
    description: 'Search long-term memory by keywords. Use before answering questions about past facts/preferences.',
    side_effect_level: 'read',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        limit: { type: 'number' }
      },
      required: ['query'],
      additionalProperties: false
    },
    run: async ({ query, limit = 5 }) => {
      if (!memoryStore) {
        throw new Error('long-term memory store not configured');
      }
      const result = await memoryStore.searchEntries({
        query,
        limit: Math.max(1, Math.min(Number(limit) || 5, 20))
      });
      return JSON.stringify({
        ok: true,
        total: result.total,
        items: result.items.map((item) => ({
          id: item.id,
          content: item.content,
          keywords: item.keywords,
          updated_at: item.updated_at
        }))
      });
    }
  };
}

function createLocalTools({ memoryStore } = {}) {
  return {
    get_time: {
      type: 'local',
      description: 'Get local current date-time string in zh-CN locale.',
      side_effect_level: 'none',
      input_schema: { type: 'object', properties: {}, additionalProperties: false },
      run: () => getTime()
    },
    add: {
      type: 'local',
      description: 'Add two numbers and return the sum.',
      side_effect_level: 'none',
      input_schema: {
        type: 'object',
        properties: {
          a: { type: 'number' },
          b: { type: 'number' }
        },
        required: ['a', 'b'],
        additionalProperties: false
      },
      run: add
    },
    echo: {
      type: 'local',
      description: 'Echo user input text back to user.',
      side_effect_level: 'none',
      input_schema: {
        type: 'object',
        properties: {
          text: { type: 'string' }
        },
        required: ['text'],
        additionalProperties: false
      },
      run: echo
    },
    memory_write: createMemoryWriteTool(memoryStore),
    memory_search: createMemorySearchTool(memoryStore)
  };
}

module.exports = createLocalTools();
module.exports.createLocalTools = createLocalTools;
