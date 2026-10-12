const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const {
  SERVICE_TXT,
  attachGatewayDiscovery,
  isDiscoveryEnabled,
  serviceName
} = require('../../apps/gateway/discovery');

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

function fakeBonjour(records) {
  return class FakeBonjour {
    constructor() {
      this.record = { definitions: [], serviceStops: 0, unpublishes: 0, destroys: 0 };
      records.push(this.record);
    }

    publish(definition) {
      this.record.definitions.push(definition);
      return {
        on() {},
        stop: (done) => {
          this.record.serviceStops += 1;
          done?.();
        }
      };
    }

    unpublishAll(done) {
      this.record.unpublishes += 1;
      done?.();
    }

    destroy() {
      this.record.destroys += 1;
    }
  };
}

test('Gateway discovery advertises exact DNS-SD contract on each actual listening port', async (t) => {
  const records = [];
  const messages = [];
  const Bonjour = fakeBonjour(records);
  const servers = [http.createServer(), http.createServer()];
  t.after(async () => {
    await Promise.all(servers.filter((server) => server.listening).map(close));
  });

  const controllers = servers.map((server, index) => attachGatewayDiscovery({
    server,
    Bonjour,
    hostname: `host-${index}`,
    env: index === 0 ? { YACHIYO_DISCOVERY_NAME: 'Studio Yachiyo' } : {},
    logger: { info: (message) => messages.push(message), warn: (message) => messages.push(message) }
  }));
  await Promise.all(servers.map(listen));

  assert.equal(records.length, 2);
  for (let index = 0; index < servers.length; index += 1) {
    const definition = records[index].definitions[0];
    assert.equal(definition.port, servers[index].address().port);
    assert.equal(definition.type, 'yachiyo');
    assert.equal(definition.protocol, 'tcp');
    assert.deepEqual(definition.txt, { version: '1', path: '/ws/device' });
  }
  assert.equal(records[0].definitions[0].name, 'Studio Yachiyo');
  assert.equal(records[1].definitions[0].name, 'Yachiyo on host-1');
  assert.equal(JSON.stringify(records[0].definitions[0].txt), JSON.stringify(SERVICE_TXT));
  assert.equal(messages.join('\n').includes('token'), false);
  assert.equal(messages.join('\n').includes('secret'), false);

  await Promise.all(servers.map(close));
  await Promise.all(controllers.map((controller) => controller.stop()));
  for (const record of records) {
    assert.equal(record.serviceStops, 1);
    assert.equal(record.unpublishes, 1);
    assert.equal(record.destroys, 1);
  }
});

test('Gateway discovery can be disabled and start remains inert', async (t) => {
  const server = http.createServer();
  let constructed = 0;
  class UnexpectedBonjour {
    constructor() { constructed += 1; }
  }
  const controller = attachGatewayDiscovery({
    server,
    Bonjour: UnexpectedBonjour,
    env: { YACHIYO_DISCOVERY_ENABLED: 'false' }
  });
  t.after(() => server.listening ? close(server) : undefined);
  await listen(server);

  assert.equal(controller.enabled, false);
  assert.equal(controller.start(), null);
  assert.equal(constructed, 0);
  await controller.stop();
});

test('Gateway discovery failure does not stop the HTTP server', async (t) => {
  const server = http.createServer((_req, res) => res.end('ok'));
  const warnings = [];
  const controller = attachGatewayDiscovery({
    server,
    Bonjour: () => { throw new Error('multicast unavailable'); },
    env: {},
    logger: { info() {}, warn: (message) => warnings.push(message) }
  });
  t.after(() => server.listening ? close(server) : undefined);
  await listen(server);

  assert.equal(controller.start(), false);
  assert.equal(server.listening, true);
  assert.match(warnings[0], /advertising unavailable: multicast unavailable/);
  await controller.stop();
});

test('Gateway discovery helpers normalize defaults and the disable flag', () => {
  assert.equal(isDiscoveryEnabled({}), true);
  assert.equal(isDiscoveryEnabled({ YACHIYO_DISCOVERY_ENABLED: ' FALSE ' }), false);
  assert.equal(serviceName({}, 'workstation.local'), 'Yachiyo on workstation.local');
  assert.equal(serviceName({ YACHIYO_DISCOVERY_NAME: '  My Yachiyo  ' }, 'ignored'), 'My Yachiyo');
});
