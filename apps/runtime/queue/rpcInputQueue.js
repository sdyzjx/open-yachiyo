const { validateRpcRequest } = require('../rpc/jsonRpc');
const { publishChainEvent } = require('../bus/chainDebug');

class RpcInputQueue {
  constructor({ maxSize = 2000, bus = null } = {}) {
    this.maxSize = maxSize;
    this.bus = bus;
    this.items = [];
    this.waiters = [];
    this.submitListeners = new Set();
  }

  size() {
    return this.items.length;
  }

  onSubmit(listener) {
    if (typeof listener !== 'function') return () => {};
    this.submitListeners.add(listener);
    return () => this.submitListeners.delete(listener);
  }

  async submit(payload, context = {}) {
    const parsed = validateRpcRequest(payload);
    if (!parsed.ok) {
      publishChainEvent(this.bus, 'queue.submit.rejected', {
        reason: 'invalid_rpc',
        error_code: parsed.error?.error?.code ?? null
      });
      return { accepted: false, response: parsed.error };
    }

    if (this.items.length >= this.maxSize) {
      publishChainEvent(this.bus, 'queue.submit.rejected', {
        reason: 'queue_full',
        request_id: parsed.request.id ?? null,
        queue_size: this.items.length,
        max_size: this.maxSize
      });
      return {
        accepted: false,
        response: {
          jsonrpc: '2.0',
          id: parsed.request.id ?? null,
          error: { code: -32001, message: 'Input queue is full' }
        }
      };
    }

    const envelope = {
      request: parsed.request,
      context,
      accepted_at: Date.now()
    };

    for (const listener of this.submitListeners) {
      try { listener(envelope); } catch { /* queue admission must stay reliable */ }
    }

    if (this.waiters.length > 0) {
      const waiter = this.waiters.shift();
      waiter(envelope);
      publishChainEvent(this.bus, 'queue.submit.accepted', {
        request_id: parsed.request.id ?? null,
        method: parsed.request.method,
        queue_size: this.items.length,
        mode: 'direct_to_waiter'
      });
    } else {
      this.items.push(envelope);
      publishChainEvent(this.bus, 'queue.submit.accepted', {
        request_id: parsed.request.id ?? null,
        method: parsed.request.method,
        queue_size: this.items.length,
        mode: 'queued'
      });
    }

    return { accepted: true };
  }

  async pop() {
    if (this.items.length > 0) {
      const envelope = this.items.shift();
      publishChainEvent(this.bus, 'queue.pop.dequeued', {
        request_id: envelope?.request?.id ?? null,
        method: envelope?.request?.method || null,
        queue_size: this.items.length
      });
      return envelope;
    }

    return new Promise((resolve) => {
      this.waiters.push(resolve);
    });
  }
}

module.exports = { RpcInputQueue };
