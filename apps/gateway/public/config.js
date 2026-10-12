const THEME_STORAGE_KEY = 'yachiyo_theme_v1';
const THEME_PREFERENCES = ['auto', 'light', 'dark'];
const DEFAULT_THEME_PREFERENCE = 'auto';

const elements = {
  activeProviderSelect: document.getElementById('activeProviderSelect'),
  providerCards: document.getElementById('providerCards'),
  statusText: document.getElementById('statusText'),
  addProviderBtn: document.getElementById('addProviderBtn'),
  reloadBtn: document.getElementById('reloadBtn'),
  saveBtn: document.getElementById('saveBtn'),
  loadYamlBtn: document.getElementById('loadYamlBtn'),
  saveYamlBtn: document.getElementById('saveYamlBtn'),
  rawYaml: document.getElementById('rawYaml'),
  themeSelect: document.getElementById('themeSelect')
};

const state = {
  activeProvider: '',
  providers: [],
  themePreference: DEFAULT_THEME_PREFERENCE
};

function normalizeThemePreference(value) {
  if (typeof value === 'string' && THEME_PREFERENCES.includes(value)) return value;
  return DEFAULT_THEME_PREFERENCE;
}

function resolveTheme(preference) {
  if (preference === 'auto') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return preference;
}

function applyTheme(preference) {
  const normalizedPreference = normalizeThemePreference(preference);
  const resolvedTheme = resolveTheme(normalizedPreference);
  document.documentElement.setAttribute('data-theme', resolvedTheme);
  state.themePreference = normalizedPreference;
  elements.themeSelect.value = normalizedPreference;
}

function persistThemePreference(preference) {
  localStorage.setItem(THEME_STORAGE_KEY, normalizeThemePreference(preference));
}

function loadThemePreference() {
  const raw = localStorage.getItem(THEME_STORAGE_KEY);
  applyTheme(raw);
}

function setStatus(text, isError = false) {
  elements.statusText.textContent = text;
  elements.statusText.className = `status ${isError ? 'err' : 'ok'}`;
}

function cloneProvider(provider = {}) {
  return {
    key: provider.key || '',
    type: provider.type || 'openai_compatible',
    display_name: provider.display_name || '',
    base_url: provider.base_url || '',
    model: provider.model || '',
    api_key_env: provider.api_key_env || '',
    api_key: provider.api_key || '',
    has_api_key: provider.has_api_key === true,
    timeout_ms: Number(provider.timeout_ms) || 20000
  };
}

function normalizeConfig(config) {
  const providers = Object.entries(config.providers || {}).map(([key, value]) => cloneProvider({ key, ...value }));
  return {
    activeProvider: config.active_provider || providers[0]?.key || '',
    providers
  };
}

function buildConfigFromState() {
  const providersMap = {};

  for (const provider of state.providers) {
    const key = provider.key.trim();
    if (!key) throw new Error('Provider key 不能为空');
    if (providersMap[key]) throw new Error(`Provider key 重复: ${key}`);

    if (!provider.base_url.trim()) throw new Error(`Provider ${key} 缺少 base_url`);
    if (!provider.model.trim()) throw new Error(`Provider ${key} 缺少 model`);

    const hasKey = provider.api_key.trim().length > 0 || provider.has_api_key === true;
    const hasEnv = provider.api_key_env.trim().length > 0;
    if (!hasKey && !hasEnv) {
      throw new Error(`Provider ${key} 需要填写 api_key 或 api_key_env`);
    }

    providersMap[key] = {
      type: 'openai_compatible',
      display_name: provider.display_name.trim() || key,
      base_url: provider.base_url.trim(),
      model: provider.model.trim(),
      timeout_ms: Number(provider.timeout_ms) || 20000,
      api_key_env: provider.api_key_env.trim() || undefined,
      api_key: provider.api_key.trim() || undefined
    };

    if (!providersMap[key].api_key_env) delete providersMap[key].api_key_env;
    if (!providersMap[key].api_key) delete providersMap[key].api_key;
  }

  if (!state.activeProvider || !providersMap[state.activeProvider]) {
    throw new Error('active provider 未设置或不存在');
  }

  return {
    active_provider: state.activeProvider,
    providers: providersMap
  };
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!data.ok) {
    throw new Error(data.error || `Request failed: ${response.status}`);
  }
  return data;
}

async function loadGraphConfig() {
  setStatus('Loading...');
  const { data } = await fetchJson('/api/config/providers/config');
  const next = normalizeConfig(data);
  state.activeProvider = next.activeProvider;
  state.providers = next.providers;
  render();
  setStatus('Loaded');
}

async function saveGraphConfig() {
  const config = buildConfigFromState();
  setStatus('Saving...');

  await fetchJson('/api/config/providers/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config })
  });

  await loadRawYaml();
  setStatus('Saved');
}

async function loadRawYaml() {
  const { yaml } = await fetchJson('/api/config/providers/raw');
  elements.rawYaml.value = yaml || '';
}

async function saveRawYaml() {
  setStatus('Saving YAML...');
  await fetchJson('/api/config/providers/raw', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ yaml: elements.rawYaml.value })
  });

  await loadGraphConfig();
  setStatus('YAML saved');
}

function onActiveProviderChange() {
  state.activeProvider = elements.activeProviderSelect.value;
}

function addProvider() {
  const baseName = 'provider';
  let index = 1;
  const used = new Set(state.providers.map((p) => p.key));
  while (used.has(`${baseName}_${index}`)) {
    index += 1;
  }

  const key = `${baseName}_${index}`;
  state.providers.push(cloneProvider({ key, display_name: key, type: 'openai_compatible' }));
  state.activeProvider = key;
  render();
}

