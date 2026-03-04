const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');

const DEFAULT_POLICY_PATH = path.resolve(process.cwd(), 'config/voice-policy.yaml');

function parseBool(v, fallback = false) {
  if (v === undefined || v === null) return fallback;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  const s = String(v).trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

function parseNum(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function defaultPolicy() {
  return {
    auto_reply: {
      enabled: false
    },
    limits: {
      max_chars: 220,
      max_duration_sec: 45,
      cooldown_sec_per_session: 20,
      max_tts_calls_per_minute: 3
    }
  };
}

function loadVoicePolicy({ policyPath } = {}) {
  const resolved = policyPath || process.env.VOICE_POLICY_PATH || DEFAULT_POLICY_PATH;
  if (!fs.existsSync(resolved)) return defaultPolicy();

  const raw = fs.readFileSync(resolved, 'utf8');
  const parsed = YAML.parse(raw) || {};
  const vp = parsed.voice_policy || {};
  const autoReply = vp.auto_reply || {};
  const limits = vp.limits || {};

  return {
    auto_reply: {
      enabled: parseBool(autoReply.enabled, false)
    },
    limits: {
      max_chars: parseNum(limits.max_chars, 220),
      max_duration_sec: parseNum(limits.max_duration_sec, 45),
      cooldown_sec_per_session: parseNum(limits.cooldown_sec_per_session, 20),
      max_tts_calls_per_minute: parseNum(limits.max_tts_calls_per_minute, 3)
    }
  };
}

function evaluateVoicePolicy(args, context, policy) {
  const text = String(args.text || '');
  const meta = args.replyMeta || {};
  const inputType = String(meta.inputType || context.inputType || 'text');
  const containsCode = parseBool(meta.containsCode, false);
  const containsTable = parseBool(meta.containsTable, false);
  const containsManyLinks = parseBool(meta.containsManyLinks, false);
  const isTroubleshooting = parseBool(meta.isTroubleshooting, false);
  const sentenceCount = parseNum(meta.sentenceCount, 1);

  if (!text.trim()) {
    return { allow: false, code: 'TTS_POLICY_REJECTED', reason: 'empty text' };
  }

  if (containsCode || containsTable || containsManyLinks || isTroubleshooting) {
    return { allow: false, code: 'TTS_POLICY_REJECTED', reason: 'content is not suitable for speech' };
  }

  if (text.length > policy.limits.max_chars) {
    return {
      allow: false,
      code: 'TTS_TEXT_TOO_LONG',
      reason: `text length ${text.length} > max_chars ${policy.limits.max_chars}`
    };
  }

  // must_speak_if is advisory; deny rules/limits still dominate.
  const mustSpeak = inputType === 'audio' && sentenceCount <= 4;
  const maySpeak = sentenceCount <= 4;

  if (!mustSpeak && !maySpeak) {
    return { allow: false, code: 'TTS_POLICY_REJECTED', reason: 'reply too complex for speech mode' };
  }

  return { allow: true, code: 'OK', reason: mustSpeak ? 'must-speak matched' : 'may-speak matched' };
}

module.exports = {
  loadVoicePolicy,
  evaluateVoicePolicy,
  defaultPolicy
};
