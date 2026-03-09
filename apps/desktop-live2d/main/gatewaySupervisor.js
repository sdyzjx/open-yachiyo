const path = require('node:path');
const { spawn } = require('node:child_process');

const { waitForGateway } = require('../../desktop/waitForGateway');

class GatewaySupervisor {
  constructor({
    projectRoot,
    gatewayUrl,
    gatewayHost,
    gatewayPort,
    external,
    waitForGatewayFn = waitForGateway,
    spawnFn = spawn
  }) {
    this.projectRoot = projectRoot;
    this.gatewayEntry = path.join(projectRoot, 'apps', 'gateway', 'server.js');
    this.gatewayUrl = gatewayUrl;
    this.gatewayHost = gatewayHost;
    this.gatewayPort = gatewayPort;
    this.external = external;
    this.waitForGatewayFn = waitForGatewayFn;
    this.spawnFn = spawnFn;
    this.child = null;
  }

  async start() {
    if (this.external) {
      await this.waitForGatewayFn(this.gatewayUrl, { timeoutMs: 30000 });
      return { mode: 'external', gatewayUrl: this.gatewayUrl };
    }

    const packagedProjectRoot = String(this.projectRoot || '').toLowerCase().includes('.asar');
    const gatewayCwd = packagedProjectRoot ? path.dirname(process.execPath) : this.projectRoot;

    this.child = this.spawnFn(process.execPath, [this.gatewayEntry], {
      cwd: gatewayCwd,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        HOST: this.gatewayHost,
        PORT: String(this.gatewayPort)
      },
      stdio: packagedProjectRoot ? 'pipe' : 'inherit',
      windowsHide: true
    });

    await this.waitForGatewayFn(this.gatewayUrl, { timeoutMs: 30000 });
    return { mode: 'embedded', gatewayUrl: this.gatewayUrl, pid: this.child.pid };
  }

  async stop() {
    if (!this.child) return;

    await new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };

      this.child.once('exit', finish);
      this.child.kill('SIGTERM');
      setTimeout(() => {
        if (done) return;
        this.child.kill('SIGKILL');
        finish();
      }, 2000);
    });

    this.child = null;
  }
}

module.exports = { GatewaySupervisor };
