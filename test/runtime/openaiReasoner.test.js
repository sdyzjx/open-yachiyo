const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { OpenAIReasoner } = require('../../apps/runtime/llm/openaiReasoner');
const { getFreePort } = require('../helpers/net');

function startMockServer(handler) {
  return new Promise(async (resolve, reject) => {
    const port = await getFreePort();
    const server = http.createServer(handler);
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => resolve({ server, port }));
  });
}

function writeSseData(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

test('OpenAIReasoner returns tool decision when tool_calls exists', async () => {
  const { server, port } = await startMockServer((req, res) => {
    if (req.url !== '/chat/completions') {
      res.writeHead(404).end();
      return;
    }

    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      choices: [{
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call-1',
              type: 'function',
              function: { name: 'add', arguments: '{"a":20,"b":22}' }
            }
          ]
        }
      }]
    }));
  });

  try {
    const reasoner = new OpenAIReasoner({ apiKey: 'k', baseUrl: `http://127.0.0.1:${port}`, model: 'mock' });
    const decision = await reasoner.decide({ messages: [{ role: 'user', content: 'x' }], tools: [] });

    assert.equal(decision.type, 'tool');
    assert.equal(decision.tool.name, 'add');
    assert.deepEqual(decision.tool.args, { a: 20, b: 22 });
  } finally {
    server.close();
  }
});



test('OpenAIReasoner parses multiple tool calls', async () => {
  const { server, port } = await startMockServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      choices: [{
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [
            { id: 'call-1', type: 'function', function: { name: 'add', arguments: '{"a":1,"b":2}' } },
            { id: 'call-2', type: 'function', function: { name: 'echo', arguments: '{"text":"ok"}' } }
          ]
        }
      }]
    }));
  });

  try {
    const reasoner = new OpenAIReasoner({ apiKey: 'k', baseUrl: `http://127.0.0.1:${port}`, model: 'mock' });
    const decision = await reasoner.decide({ messages: [{ role: 'user', content: 'x' }], tools: [] });

    assert.equal(decision.type, 'tool');
    assert.equal(decision.tools.length, 2);
    assert.equal(decision.tools[0].name, 'add');
    assert.deepEqual(decision.tools[1].args, { text: 'ok' });
  } finally {
    server.close();
  }
});
test('OpenAIReasoner returns final decision for text response', async () => {
  const { server, port } = await startMockServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      choices: [{
        message: {
          role: 'assistant',
          content: 'hello'
        }
      }]
    }));
  });

  try {
    const reasoner = new OpenAIReasoner({ apiKey: 'k', baseUrl: `http://127.0.0.1:${port}`, model: 'mock' });
    const decision = await reasoner.decide({ messages: [{ role: 'user', content: 'x' }], tools: [] });

    assert.equal(decision.type, 'final');
    assert.equal(decision.output, 'hello');
  } finally {
    server.close();
  }
});

test('OpenAIReasoner decideStream emits deltas and returns final decision', async () => {
  const { server, port } = await startMockServer((req, res) => {
    if (req.url !== '/chat/completions') {
      res.writeHead(404).end();
      return;
    }
    res.setHeader('content-type', 'text/event-stream');
    writeSseData(res, { choices: [{ delta: { content: '你' } }] });
    writeSseData(res, { choices: [{ delta: { content: '好' } }] });
    res.write('data: [DONE]\n\n');
    res.end();
  });

  try {
    const reasoner = new OpenAIReasoner({ apiKey: 'k', baseUrl: `http://127.0.0.1:${port}`, model: 'mock' });
    const deltas = [];
    const decision = await reasoner.decideStream({
      messages: [{ role: 'user', content: 'x' }],
      tools: [],
      onDelta: (delta) => deltas.push(delta)
    });

    assert.equal(decision.type, 'final');
    assert.equal(decision.output, '你好');
    assert.deepEqual(deltas, ['你', '好']);
  } finally {
    server.close();
  }
});

test('OpenAIReasoner decideStream parses tool call fragments', async () => {
  const { server, port } = await startMockServer((req, res) => {
    res.setHeader('content-type', 'text/event-stream');
    writeSseData(res, {
      choices: [{
        delta: {
          tool_calls: [{
            index: 0,
            id: 'call-stream-1',
            type: 'function',
            function: { name: 'add', arguments: '{"a":1' }
          }]
        }
      }]
    });
    writeSseData(res, {
      choices: [{
        delta: {
          tool_calls: [{
            index: 0,
            function: { arguments: ',"b":2}' }
          }]
        }
      }]
    });
    res.write('data: [DONE]\n\n');
    res.end();
  });

  try {
    const reasoner = new OpenAIReasoner({ apiKey: 'k', baseUrl: `http://127.0.0.1:${port}`, model: 'mock' });
    const decision = await reasoner.decideStream({
      messages: [{ role: 'user', content: 'x' }],
      tools: []
    });

    assert.equal(decision.type, 'tool');
    assert.equal(decision.tool.name, 'add');
    assert.deepEqual(decision.tool.args, { a: 1, b: 2 });
  } finally {
    server.close();
  }
});