function removeProvider(index) {
  if (state.providers.length <= 1) {
    setStatus('至少保留一个 provider', true);
    return;
  }

  const [removed] = state.providers.splice(index, 1);
  if (state.activeProvider === removed.key) {
    state.activeProvider = state.providers[0].key;
  }
  render();
}

function renderActiveProviderSelect() {
  const select = elements.activeProviderSelect;
  select.innerHTML = '';

  state.providers.forEach((provider) => {
    const option = document.createElement('option');
    option.value = provider.key;
    option.textContent = `${provider.display_name || provider.key} (${provider.key})`;
    select.appendChild(option);
  });

  select.value = state.activeProvider;
}

function createField(labelText, value, onInput, type = 'text') {
  const wrap = document.createElement('label');
  wrap.className = 'field';
  const title = document.createElement('div');
  title.textContent = labelText;
  title.style.color = 'var(--muted)';
  title.style.fontSize = '12px';
  title.style.marginBottom = '5px';

  const input = document.createElement('input');
  input.type = type;
  input.value = value ?? '';
  input.oninput = () => onInput(input.value);

  wrap.appendChild(title);
  wrap.appendChild(input);
  return wrap;
}

function renderProviderCards() {
  elements.providerCards.innerHTML = '';

  state.providers.forEach((provider, index) => {
    const card = document.createElement('div');
    card.className = 'provider-card';

    const head = document.createElement('div');
    head.className = 'provider-card-head';

    const title = document.createElement('strong');
    title.textContent = provider.display_name || provider.key;

    const removeBtn = document.createElement('button');
    removeBtn.className = 'btn';
    removeBtn.textContent = 'Remove';
    removeBtn.onclick = () => removeProvider(index);

    head.appendChild(title);
    head.appendChild(removeBtn);

    const grid = document.createElement('div');
    grid.className = 'provider-grid';

    grid.appendChild(createField('Provider Key', provider.key, (v) => {
      const prev = provider.key;
      provider.key = v.trim();
      if (state.activeProvider === prev) {
        state.activeProvider = provider.key;
      }
      renderActiveProviderSelect();
    }));

    grid.appendChild(createField('Display Name', provider.display_name, (v) => {
      provider.display_name = v;
      title.textContent = v || provider.key;
      renderActiveProviderSelect();
    }));

    grid.appendChild(createField('Base URL', provider.base_url, (v) => { provider.base_url = v; }));
    grid.appendChild(createField('Model', provider.model, (v) => { provider.model = v; }));

    grid.appendChild(createField('API Key Env', provider.api_key_env, (v) => { provider.api_key_env = v; }));
    grid.appendChild(createField('Inline API Key', provider.api_key, (v) => { provider.api_key = v; }));

    grid.appendChild(createField('Timeout (ms)', String(provider.timeout_ms), (v) => {
      provider.timeout_ms = Number(v) || 20000;
    }, 'number'));

    const typeWrap = document.createElement('div');
    typeWrap.className = 'field';
    typeWrap.classList.add('full');
    const typeLabel = document.createElement('div');
    typeLabel.textContent = 'Provider Type';
    typeLabel.style.color = 'var(--muted)';
    typeLabel.style.fontSize = '12px';
    typeLabel.style.marginBottom = '5px';

    const typeInput = document.createElement('input');
    typeInput.value = 'openai_compatible';
    typeInput.readOnly = true;

    typeWrap.appendChild(typeLabel);
    typeWrap.appendChild(typeInput);
    grid.appendChild(typeWrap);

    card.appendChild(head);
    card.appendChild(grid);

    elements.providerCards.appendChild(card);
  });
}

function render() {
  renderActiveProviderSelect();
  renderProviderCards();
}

function bindEvents() {
  elements.themeSelect.onchange = () => {
    const nextPreference = normalizeThemePreference(elements.themeSelect.value);
    persistThemePreference(nextPreference);
    applyTheme(nextPreference);
  };

  const themeMedia = window.matchMedia('(prefers-color-scheme: dark)');
  const handleThemeMediaChange = () => {
    if (state.themePreference !== 'auto') return;
    applyTheme('auto');
  };
  if (typeof themeMedia.addEventListener === 'function') {
    themeMedia.addEventListener('change', handleThemeMediaChange);
  } else if (typeof themeMedia.addListener === 'function') {
    themeMedia.addListener(handleThemeMediaChange);
  }

  elements.activeProviderSelect.onchange = onActiveProviderChange;
  elements.addProviderBtn.onclick = addProvider;
  elements.reloadBtn.onclick = async () => {
    try {
      await loadGraphConfig();
      await loadRawYaml();
    } catch (err) {
      setStatus(err.message || String(err), true);
    }
  };

  elements.saveBtn.onclick = async () => {
    try {
      await saveGraphConfig();
    } catch (err) {
      setStatus(err.message || String(err), true);
    }
  };

  elements.loadYamlBtn.onclick = async () => {
    try {
      await loadRawYaml();
      setStatus('YAML loaded');
    } catch (err) {
      setStatus(err.message || String(err), true);
    }
  };

  elements.saveYamlBtn.onclick = async () => {
    try {
      await saveRawYaml();
    } catch (err) {
      setStatus(err.message || String(err), true);
    }
  };
}

async function bootstrap() {
  loadThemePreference();
  bindEvents();

  try {
    await loadGraphConfig();
    await loadRawYaml();
  } catch (err) {
    setStatus(err.message || String(err), true);
  }
}

bootstrap();
