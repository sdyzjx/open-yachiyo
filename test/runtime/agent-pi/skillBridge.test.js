const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createResourceLoader } = require('../../../apps/runtime/agent-pi/skillBridge');
const { loadPi } = require('../../../apps/runtime/agent-pi/loadPi');

test('TC-PI-014 pi skills honor configured roots, disable rules, precedence and reload', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-skills-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const cwd = path.join(root, 'workspace');
  const home = path.join(root, 'home');
  for (const [base, name, description] of [[cwd, 'sample', 'workspace winner'], [home, 'sample', 'global loser'], [home, 'disabled', 'do not show']]) {
    const dir = path.join(base, 'skills', name);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\nInstructions.`);
  }
  const config = { home: { envKey: 'WS1_UNUSED_SKILL_HOME', defaultPath: home }, load: { global: true, workspace: true, extraDirs: [] }, limits: {}, entries: { disabled: { enabled: false } } };
  const { sdk } = await loadPi();
  const loader = await createResourceLoader({ cwd, agentDir: path.join(root, 'agent'), systemPrompt: 'custom policy',
    settingsManager: sdk.SettingsManager.inMemory({}), skillConfigStore: { load: () => config } });
  assert.deepEqual(loader.getSkills().skills.map((skill) => skill.name), ['sample']);
  assert.equal(loader.getSkills().skills[0].description, 'workspace winner');
  assert.equal(loader.getSystemPrompt(), 'custom policy');
  assert.deepEqual(loader.getAgentsFiles().agentsFiles, []);
  assert.deepEqual(loader.getExtensions().extensions, []);
  config.entries.sample = { enabled: false };
  await loader.reload();
  assert.deepEqual(loader.getSkills().skills, []);
});
