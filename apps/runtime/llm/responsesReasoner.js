const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 300;

function parseToolArgs(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  return JSON.parse(String(raw));
}

function extractTextFromContentPart(part) {
  if (!part || typeof part !== 'object') return '';
  if (typeof part.text === 'string') return part.text;
  if (typeof part.output_text === 'string') return part.output_text;
  if (part.type === 'output_text' && typeof part.text === 'string') return part.text;
  if (part.type === 'text' && typeof part.text === 'string') return part.text;
  return '';
}

function extractTextFromOutputItem(item) {
  if (!item || typeof item !== 'object') return '';
  if (typeof item.text === 'string') return item.text;
  if (typeof item.output_text === 'string') return item.output_text;
  if (!Array.isArray(item.content)) return '';
  return item.content.map((part) => extractTextFromContentPart(part)).join('');
}

function extractTextOutput(responsePayload) {
  if (!responsePayload || typeof responsePayload !== 'object') return '';
  if (typeof responsePayload.output_text === 'string') return responsePayload.output_text;
  if (!Array.isArray(responsePayload.output)) return '';
  return responsePayload.output
    .filter((item) => item?.type === 'message')
    .map((item) => extractTextFromOutputItem(item))
    .join('');
}

function normalizeToolCallsFromOutput(output = []) {
  return output
    .filter((item) => item && typeof item === 'object' && item.type === 'function_call' && item.name)
    .map((item, index) => ({
      call_id: item.call_id || item.id || `call_resp_${index + 1}`,
      name: item.name,
      args: parseToolArgs(item.arguments || item.args || '{}'),
      args_raw: String(item.arguments || item.args || '{}'),
      index
    }));
}

function buildAssistantMessage({ content, toolCalls }) {
  return {
    role: 'assistant',
    content: content || '',
    ...(toolCalls.length > 0
      ? {
        tool_calls: toolCalls.map((call) => ({
          id: call.call_id,
          type: 'function',
          function: {
            name: call.name,
            arguments: call.args_raw || JSON.stringify(call.args || {})
          }
        }))
      }
      : {})
  };
}

function parseSseEventChunk(rawChunk) {
  const lines = String(rawChunk || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  let eventType = 'message';
  const dataLines = [];
  for (const line of lines) {
    if (line.startsWith('event:')) {
      eventType = line.slice(6).trim() || eventType;
      continue;
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trim());
    }
  }

  const data = dataLines.join('\n');
  return { eventType, data };
}

class ResponsesReasoner {
  constructor({
    apiKey,
    baseUrl = DEFAULT_BASE_URL,
    model = 'gpt-4o-mini',
    timeoutMs = 20000,
    maxRetries = DEFAULT_MAX_RETRIES,
    retryDelayMs = DEFAULT_RETRY_DELAY_MS
  } = {}) {
    if (!apiKey) {
      throw new Error('LLM_API_KEY is required for responses mode');
    }

    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.model = model;
    this.timeoutMs = timeoutMs;
    this.maxRetries = Math.max(0, Number(maxRetries) || 0);
    this.retryDelayMs = Math.max(0, Number(retryDelayMs) || 0);
  }

  buildPayload({ messages, tools, stream = false, requestOptions = {} }) {
    const payload = {
      model: this.model,
      stream: Boolean(stream),
      input: messages,
      tools: tools.map((tool) => ({
        type: 'function',
        name: tool.name,
        description: tool.description || '',
        parameters: tool.input_schema || { type: 'object', properties: {}, additionalProperties: true }
      }))
    };

    if (requestOptions && typeof requestOptions === 'object') {
      if (requestOptions.body && typeof requestOptions.body === 'object' && !Array.isArray(requestOptions.body)) {
        Object.assign(payload, requestOptions.body);
      }
    }

    return payload;
  }

