const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 300;
const { ToolCallAccumulator } = require('./toolCallAccumulator');

function parseToolArgs(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return { raw };
  }
}

function extractTextContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (!part || typeof part !== 'object') return '';
      if (typeof part.text === 'string') return part.text;
      if (part.type === 'text' && typeof part.text?.value === 'string') return part.text.value;
      return '';
    })
    .join('');
}

function normalizeToolCallsFromMessage(message) {
  return Array.isArray(message?.tool_calls)
    ? message.tool_calls
      .filter((tc) => tc?.function?.name)
      .map((tc) => ({
        call_id: tc.id || null,
        name: tc.function.name,
        args: parseToolArgs(tc.function.arguments)
      }))
    : [];
}

class OpenAIReasoner {
  constructor({
    apiKey,
    baseUrl = DEFAULT_BASE_URL,
    model = 'gpt-4o-mini',
    timeoutMs = 20000,
    maxRetries = DEFAULT_MAX_RETRIES,
    retryDelayMs = DEFAULT_RETRY_DELAY_MS
  } = {}) {
    if (!apiKey) {
      throw new Error('LLM_API_KEY is required for real LLM mode');
    }

    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.model = model;
    this.timeoutMs = timeoutMs;
    this.maxRetries = Math.max(0, Number(maxRetries) || 0);
    this.retryDelayMs = Math.max(0, Number(retryDelayMs) || 0);
  }