test('OpenAIReasoner decideStream emits tool_call delta/stable callbacks', async () => {
  const { server, port } = await startMockServer((req, res) => {
    res.setHeader('content-type', 'text/event-stream');
    writeSseData(res, {
      choices: [{
        delta: {
          tool_calls: [{
            index: 0,
            id: 'call-stable-1',
            type: 'function',
            function: { name: 'add', arguments: '{"a":1' }
          }]
        }
      }]
    });
    writeSseData(res, {
      choices: [{
        delta: {
          tool_calls: [{
            index: 0,
            function: { arguments: ',"b":2}' }
          }]
        }
      }]
    });
    res.write('data: [DONE]\n\n');
    res.end();
  });

  try {
    const reasoner = new OpenAIReasoner({ apiKey: 'k', baseUrl: `http://127.0.0.1:${port}`, model: 'mock' });
    const toolDeltas = [];
    const toolStables = [];
    const decision = await reasoner.decideStream({
      messages: [{ role: 'user', content: 'x' }],
      tools: [],
      onToolCallDelta: (payload) => toolDeltas.push(payload),
      onToolCallStable: (payload) => toolStables.push(payload)
    });

    assert.equal(decision.type, 'tool');
    assert.equal(toolDeltas.length, 2);
    assert.equal(toolStables.length, 1);
    assert.equal(toolStables[0].call_id, 'call-stable-1');
    assert.deepEqual(toolStables[0].args, { a: 1, b: 2 });
  } finally {
    server.close();
  }
});

test('OpenAIReasoner decideStream surfaces parse errors from fragmented tool args', async () => {
  const { server, port } = await startMockServer((req, res) => {
    res.setHeader('content-type', 'text/event-stream');
    writeSseData(res, {
      choices: [{
        delta: {
          tool_calls: [{
            index: 0,
            id: 'call-bad-1',
            type: 'function',
            function: { name: 'broken_tool', arguments: '{"a":1' }
          }]
        }
      }]
    });
    res.write('data: [DONE]\n\n');
    res.end();
  });

  try {
    const reasoner = new OpenAIReasoner({ apiKey: 'k', baseUrl: `http://127.0.0.1:${port}`, model: 'mock' });
    const parseErrors = [];
    const decision = await reasoner.decideStream({
      messages: [{ role: 'user', content: 'x' }],
      tools: [],
      onToolCallParseError: (payload) => parseErrors.push(payload)
    });

    assert.equal(decision.type, 'final');
    assert.equal(decision.stream_meta.tool_parse_errors, 1);
    assert.equal(parseErrors.length, 1);
    assert.equal(parseErrors[0].call_id, 'call-bad-1');
    assert.equal(typeof parseErrors[0].parse_reason, 'string');
  } finally {
    server.close();
  }
});

test('OpenAIReasoner retries on transient network failure and succeeds', async () => {
  let requestCount = 0;
  const { server, port } = await startMockServer((req, res) => {
    requestCount += 1;
    if (requestCount === 1) {
      req.socket.destroy();
      return;
    }

    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      choices: [{
        message: {
          role: 'assistant',
          content: 'retry-success'
        }
      }]
    }));
  });

  try {
    const reasoner = new OpenAIReasoner({
      apiKey: 'k',
      baseUrl: `http://127.0.0.1:${port}`,
      model: 'mock',
      timeoutMs: 2000,
      maxRetries: 1,
      retryDelayMs: 10
    });
    const decision = await reasoner.decide({ messages: [{ role: 'user', content: 'x' }], tools: [] });

    assert.equal(decision.type, 'final');
    assert.equal(decision.output, 'retry-success');
    assert.equal(requestCount, 2);
  } finally {
    server.close();
  }
});

test('OpenAIReasoner reports contextual error after retries exhausted', async () => {
  const port = await getFreePort();
  const reasoner = new OpenAIReasoner({
    apiKey: 'k',
    baseUrl: `http://127.0.0.1:${port}`,
    model: 'mock-timeout',
    timeoutMs: 800,
    maxRetries: 1,
    retryDelayMs: 10
  });

  await assert.rejects(
    () => reasoner.decide({ messages: [{ role: 'user', content: 'x' }], tools: [] }),
    /after 2 attempt\(s\).*base_url=.*mock-timeout/i
  );
});