  buildHeaders(requestOptions = {}) {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.apiKey}`,
      ...(requestOptions.headers || {})
    };
  }

  buildDecisionFromResponse(responsePayload) {
    const toolCalls = normalizeToolCallsFromOutput(responsePayload?.output || []);
    const content = extractTextOutput(responsePayload);
    const assistantMessage = buildAssistantMessage({
      content,
      toolCalls
    });

    if (toolCalls.length > 0) {
      return {
        type: 'tool',
        assistantMessage,
        tool: toolCalls[0],
        tools: toolCalls
      };
    }

    return {
      type: 'final',
      assistantMessage,
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

  async decide({ messages, tools, requestOptions = {} }) {
    const payload = this.buildPayload({ messages, tools, stream: false, requestOptions });
    let lastError = null;
    const totalAttempts = this.maxRetries + 1;

    for (let attempt = 0; attempt < totalAttempts; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await fetch(`${this.baseUrl}/responses`, {
          method: 'POST',
          headers: this.buildHeaders(requestOptions),
          body: JSON.stringify(payload),
          signal: controller.signal
        });

        if (!response.ok) {
          const body = await response.text();
          if (this.isRetriableStatus(response.status) && attempt < this.maxRetries) {
            await this.waitBeforeRetry(attempt);
            continue;
          }
          throw new Error(`LLM responses request failed: ${response.status} ${body}`);
        }

        const data = await response.json();
        return this.buildDecisionFromResponse(data);
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
      `LLM responses request failed after ${totalAttempts} attempt(s): ${message} (base_url=${this.baseUrl}, model=${this.model})`
    );
  }

  async decideStream({
    messages,
    tools,
    onDelta = null,
    onToolCallDelta = null,
    onToolCallStable = null,
    requestOptions = {}
  }) {
    const payload = this.buildPayload({ messages, tools, stream: true, requestOptions });
    let lastError = null;
    const totalAttempts = this.maxRetries + 1;

    for (let attempt = 0; attempt < totalAttempts; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await fetch(`${this.baseUrl}/responses`, {
          method: 'POST',
          headers: this.buildHeaders(requestOptions),
          body: JSON.stringify(payload),
          signal: controller.signal
        });

        if (!response.ok) {
          const body = await response.text();
          if (this.isRetriableStatus(response.status) && attempt < this.maxRetries) {
            await this.waitBeforeRetry(attempt);
            continue;
          }
          throw new Error(`LLM responses request failed: ${response.status} ${body}`);
        }

        if (!response.body || typeof response.body[Symbol.asyncIterator] !== 'function') {
          throw new Error('LLM responses stream body is unavailable');
        }

        const decoder = new TextDecoder();
        let buffer = '';
        let textOutput = '';
        let sawDone = false;
        let completedResponse = null;
        const stableToolCalls = [];
        const stableToolCallIds = new Set();

        const emitDelta = (value) => {
          const delta = String(value || '');
          if (!delta || typeof onDelta !== 'function') return;
          onDelta(delta);
        };

        const emitStableToolCall = (toolCall) => {
          const callId = String(toolCall?.call_id || '');
          if (!callId || stableToolCallIds.has(callId)) return;
          stableToolCallIds.add(callId);
          stableToolCalls.push(toolCall);
          if (typeof onToolCallDelta === 'function') {
            onToolCallDelta({
              index: toolCall.index,
              call_id: toolCall.call_id,
              name: toolCall.name,
              args_raw: toolCall.args_raw,
              args_delta: toolCall.args_raw,
              name_delta: toolCall.name
            });
          }
          if (typeof onToolCallStable === 'function') {
            onToolCallStable({
              index: toolCall.index,
              call_id: toolCall.call_id,
              name: toolCall.name,
              args_raw: toolCall.args_raw,
              args: toolCall.args
            });
          }
        };

        const processEvent = ({ eventType, payload: eventPayload }) => {
          const normalizedType = String(eventPayload?.type || eventType || '').trim();
          if (!normalizedType) return;

          if (
            normalizedType === 'response.output_text.delta'
            || normalizedType === 'response.content_part.delta'
          ) {
            const delta = String(eventPayload?.delta || eventPayload?.text || '');
            textOutput += delta;
            emitDelta(delta);
            return;
          }

          if (normalizedType === 'response.output_item.done') {
            const item = eventPayload?.item;
            if (item?.type === 'function_call' && item?.name) {
              const toolCall = {
                call_id: item.call_id || item.id || `call_resp_${stableToolCalls.length + 1}`,
                name: item.name,
                args_raw: String(item.arguments || item.args || '{}'),
                args: parseToolArgs(item.arguments || item.args || '{}'),
                index: stableToolCalls.length
              };
              emitStableToolCall(toolCall);
            }
            return;
          }

          if (normalizedType === 'response.completed') {
            completedResponse = eventPayload?.response || eventPayload;
            return;
          }

          if (normalizedType === 'response.failed') {
            const errorMessage = eventPayload?.response?.error?.message || eventPayload?.error?.message || 'responses stream failed';
            throw new Error(errorMessage);
          }
        };

        for await (const chunk of response.body) {
          buffer += decoder.decode(chunk, { stream: true });
          let eventBreak = buffer.indexOf('\n\n');
          while (eventBreak >= 0) {
            const rawEvent = buffer.slice(0, eventBreak);
            buffer = buffer.slice(eventBreak + 2);
            const { eventType, data } = parseSseEventChunk(rawEvent);
            if (!data) {
              eventBreak = buffer.indexOf('\n\n');
              continue;
            }
            if (data === '[DONE]') {
              sawDone = true;
              break;
            }
            processEvent({
              eventType,
              payload: JSON.parse(data)
            });
            eventBreak = buffer.indexOf('\n\n');
          }
          if (sawDone) break;
        }

        const decision = completedResponse
          ? this.buildDecisionFromResponse(completedResponse)
          : (stableToolCalls.length > 0
            ? {
              type: 'tool',
              assistantMessage: buildAssistantMessage({
                content: textOutput,
                toolCalls: stableToolCalls
              }),
              tool: stableToolCalls[0],
              tools: stableToolCalls
            }
            : {
              type: 'final',
              assistantMessage: buildAssistantMessage({
                content: textOutput,
                toolCalls: []
              }),
              output: textOutput || '模型未返回文本输出。'
            });

        return {
          ...decision,
          stream_meta: {
            tool_parse_errors: 0,
            parse_errors: []
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
      `LLM responses request failed after ${totalAttempts} attempt(s): ${message} (base_url=${this.baseUrl}, model=${this.model})`
    );
  }
}

module.exports = {
  ResponsesReasoner
};
