const { ToolingError } = require('../tooling/errors');
const { ToolExecutor } = require('../executor/toolExecutor');
const { bridgeTools } = require('./toolBridge');

const EMPTY_SCHEMA = { type: 'object', properties: {}, additionalProperties: false };

class DeviceTools {
  constructor({ deviceHub, bus, avatar, policy, timeoutMs = 8000 }) {
    this.hub = deviceHub;
    this.bus = bus;
    this.avatar = avatar;
    this.policy = policy;
    this.timeoutMs = timeoutMs;
    this.dirty = true;
    this.methods = [];
    this.changed = () => { this.dirty = true; };
    deviceHub?.on?.('tools.changed', this.changed);
  }

  snapshot(context, reservedNames = []) {
    if (this.dirty) {
      this.methods = (this.hub?.listToolMethods() || []).map((method) => ({ ...method }));
      this.dirty = false;
    }
    const definitions = new Map();
    const add = (name, description, input_schema, run) => {
      if (definitions.has(name) || reservedNames.includes(name)) throw new Error(`Duplicate tool name: ${name}`);
      definitions.set(name, { name, description, input_schema, run: async (...args) => {
        try { return await run(...args); } catch (error) {
          if (error.code !== undefined) throw new ToolingError(error.code, error.message, error.data || error.details);
          throw error;
        }
      } });
    };
    add('bus_publish', 'Publish a plugin, avatar, ui or task event', {
      type: 'object', properties: { topic: { type: 'string', pattern: '^(plugin|avatar|ui|task)\\..+' }, data: { type: 'object' } },
      required: ['topic', 'data'], additionalProperties: false
    }, (args, ctx) => {
      ctx.publishEvent(args.topic, args.data);
      return JSON.stringify({ published: true, topic: args.topic });
    });
    add('avatar_status', 'Get current avatar host and devices', EMPTY_SCHEMA, async () => JSON.stringify(
      this.avatar?.status ? await this.avatar.status() : { host: this.hub?.getAvatarHost?.() || 'desktop', devices: this.hub?.listDevices?.() || [] }
    ));
    add('avatar_transfer', 'Transfer avatar to desktop or an online device', {
      type: 'object', properties: { to: { type: 'string', minLength: 1 } }, required: ['to'], additionalProperties: false
    }, async ({ to }) => {
      const transfer = this.avatar?.transfer
        || (this.hub?.requestAvatarTransfer ? (target) => this.hub.requestAvatarTransfer(target, { reason: 'agent' }) : null);
      if (!transfer) {
        const error = new Error('Avatar transfer controller is not configured');
        error.code = -32601;
        throw error;
      }
      return JSON.stringify(await transfer(to));
    });
    for (const method of this.methods) {
      add(method.tool_name, method.description || method.method, method.params_schema || EMPTY_SCHEMA, async (params) => {
        const result = await this.hub.invoke(method.device_id, method.method, params, { timeoutMs: this.timeoutMs });
        return typeof result === 'string' ? result : JSON.stringify(result);
      });
    }
    const registry = { list: () => [...definitions.values()], get: (name) => definitions.get(name) };
    return bridgeTools({ executor: new ToolExecutor(registry, { policy: this.policy }), bus: this.bus, context });
  }

  dispose() {
    this.hub?.off?.('tools.changed', this.changed);
  }
}

module.exports = { DeviceTools };
