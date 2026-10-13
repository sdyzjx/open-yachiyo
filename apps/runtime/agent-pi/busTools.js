const { ToolExecutor } = require('../executor/toolExecutor');
const { bridgeTools } = require('./toolBridge');

function definitions(subscriptions) {
  return [
    {
      name: 'bus.publish',
      description: 'Publish an event to an allowed Yachiyo event-bus topic',
      side_effect_level: 'write',
      requires_lock: false,
      input_schema: {
        type: 'object',
        properties: {
          topic: { type: 'string', pattern: '^(plugin|avatar|ui|task)\\..+' },
          data: { type: 'object' }
        },
        required: ['topic', 'data'],
        additionalProperties: false
      },
      run(args, context) {
        context.publishEvent(args.topic, args.data);
        return JSON.stringify({ published: true, topic: args.topic });
      }
    },
    {
      name: 'bus.subscribe',
      description: 'Subscribe this agent session to a bounded event-bus queue',
      side_effect_level: 'write',
      requires_lock: false,
      input_schema: {
        type: 'object',
        properties: {
          pattern: { type: 'string', minLength: 3 },
          delivery: { type: 'string', enum: ['pull', 'steer'] },
          priority: { type: 'string', enum: ['normal', 'high'] },
          ttl_ms: { type: 'integer', minimum: 1000, maximum: 3600000 },
          max_queue: { type: 'integer', minimum: 1, maximum: 512 },
          include_self: { type: 'boolean' }
        },
        required: ['pattern'],
        additionalProperties: false
      },
      run: (args) => JSON.stringify(subscriptions.subscribe(args))
    },
    {
      name: 'bus.unsubscribe',
      description: 'Remove one event-bus subscription owned by this agent session',
      side_effect_level: 'write',
      requires_lock: false,
      input_schema: {
        type: 'object',
        properties: { subscription_id: { type: 'string', minLength: 1 } },
        required: ['subscription_id'],
        additionalProperties: false
      },
      run: ({ subscription_id: id }) => JSON.stringify({ subscription_id: id, removed: subscriptions.unsubscribe(id) })
    },
    {
      name: 'bus.events.pull',
      description: 'Pull queued events for this agent session using a monotonic cursor',
      side_effect_level: 'read',
      requires_lock: false,
      input_schema: {
        type: 'object',
        properties: {
          after_cursor: { type: 'integer', minimum: 0 },
          limit: { type: 'integer', minimum: 1, maximum: 100 },
          acknowledge: { type: 'boolean' }
        },
        additionalProperties: false
      },
      run: (args) => JSON.stringify(subscriptions.pull(args))
    },
    {
      name: 'bus.channels.list',
      description: 'List this session subscriptions and observed allowed event-bus channels',
      side_effect_level: 'read',
      requires_lock: false,
      input_schema: { type: 'object', properties: {}, additionalProperties: false },
      run: () => JSON.stringify(subscriptions.listChannels())
    }
  ];
}

function createBusTools({ subscriptions, bus, policy, context, onlineNames }) {
  const list = definitions(subscriptions);
  const map = new Map(list.map((definition) => [definition.name, definition]));
  return bridgeTools({
    executor: new ToolExecutor({ list: () => list, get: (name) => map.get(name) }, { policy }),
    bus,
    context,
    onlineNames
  });
}

module.exports = { createBusTools, definitions };
