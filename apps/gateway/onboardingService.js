const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const YAML = require('yaml');

const { getRuntimePaths } = require('../runtime/skills/runtimePaths');
const { OnboardingError } = require('./voiceCloneService');

const ONBOARDING_STATE_VERSION = 1;
const DEFAULT_LLM_PROVIDER_TYPE = 'openai_compatible';
const DEFAULT_TIMEOUT_MS = 20000;
const DEFAULT_LLM_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const DEFAULT_TTS_BASE_URL = 'https://dashscope.aliyuncs.com/api/v1';
const DEFAULT_NORMAL_MODEL = 'qwen3-tts-vc-2026-01-22';
const DEFAULT_REALTIME_MODEL = 'qwen3-tts-vc-realtime-2026-01-15';

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (value === undefined || value === null) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on') return true;
  if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'off') return false;
  return fallback;
}

function parsePositiveNumber(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function getOnboardingStatePath() {
  return path.join(getRuntimePaths().dataDir, 'onboarding-state.json');
}

async function readOnboardingState() {
  const statePath = getOnboardingStatePath();
  if (!fs.existsSync(statePath)) {
    return {
      done: false,
      version: ONBOARDING_STATE_VERSION,
      completed_at: null,
      last_step: 'provider'
    };
  }
  try {
    const raw = await fsp.readFile(statePath, 'utf8');
    const parsed = JSON.parse(raw || '{}');
    return {
      done: Boolean(parsed.done),
      version: Number(parsed.version) || ONBOARDING_STATE_VERSION,
      completed_at: parsed.completed_at || null,
      last_step: String(parsed.last_step || 'provider')
    };
  } catch {
    return {
      done: false,
      version: ONBOARDING_STATE_VERSION,
      completed_at: null,
      last_step: 'provider'
    };
  }
}

async function writeOnboardingState(nextState) {
  const statePath = getOnboardingStatePath();
  await fsp.mkdir(path.dirname(statePath), { recursive: true });
  await fsp.writeFile(statePath, JSON.stringify(nextState, null, 2), 'utf8');
  return nextState;
}

async function markOnboardingStep(step) {
  const prev = await readOnboardingState();
  const next = {
    ...prev,
    version: ONBOARDING_STATE_VERSION,
    done: false,
    completed_at: null,
    last_step: String(step || prev.last_step || 'provider')
  };
  return writeOnboardingState(next);
}

async function markOnboardingCompleted() {
  const prev = await readOnboardingState();
  const next = {
    ...prev,
    version: ONBOARDING_STATE_VERSION,
    done: true,
    completed_at: new Date().toISOString(),
    last_step: 'complete'
  };
  return writeOnboardingState(next);
}

function buildLlmProviderPayload(providerInput = {}) {
  const key = String(providerInput.key || providerInput.provider_key || 'qwen35_plus').trim();
  if (!key) {
    throw new OnboardingError('ONBOARDING_CONFIG_SAVE_FAILED', 'provider key is required');
  }
  const apiKey = String(providerInput.api_key || '').trim();
  const apiKeyEnv = String(providerInput.api_key_env || '').trim();
  if (!apiKey && !apiKeyEnv) {
    throw new OnboardingError('ONBOARDING_CONFIG_SAVE_FAILED', 'api_key or api_key_env is required');
  }
  return {
    key,
    config: {
      type: DEFAULT_LLM_PROVIDER_TYPE,
      display_name: String(providerInput.display_name || key).trim() || key,
      base_url: String(providerInput.base_url || DEFAULT_LLM_BASE_URL).trim() || DEFAULT_LLM_BASE_URL,
      model: String(providerInput.model || 'qwen3.5-plus').trim() || 'qwen3.5-plus',
      timeout_ms: Math.round(parsePositiveNumber(providerInput.timeout_ms, DEFAULT_TIMEOUT_MS)),
      ...(apiKey ? { api_key: apiKey } : {}),
      ...(apiKeyEnv ? { api_key_env: apiKeyEnv } : {})
    }
  };
}

function saveLlmProvider({ providerStore, providerInput, activeProvider }) {
  const payload = buildLlmProviderPayload(providerInput);
  const current = providerStore.load();
  const next = {
    ...current,
    providers: {
      ...(current.providers || {}),
      [payload.key]: payload.config
    },
    active_provider: String(activeProvider || payload.key).trim() || payload.key
  };
  providerStore.save(next);
  return providerStore.load();
}

function saveTtsProviderFromVoiceClone({
  providerStore,
  apiKey,
  apiKeyEnv,
  ttsBaseUrl = DEFAULT_TTS_BASE_URL,
  targetMode = 'normal',
  voiceId
}) {
  const current = providerStore.load();
  const providers = { ...(current.providers || {}) };
  const existing = isPlainObject(providers.qwen3_tts) ? providers.qwen3_tts : {};

  const nextTts = {
    ...existing,
    type: 'tts_dashscope',
    display_name: String(existing.display_name || 'Qwen3 TTS VC'),
    base_url: String(ttsBaseUrl || existing.base_url || DEFAULT_TTS_BASE_URL),
    timeout_ms: Math.round(parsePositiveNumber(existing.timeout_ms, 60000)),
    tts_model: String(existing.tts_model || DEFAULT_NORMAL_MODEL),
    tts_voice: String(existing.tts_voice || voiceId || '').trim()
  };

  if (!nextTts.tts_voice) {
    throw new OnboardingError('ONBOARDING_CONFIG_SAVE_FAILED', 'tts_voice is required for tts provider');
  }

  if (targetMode === 'realtime') {
    nextTts.tts_realtime_model = DEFAULT_REALTIME_MODEL;
    nextTts.tts_realtime_voice = String(voiceId || '').trim() || String(nextTts.tts_realtime_voice || '').trim();
  } else {
    nextTts.tts_model = DEFAULT_NORMAL_MODEL;
    nextTts.tts_voice = String(voiceId || '').trim();
  }

  if (apiKey) {
    nextTts.api_key = String(apiKey).trim();
    delete nextTts.api_key_env;
  } else if (apiKeyEnv) {
    nextTts.api_key_env = String(apiKeyEnv).trim();
    delete nextTts.api_key;
  } else if (!nextTts.api_key && !nextTts.api_key_env) {
    throw new OnboardingError('ONBOARDING_CONFIG_SAVE_FAILED', 'api_key or api_key_env is required for tts provider');
  }

  providers.qwen3_tts = nextTts;
  providerStore.save({
    ...current,
    providers
  });

  return providerStore.load();
}

function mergeVoicePolicyRaw(rawYaml, voicePolicyInput = {}) {
  const parsed = YAML.parse(String(rawYaml || '')) || {};
  const root = isPlainObject(parsed) ? parsed : {};
  const policy = isPlainObject(root.voice_policy) ? root.voice_policy : {};
  const autoReply = isPlainObject(policy.auto_reply) ? policy.auto_reply : {};
  const limits = isPlainObject(policy.limits) ? policy.limits : {};

  const next = {
    ...root,
    voice_policy: {
      ...policy,
      auto_reply: {
        ...autoReply,
        enabled: parseBoolean(voicePolicyInput.auto_reply_enabled, autoReply.enabled !== false)
      },
      limits: {
        ...limits,
        max_chars: Math.round(parsePositiveNumber(voicePolicyInput.max_chars, limits.max_chars || 220)),
        max_duration_sec: Math.round(parsePositiveNumber(voicePolicyInput.max_duration_sec, limits.max_duration_sec || 45)),
        cooldown_sec_per_session: Math.round(parsePositiveNumber(
          voicePolicyInput.cooldown_sec_per_session,
          limits.cooldown_sec_per_session || 2
        )),
        max_tts_calls_per_minute: Math.round(parsePositiveNumber(
          voicePolicyInput.max_tts_calls_per_minute,
          limits.max_tts_calls_per_minute || 3
        ))
      }
    }
  };
  return YAML.stringify(next);
}

function mergePersonaRaw(rawYaml, personaInput = {}) {
  const parsed = YAML.parse(String(rawYaml || '')) || {};
  if (!isPlainObject(parsed)) {
    throw new OnboardingError('ONBOARDING_CONFIG_SAVE_FAILED', 'persona.yaml root must be object');
  }
  const defaults = isPlainObject(parsed.defaults) ? parsed.defaults : {};
  const next = {
    ...parsed,
    defaults: {
      ...defaults,
      ...(personaInput.mode ? { mode: String(personaInput.mode).trim() } : {}),
      ...(personaInput.inject_enabled !== undefined ? { injectEnabled: parseBoolean(personaInput.inject_enabled, true) } : {}),
      ...(personaInput.max_context_chars !== undefined
        ? { maxContextChars: Math.round(parsePositiveNumber(personaInput.max_context_chars, defaults.maxContextChars || 1500)) }
        : {}),
      ...(personaInput.shared_across_sessions !== undefined
        ? { sharedAcrossSessions: parseBoolean(personaInput.shared_across_sessions, true) }
        : {})
    }
  };
  return YAML.stringify(next);
}

function mergeSkillsRaw(rawYaml, skillsInput = {}) {
  const parsed = YAML.parse(String(rawYaml || '')) || {};
  if (!isPlainObject(parsed)) {
    throw new OnboardingError('ONBOARDING_CONFIG_SAVE_FAILED', 'skills.yaml root must be object');
  }
  const load = isPlainObject(parsed.load) ? parsed.load : {};
  const trigger = isPlainObject(parsed.trigger) ? parsed.trigger : {};
  const next = {
    ...parsed,
    load: {
      ...load,
      ...(skillsInput.workspace !== undefined ? { workspace: parseBoolean(skillsInput.workspace, true) } : {}),
      ...(skillsInput.global !== undefined ? { global: parseBoolean(skillsInput.global, true) } : {})
    },
    trigger: {
      ...trigger,
      ...(skillsInput.max_selected_per_turn !== undefined
        ? { maxSelectedPerTurn: Math.round(parsePositiveNumber(skillsInput.max_selected_per_turn, trigger.maxSelectedPerTurn || 2)) }
        : {})
    }
  };
  return YAML.stringify(next);
}

function saveOnboardingPreferences({
  voicePolicyPath,
  personaConfigStore,
  skillConfigStore,
  input = {}
}) {
  if (isPlainObject(input.voice_policy)) {
    const rawVoicePolicy = fs.existsSync(voicePolicyPath)
      ? fs.readFileSync(voicePolicyPath, 'utf8')
      : '';
    const nextVoicePolicy = mergeVoicePolicyRaw(rawVoicePolicy, input.voice_policy);
    fs.writeFileSync(voicePolicyPath, nextVoicePolicy, 'utf8');
  }

  if (isPlainObject(input.persona_defaults)) {
    const rawPersona = personaConfigStore.loadRawYaml();
    const nextPersona = mergePersonaRaw(rawPersona, input.persona_defaults);
    personaConfigStore.saveRawYaml(nextPersona);
  }

  if (isPlainObject(input.skills)) {
    const rawSkills = skillConfigStore.loadRawYaml();
    const nextSkills = mergeSkillsRaw(rawSkills, input.skills);
    skillConfigStore.saveRawYaml(nextSkills);
  }
}

module.exports = {
  DEFAULT_LLM_BASE_URL,
  DEFAULT_TTS_BASE_URL,
  DEFAULT_NORMAL_MODEL,
  DEFAULT_REALTIME_MODEL,
  readOnboardingState,
  markOnboardingStep,
  markOnboardingCompleted,
  saveLlmProvider,
  saveTtsProviderFromVoiceClone,
  saveOnboardingPreferences
};
