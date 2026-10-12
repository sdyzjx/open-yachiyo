// Tries a chain of reasoners in order. Switches to the next model only for transient
// failures (error.retriable: network / 408 / 409 / 429 / 5xx) and only if the failing
// attempt has not already streamed text to the consumer (switching would duplicate it).
class FallbackReasoner {
  constructor({ chain, onFallback = null }) {
    if (!Array.isArray(chain) || chain.length === 0) {
      throw new Error('FallbackReasoner requires a non-empty chain');
    }
    this.chain = chain; // [{ ref, reasoner }]
    this.onFallback = onFallback;
    this.lastUsedRef = null;
  }

  notify(index, error) {
    if (typeof this.onFallback !== 'function') return;
    try {
      this.onFallback({
        from: this.chain[index].ref,
        to: this.chain[index + 1].ref,
        error: String(error?.message || error),
        status: error?.status ?? null
      });
    } catch {
      // Observers must not break the request.
    }
  }

  async run(method, args) {
    let lastError = null;
    for (let i = 0; i < this.chain.length; i += 1) {
      const { ref, reasoner } = this.chain[i];
      let streamed = false;
      const callArgs = method === 'decideStream' && typeof args.onDelta === 'function'
        ? { ...args, onDelta: (d) => { streamed = true; args.onDelta(d); } }
        : (method === 'decideStream'
          ? { ...args, onDelta: () => { streamed = true; } }
          : args);
      try {
        const result = await reasoner[method](callArgs);
        this.lastUsedRef = ref;
        return result;
      } catch (err) {
        lastError = err;
        const canSwitch = err?.retriable === true && !streamed && i < this.chain.length - 1;
        if (!canSwitch) throw err;
        this.notify(i, err);
      }
    }
    throw lastError;
  }

  decide(args) {
    return this.run('decide', args);
  }

  decideStream(args) {
    return this.run('decideStream', args);
  }
}

module.exports = { FallbackReasoner };
