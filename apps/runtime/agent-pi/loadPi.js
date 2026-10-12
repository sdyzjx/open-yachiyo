let pending;

function loadPi() {
  if (!pending) {
    pending = Promise.all([
      import('@earendil-works/pi-coding-agent'),
      import('@earendil-works/pi-ai'),
      import('@earendil-works/pi-agent-core'),
      import('@earendil-works/pi-ai/api/openai-completions'),
      import('@earendil-works/pi-ai/api/anthropic-messages'),
      import('@earendil-works/pi-ai/api/google-generative-ai')
    ]).then(([sdk, ai, core, openai, anthropic, google]) => ({
      sdk, ai, core,
      apis: { 'openai-completions': openai, 'anthropic-messages': anthropic, 'google-generative-ai': google }
    })).catch((error) => {
      pending = undefined;
      throw error;
    });
  }
  return pending;
}

module.exports = { loadPi };
