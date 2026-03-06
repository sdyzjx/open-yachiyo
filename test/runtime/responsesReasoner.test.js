const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { ResponsesReasoner } = require('../../apps/runtime/llm/responsesReasoner');
const { getFreePort } = require('../helpers/net');

function startMockServer(handler) {
  return new Promise(async (resolve, reject) => {
    const port = await getFreePort();
    const server = http.createServer(handler);
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => resolve({ server, port }));
  });
}

function writeSseEvent(res, event, payload) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

test('ResponsesReasoner returns final decision for text response', async () => {
  const { server, port } = await startMockServer((req, res) => {
    assert.equal(req.url, '/responses');
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      output: [{
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'hello from responses' }]
      }]
    }));
  });

  try {
    const reasoner = new ResponsesReasoner({ apiKey: 'k', baseUrl: `http://127.0.0.1:${port}`, model: 'mock' });
    const decision = await reasoner.decide({ messages: [{ role: 'user', content: 'x' }], tools: [] });

    assert.equal(decision.type, 'final');
    assert.equal(decision.output, 'hello from responses');
  } finally {
    server.close();
  }
});

test('ResponsesReasoner returns tool decision for function_call output', async () => {
  const { server, port } = await startMockServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      output: [{
        type: 'function_call',
        id: 'fc_123',
        call_id: 'call_123',
        name: 'add',
        arguments: '{"a":20,"b":22}'
      }]
    }));
  });

  try {
    const reasoner = new ResponsesReasoner({ apiKey: 'k', baseUrl: `http://127.0.0.1:${port}`, model: 'mock' });
    const decision = await reasoner.decide({ messages: [{ role: 'user', content: 'x' }], tools: [] });

    assert.equal(decision.type, 'tool');
    assert.equal(decision.tool.call_id, 'call_123');
    assert.equal(decision.tool.name, 'add');
    assert.deepEqual(decision.tool.args, { a: 20, b: 22 });
  } finally {
    server.close();
  }
});

test('ResponsesReasoner decideStream emits text deltas and returns final decision', async () => {
  const { server, port } = await startMockServer((req, res) => {
    res.setHeader('content-type', 'text/event-stream');
    writeSseEvent(res, 'response.output_text.delta', {
      type: 'response.output_text.delta',
      delta: '你'
    });
    writeSseEvent(res, 'response.output_text.delta', {
      type: 'response.output_text.delta',
      delta: '好'
    });
    writeSseEvent(res, 'response.completed', {
      type: 'response.completed',
      response: {
        output: [{
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: '你好' }]
        }]
      }
    });
    res.write('data: [DONE]\n\n');
    res.end();
  });

  try {
    const reasoner = new ResponsesReasoner({ apiKey: 'k', baseUrl: `http://127.0.0.1:${port}`, model: 'mock' });
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

test('ResponsesReasoner decideStream emits stable tool call from output_item.done', async () => {
  const { server, port } = await startMockServer((req, res) => {
    res.setHeader('content-type', 'text/event-stream');
    writeSseEvent(res, 'response.output_item.done', {
      type: 'response.output_item.done',
      item: {
        type: 'function_call',
        id: 'fc_stream_1',
        call_id: 'call_stream_1',
        name: 'echo',
        arguments: '{"text":"ok"}'
      }
    });
    res.write('data: [DONE]\n\n');
    res.end();
  });

  try {
    const reasoner = new ResponsesReasoner({ apiKey: 'k', baseUrl: `http://127.0.0.1:${port}`, model: 'mock' });
    const stableCalls = [];
    const decision = await reasoner.decideStream({
      messages: [{ role: 'user', content: 'x' }],
      tools: [],
      onToolCallStable: (payload) => stableCalls.push(payload)
    });

    assert.equal(decision.type, 'tool');
    assert.equal(stableCalls.length, 1);
    assert.equal(stableCalls[0].call_id, 'call_stream_1');
    assert.deepEqual(stableCalls[0].args, { text: 'ok' });
  } finally {
    server.close();
  }
});

test('ResponsesReasoner forwards request option headers and body fields', async () => {
  const { server, port } = await startMockServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    assert.equal(req.headers['x-dashscope-session-cache'], 'session-123');
    assert.equal(body.previous_response_id, 'resp_prev');
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({
      output: [{
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'ok' }]
      }]
    }));
  });

  try {
    const reasoner = new ResponsesReasoner({ apiKey: 'k', baseUrl: `http://127.0.0.1:${port}`, model: 'mock' });
    const decision = await reasoner.decide({
      messages: [{ role: 'user', content: 'x' }],
      tools: [],
      requestOptions: {
        headers: {
          'x-dashscope-session-cache': 'session-123'
        },
        body: {
          previous_response_id: 'resp_prev'
        }
      }
    });

    assert.equal(decision.type, 'final');
    assert.equal(decision.output, 'ok');
  } finally {
    server.close();
  }
});
