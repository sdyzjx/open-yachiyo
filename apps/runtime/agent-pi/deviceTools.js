const { ToolingError } = require('../tooling/errors');
const { ToolExecutor } = require('../executor/toolExecutor');
const { bridgeTools } = require('./toolBridge');

const EMPTY_SCHEMA = { type: 'object', properties: {}, additionalProperties: false };

function matchesPattern(name, pattern) {
  if (typeof pattern !== 'string' || !pattern) return false;
  const source = pattern.split('*').map((part) => part.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')).join('.*');
  return new RegExp(`^${source}$`).test(name);
}

function filterHubMethods(methods, policy = {}) {
  const config = policy.deviceHub || {};
  const allow = Array.isArray(config.allow) ? config.allow : [];
  const deny = Array.isArray(config.deny) ? config.deny : [];
  if (!allow.length) return [];
  return methods.filter((method) => {
    const name = method?.tool_name;
    return typeof name === 'string'
      && !deny.some((pattern) => matchesPattern(name, pattern))
      && allow.some((pattern) => matchesPattern(name, pattern));
  });
}

function withAllowedHubTools(policy = {}, names = []) {
  const allow = Array.isArray(policy.allow) ? policy.allow : [];
  return allow.length ? { ...policy, allow: [...new Set([...allow, ...names])] } : policy;
}

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

  snapshot(context, reservedNames = [], onlineNames) {
    if (this.dirty) {
      this.methods = filterHubMethods(this.hub?.listToolMethods() || [], this.policy).map((method) => ({ ...method }));
      this.dirty = false;
    }
    const definitions = new Map();
    const add = (name, description, input_schema, scheduling, run) => {
      if (definitions.has(name) || reservedNames.includes(name)) throw new Error(`Duplicate tool name: ${name}`);
      definitions.set(name, { name, description, input_schema, ...scheduling, run: async (...args) => {
        try { return await run(...args); } catch (error) {
          if (error.code !== undefined) throw new ToolingError(error.code, error.message, error.data || error.details);
          throw error;
        }
      } });
    };
    add('avatar_status', 'Get current avatar host and devices', EMPTY_SCHEMA,
      { side_effect_level: 'read', requires_lock: false }, async () => JSON.stringify(
      this.avatar?.status ? await this.avatar.status() : { host: this.hub?.getAvatarHost?.() || 'desktop', devices: this.hub?.listDevices?.() || [] }
    ));
    add('avatar_transfer', 'Transfer avatar to desktop or an online device', {
      type: 'object', properties: { to: { type: 'string', minLength: 1 } }, required: ['to'], additionalProperties: false
    }, { side_effect_level: 'write', requires_lock: true }, async ({ to }) => {
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
      add(method.tool_name, method.description || method.method, method.params_schema || EMPTY_SCHEMA, {
        side_effect_level: method.side_effect_level || null,
        requires_lock: method.requires_lock !== false
      }, async (params) => {
        const result = await this.hub.invoke(method.device_id, method.method, params, { timeoutMs: this.timeoutMs });
        return typeof result === 'string' ? result : JSON.stringify(result);
      });
    }
    const registry = { list: () => [...definitions.values()], get: (name) => definitions.get(name) };
    const policy = withAllowedHubTools(this.policy, this.methods.map((method) => method.tool_name));
    return bridgeTools({ executor: new ToolExecutor(registry, { policy }), bus: this.bus, context, onlineNames });
  }

  dispose() {
    this.hub?.off?.('tools.changed', this.changed);
  }
}

module.exports = { DeviceTools, matchesPattern, filterHubMethods, withAllowedHubTools };