  buildPayload({ messages, tools, stream = false }) {
    const normalizedTools = Array.isArray(tools) ? tools : [];
    const payload = {
      model: this.model,
      temperature: 0.2,
      stream: Boolean(stream),
      messages
    };

    if (normalizedTools.length > 0) {
      payload.tool_choice = 'auto';
      payload.tools = normalizedTools.map((tool) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description || '',
          parameters: tool.input_schema || { type: 'object', properties: {}, additionalProperties: true }
        }
      }));
    }

    return payload;
  }

  buildDecisionFromAssistantMessage(message) {
    const toolCalls = normalizeToolCallsFromMessage(message);
    if (toolCalls.length > 0) {
      return {
        type: 'tool',
        assistantMessage: message,
        tool: toolCalls[0],
        tools: toolCalls
      };
    }

    const content = extractTextContent(message?.content);
    return {
      type: 'final',
      assistantMessage: message,
      output: content || '模型未返回文本输出。'
    };
  }

  isRetriableStatus(status) {
    return status === 408 || status === 409 || status === 429 || status >= 500;
  }

  isRetriableNetworkError(err) {
    const raw = String(err?.message || '').toLowerCase();
    const causeRaw = String(err?.cause?.message || '').toLowerCase();
    const merged = `${raw} ${causeRaw}`;
    return (
      err?.name === 'AbortError'
      || merged.includes('fetch failed')
      || merged.includes('network')
      || merged.includes('socket')
      || merged.includes('timeout')
      || merged.includes('econnreset')
      || merged.includes('econnrefused')
      || merged.includes('etimedout')
      || merged.includes('eai_again')
      || merged.includes('enotfound')
    );
  }

  async waitBeforeRetry(attempt) {
    if (this.retryDelayMs <= 0) return;
    const backoffMs = this.retryDelayMs * (attempt + 1);
    await new Promise((resolve) => setTimeout(resolve, backoffMs));
  }

  async decide({ messages, tools }) {
    const payload = this.buildPayload({ messages, tools, stream: false });

    let lastError = null;
    const totalAttempts = this.maxRetries + 1;

    for (let attempt = 0; attempt < totalAttempts; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`
          },
          body: JSON.stringify(payload),
          signal: controller.signal
        });

        if (!response.ok) {
          const body = await response.text();
          if (this.isRetriableStatus(response.status) && attempt < this.maxRetries) {
            await this.waitBeforeRetry(attempt);
            continue;
          }
          throw new Error(`LLM request failed: ${response.status} ${body}`);
        }

        const data = await response.json();
        const message = data?.choices?.[0]?.message;
        if (!message) {
          throw new Error('LLM response missing choices[0].message');
        }
        return this.buildDecisionFromAssistantMessage(message);
      } catch (err) {
        lastError = err;
        if (attempt < this.maxRetries && this.isRetriableNetworkError(err)) {
          await this.waitBeforeRetry(attempt);
          continue;
        }
        break;
      } finally {
        clearTimeout(timer);
      }
    }

    const message = lastError?.message || String(lastError || 'unknown error');
    throw new Error(
      `LLM request failed after ${totalAttempts} attempt(s): ${message} (base_url=${this.baseUrl}, model=${this.model})`
    );
  }

  async decideStream({
    messages,
    tools,
    onDelta = null,
    onToolCallDelta = null,
    onToolCallStable = null,
    onToolCallParseError = null
  }) {
    const payload = this.buildPayload({ messages, tools, stream: true });

    let lastError = null;
    const totalAttempts = this.maxRetries + 1;

    for (let attempt = 0; attempt < totalAttempts; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`
          },
          body: JSON.stringify(payload),
          signal: controller.signal
        });

        if (!response.ok) {
          const body = await response.text();
          if (this.isRetriableStatus(response.status) && attempt < this.maxRetries) {
            await this.waitBeforeRetry(attempt);
            continue;
          }
          throw new Error(`LLM request failed: ${response.status} ${body}`);
        }

        if (!response.body || typeof response.body[Symbol.asyncIterator] !== 'function') {
          throw new Error('LLM stream response body is unavailable');
        }

        const decoder = new TextDecoder();
        let buffer = '';
        let sawDone = false;
        let textOutput = '';
        const accumulator = new ToolCallAccumulator({
          onDelta: onToolCallDelta,
          onStable: onToolCallStable,
          onParseError: onToolCallParseError
        });

        const emitDelta = (value) => {
          const delta = String(value || '');
          if (!delta) return;
          if (typeof onDelta === 'function') {
            try {
              onDelta(delta);
            } catch {
              // Ignore callback failures to keep stream consumer robust.
            }
          }
        };

        const processChunkData = (jsonPayload) => {
          const choice = jsonPayload?.choices?.[0];
          if (!choice) return;
          const delta = choice.delta || {};
          const contentDelta = extractTextContent(delta.content);
          if (contentDelta) {
            textOutput += contentDelta;
            emitDelta(contentDelta);
          }

          if (Array.isArray(delta.tool_calls)) {
            for (const tc of delta.tool_calls) {
              accumulator.append(tc);
            }
          }
        };

        for await (const chunk of response.body) {
          buffer += decoder.decode(chunk, { stream: true });
          let lineBreakIndex = buffer.indexOf('\n');
          while (lineBreakIndex >= 0) {
            const rawLine = buffer.slice(0, lineBreakIndex);
            buffer = buffer.slice(lineBreakIndex + 1);
            const line = rawLine.trim();
            if (!line || !line.startsWith('data:')) {
              lineBreakIndex = buffer.indexOf('\n');
              continue;
            }

            const data = line.slice(5).trim();
            if (data === '[DONE]') {
              sawDone = true;
              break;
            }

            let parsed = null;
            try {
              parsed = JSON.parse(data);
            } catch {
              lineBreakIndex = buffer.indexOf('\n');
              continue;
            }
            processChunkData(parsed);
            lineBreakIndex = buffer.indexOf('\n');
          }
          if (sawDone) break;
        }

        const tail = buffer.trim();
        if (!sawDone && tail.startsWith('data:')) {
          const data = tail.slice(5).trim();
          if (data && data !== '[DONE]') {
            try {
              processChunkData(JSON.parse(data));
            } catch {
              // ignore malformed tail payloads
            }
          }
        }

        const { toolCalls: resolvedToolCalls, parseErrors } = accumulator.finalize();
        const toolCalls = resolvedToolCalls.map((item, idx) => ({
          id: item.call_id || `call_stream_${idx + 1}`,
          type: 'function',
          function: {
            name: item.name || 'unknown_tool',
            arguments: item.args_raw || '{}'
          }
        }));

        const assistantMessage = {
          role: 'assistant',
          content: textOutput || '',
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {})
        };

        if (resolvedToolCalls.length > 0) {
          const toolsDecision = resolvedToolCalls.map((item) => ({
            call_id: item.call_id,
            name: item.name,
            args: item.args
          }));
          return {
            type: 'tool',
            assistantMessage,
            tool: toolsDecision[0],
            tools: toolsDecision,
            stream_meta: {
              tool_parse_errors: parseErrors.length,
              parse_errors: parseErrors
            }
          };
        }

        const decision = this.buildDecisionFromAssistantMessage(assistantMessage);
        return {
          ...decision,
          stream_meta: {
            tool_parse_errors: parseErrors.length,
            parse_errors: parseErrors
          }
        };
      } catch (err) {
        lastError = err;
        if (attempt < this.maxRetries && this.isRetriableNetworkError(err)) {
          await this.waitBeforeRetry(attempt);
          continue;
        }
        break;
      } finally {
        clearTimeout(timer);
      }
    }

    const message = lastError?.message || String(lastError || 'unknown error');
    throw new Error(
      `LLM request failed after ${totalAttempts} attempt(s): ${message} (base_url=${this.baseUrl}, model=${this.model})`
    );
  }
}

module.exports = { OpenAIReasoner };
