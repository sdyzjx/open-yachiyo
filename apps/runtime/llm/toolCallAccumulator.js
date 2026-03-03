function parseArgsStrict(raw) {
  const source = String(raw || '');
  if (!source.trim()) return {};
  return JSON.parse(source);
}

class ToolCallAccumulator {
  constructor({
    onDelta = null,
    onStable = null,
    onParseError = null
  } = {}) {
    this.onDelta = typeof onDelta === 'function' ? onDelta : null;
    this.onStable = typeof onStable === 'function' ? onStable : null;
    this.onParseError = typeof onParseError === 'function' ? onParseError : null;
    this.calls = new Map();
  }

  ensureEntry(index) {
    const key = Number.isFinite(Number(index)) ? Number(index) : 0;
    if (!this.calls.has(key)) {
      this.calls.set(key, {
        index: key,
        call_id: '',
        name: '',
        args_raw: '',
        stable_signature: ''
      });
    }
    return this.calls.get(key);
  }

  safeEmit(callback, payload) {
    if (typeof callback !== 'function') return;
    try {
      callback(payload);
    } catch {
      // Ignore callback errors to keep accumulation resilient.
    }
  }

  append(toolCallDelta) {
    const index = Number.isFinite(Number(toolCallDelta?.index)) ? Number(toolCallDelta.index) : 0;
    const entry = this.ensureEntry(index);

    if (typeof toolCallDelta?.id === 'string' && toolCallDelta.id) {
      entry.call_id = toolCallDelta.id;
    }
    const nameDelta = toolCallDelta?.function?.name;
    if (typeof nameDelta === 'string' && nameDelta) {
      entry.name += nameDelta;
    }
    const argsDelta = toolCallDelta?.function?.arguments;
    if (typeof argsDelta === 'string' && argsDelta) {
      entry.args_raw += argsDelta;
    }

    this.safeEmit(this.onDelta, {
      index: entry.index,
      call_id: entry.call_id || null,
      name: entry.name || null,
      args_raw: entry.args_raw,
      args_delta: typeof argsDelta === 'string' ? argsDelta : '',
      name_delta: typeof nameDelta === 'string' ? nameDelta : ''
    });
    this.tryEmitStable(entry);
  }

  tryEmitStable(entry) {
    let parsedArgs = null;
    try {
      parsedArgs = parseArgsStrict(entry.args_raw);
    } catch {
      return;
    }
    const signature = JSON.stringify({
      call_id: entry.call_id || null,
      name: entry.name || null,
      args: parsedArgs
    });
    if (signature === entry.stable_signature) {
      return;
    }
    entry.stable_signature = signature;
    this.safeEmit(this.onStable, {
      index: entry.index,
      call_id: entry.call_id || null,
      name: entry.name || null,
      args_raw: entry.args_raw,
      args: parsedArgs
    });
  }

  finalize() {
    const toolCalls = [];
    const parseErrors = [];

    const ordered = Array.from(this.calls.values()).sort((a, b) => a.index - b.index);
    for (let i = 0; i < ordered.length; i += 1) {
      const entry = ordered[i];
      let args = {};
      try {
        args = parseArgsStrict(entry.args_raw);
      } catch (err) {
        const errorPayload = {
          index: entry.index,
          call_id: entry.call_id || null,
          name: entry.name || null,
          args_raw: entry.args_raw,
          parse_reason: err?.message || String(err || 'invalid tool args json')
        };
        parseErrors.push(errorPayload);
        this.safeEmit(this.onParseError, errorPayload);
        continue;
      }

      toolCalls.push({
        call_id: entry.call_id || `call_stream_${i + 1}`,
        name: entry.name || 'unknown_tool',
        args,
        args_raw: entry.args_raw,
        index: entry.index
      });
    }

    return {
      toolCalls,
      parseErrors
    };
  }
}

module.exports = {
  ToolCallAccumulator
};
