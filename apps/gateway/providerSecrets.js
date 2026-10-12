const YAML = require('yaml');

const SECRET_FIELD_RE = /^(?:api[_-]?key|access[_-]?token|auth[_-]?token|bearer[_-]?token|client[_-]?secret|password)$/i;
const SECRET_HEADER_RE = /(?:authorization|api[_-]?key|token|secret)/i;

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function isSecretField(key, parentKey) {
  if (String(key).endsWith('_env')) return false;
  return SECRET_FIELD_RE.test(key) || (parentKey === 'headers' && SECRET_HEADER_RE.test(key));
}

function redactNode(value, parentKey = '') {
  if (Array.isArray(value)) return value.map((item) => redactNode(item, parentKey));
  if (!isObject(value)) return value;
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    result[key] = isSecretField(key, parentKey) ? '' : redactNode(child, key);
  }
  return result;
}

function secretSubset(value, parentKey = '') {
  if (Array.isArray(value)) {
    const items = value.map((item) => secretSubset(item, parentKey));
    return items.some((item) => item !== undefined) ? items : undefined;
  }
  if (!isObject(value)) return undefined;
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    if (isSecretField(key, parentKey)) result[key] = clone(child);
    else {
      const nested = secretSubset(child, key);
      if (nested !== undefined) result[key] = nested;
    }
  }
  return Object.keys(result).length ? result : undefined;
}

function restoreNode(next, previous, parentKey = '') {
  if (Array.isArray(next)) return next.map((item, index) => restoreNode(item, previous?.[index], parentKey));
  if (!isObject(next)) return next;
  const result = {};
  for (const [key, child] of Object.entries(next)) {
    if (key === 'has_api_key') continue;
    if (isSecretField(key, parentKey) && (child === '' || child === null)) {
      if (previous?.[key] !== undefined) result[key] = clone(previous[key]);
    } else {
      result[key] = restoreNode(child, previous?.[key], key);
    }
  }
  if (isObject(previous)) {
    for (const [key, child] of Object.entries(previous)) {
      if (result[key] !== undefined) continue;
      if (isSecretField(key, parentKey)) result[key] = clone(child);
      else {
        const nested = secretSubset(child, key);
        if (nested !== undefined) result[key] = nested;
      }
    }
  }
  return result;
}

function redactProviderConfig(config) {
  const result = clone(config) || {};
  if (!isObject(result.providers)) return result;
  for (const [key, provider] of Object.entries(result.providers)) {
    const original = config.providers?.[key];
    result.providers[key] = redactNode(provider);
    result.providers[key].has_api_key = Boolean(original?.api_key || (original?.api_key_env && process.env[original.api_key_env]));
  }
  return result;
}

function restoreProviderSecrets(config, previousConfig) {
  const result = clone(config) || {};
  if (!isObject(result.providers)) return result;
  for (const [key, provider] of Object.entries(result.providers)) {
    result.providers[key] = restoreNode(provider, previousConfig?.providers?.[key]);
  }
  return result;
}

function redactProviderYaml(rawYaml) {
  const parsed = YAML.parse(String(rawYaml || '')) || {};
  return YAML.stringify(redactNode(parsed));
}

function restoreProviderYaml(rawYaml, previousConfig) {
  const parsed = YAML.parse(String(rawYaml || '')) || {};
  return YAML.stringify(restoreProviderSecrets(parsed, previousConfig));
}

module.exports = {
  redactProviderConfig,
  redactProviderYaml,
  restoreProviderSecrets,
  restoreProviderYaml
};
