'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadDriver() {
  const sandbox = {
    Uint8Array,
    Live2DVisemeLipSync: {
      createRuntimeState: () => ({}),
      resolveVisemeFrame: () => ({ mouthOpen: 0, mouthForm: 0 })
    },
    Live2DMouthTransition: {
      stepMouthTransition: () => ({ mouthOpen: 0, mouthForm: 0 }),
      isMouthTransitionSettled: () => true
    }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  const file = path.join(__dirname, '../../apps/android/app/src/main/assets/web/js/lipsync.js');
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
  return sandbox.YachiyoLipsync.LipsyncDriver;
}

test('TC-AWB-028 lipsync releases its active layer after settling and can start another utterance', () => {
  const Driver = loadDriver();
  const stage = { mouth: { active: false, open: 0, form: 0 } };
  const analyser = { frequencyBinCount: 4, getByteFrequencyData() {} };
  const driver = new Driver({ stage });

  assert.equal(driver.start({ analyser, audioContext: { sampleRate: 24000 }, isSpeaking: () => false }), true);
  driver.stop();
  driver.step();
  assert.equal(stage.mouth.active, false);
  assert.deepEqual([stage.mouth.open, stage.mouth.form], [0, 0]);

  driver.start({ analyser, audioContext: { sampleRate: 24000 }, isSpeaking: () => true });
  assert.equal(stage.mouth.active, true);
});
