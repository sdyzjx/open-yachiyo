const THEME_KEY = 'yachiyo_theme_v1';

const el = {
  step1: document.getElementById('step1'),
  step2: document.getElementById('step2'),
  step3: document.getElementById('step3'),
  stepMark1: document.getElementById('stepMark1'),
  stepMark2: document.getElementById('stepMark2'),
  stepMark3: document.getElementById('stepMark3'),
  statusText: document.getElementById('statusText'),
  llmKey: document.getElementById('llmKey'),
  llmDisplayName: document.getElementById('llmDisplayName'),
  llmBaseUrl: document.getElementById('llmBaseUrl'),
  llmModel: document.getElementById('llmModel'),
  llmApiKey: document.getElementById('llmApiKey'),
  llmTimeoutMs: document.getElementById('llmTimeoutMs'),
  saveProviderBtn: document.getElementById('saveProviderBtn'),
  ttsApiKey: document.getElementById('ttsApiKey'),
  ttsBaseUrl: document.getElementById('ttsBaseUrl'),
  voicePreferredName: document.getElementById('voicePreferredName'),
  voiceManualId: document.getElementById('voiceManualId'),
  voiceAudioFile: document.getElementById('voiceAudioFile'),
  referenceAudioPath: document.getElementById('referenceAudioPath'),
  openReferenceAudioDirBtn: document.getElementById('openReferenceAudioDirBtn'),
  copyReferenceAudioPathBtn: document.getElementById('copyReferenceAudioPathBtn'),
  referenceAudioDownloadLink: document.getElementById('referenceAudioDownloadLink'),
  referenceAudioPreviewLink: document.getElementById('referenceAudioPreviewLink'),
  voiceCloneBtn: document.getElementById('voiceCloneBtn'),
  voiceSaveManualBtn: document.getElementById('voiceSaveManualBtn'),
  backToStep1Btn: document.getElementById('backToStep1Btn'),
  prefAutoReplyEnabled: document.getElementById('prefAutoReplyEnabled'),
  prefMaxChars: document.getElementById('prefMaxChars'),
  prefCooldownSec: document.getElementById('prefCooldownSec'),
  prefMaxTtsPerMinute: document.getElementById('prefMaxTtsPerMinute'),
  prefPersonaMode: document.getElementById('prefPersonaMode'),
  prefMaxContextChars: document.getElementById('prefMaxContextChars'),
  prefSkillsWorkspace: document.getElementById('prefSkillsWorkspace'),
  prefSkillsGlobal: document.getElementById('prefSkillsGlobal'),
  savePrefsBtn: document.getElementById('savePrefsBtn'),
  backToStep2Btn: document.getElementById('backToStep2Btn'),
  completeBtn: document.getElementById('completeBtn')
};

const state = {
  referenceAudioUserPath: '',
  referenceAudioUserDir: ''
};

function applyTheme(pref) {
  const resolved = pref === 'auto'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : pref;
  document.documentElement.setAttribute('data-theme', resolved);
}

function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  const preferred = saved || 'auto';
  applyTheme(preferred);
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    const current = localStorage.getItem(THEME_KEY) || 'auto';
    if (current === 'auto') applyTheme('auto');
  });
}

function getTtsMode() {
  const checked = document.querySelector('input[name="ttsMode"]:checked');
  return checked ? checked.value : 'normal';
}

function setStatus(text, isError = false) {
  el.statusText.textContent = text;
  el.statusText.style.color = isError ? '#ff7a9f' : 'var(--muted)';
}

function switchStep(step) {
  const s1 = step === 1;
  const s2 = step === 2;
  const s3 = step === 3;

  el.step1.classList.toggle('hidden', !s1);
  el.step2.classList.toggle('hidden', !s2);
  el.step3.classList.toggle('hidden', !s3);
  el.stepMark1.classList.toggle('active', s1);
  el.stepMark2.classList.toggle('active', s2);
  el.stepMark3.classList.toggle('active', s3);
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  const data = await res.json();
  if (!data.ok) {
    const error = new Error(data.error || `HTTP ${res.status}`);
    error.code = data.code || 'UNKNOWN';
    throw error;
  }
  return data;
}

async function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('读取音频文件失败'));
    reader.readAsDataURL(file);
  });
}

async function saveProvider() {
  setStatus('正在保存 LLM provider...');
  try {
    await fetchJson('/api/onboarding/provider/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: {
          key: el.llmKey.value.trim(),
          display_name: el.llmDisplayName.value.trim(),
          base_url: el.llmBaseUrl.value.trim(),
          model: el.llmModel.value.trim(),
          api_key: el.llmApiKey.value.trim(),
          timeout_ms: Number(el.llmTimeoutMs.value) || 20000
        },
        active_provider: el.llmKey.value.trim()
      })
    });
    setStatus('LLM provider 已保存');
    switchStep(2);
  } catch (err) {
    setStatus(`[${err.code || 'ERROR'}] ${err.message}`, true);
  }
}

async function saveManualVoiceId() {
  const voiceId = el.voiceManualId.value.trim();
  if (!voiceId) {
    setStatus('请填写 Voice ID', true);
    return;
  }
  setStatus('正在保存手动 Voice ID...');
  try {
    await fetchJson('/api/onboarding/voice/save-manual', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        target_mode: getTtsMode(),
        api_key: el.ttsApiKey.value.trim(),
        base_url: el.ttsBaseUrl.value.trim(),
        voice_id: voiceId
      })
    });
    setStatus('Voice ID 已保存');
    switchStep(3);
  } catch (err) {
    setStatus(`[${err.code || 'ERROR'}] ${err.message}`, true);
  }
}

async function cloneVoice() {
  const file = el.voiceAudioFile.files?.[0];
  if (!file) {
    setStatus('请先选择音频文件', true);
    return;
  }
  setStatus('正在克隆声线...');
  try {
    const audioDataUrl = await fileToDataUrl(file);
    await fetchJson('/api/onboarding/voice/clone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        target_mode: getTtsMode(),
        api_key: el.ttsApiKey.value.trim(),
        base_url: el.ttsBaseUrl.value.trim(),
        preferred_name: el.voicePreferredName.value.trim(),
        audio_data_url: audioDataUrl
      })
    });
    setStatus('声线克隆成功，已写入配置');
    switchStep(3);
  } catch (err) {
    setStatus(`[${err.code || 'ERROR'}] ${err.message}`, true);
  }
}

async function savePreferences() {
  setStatus('正在保存偏好...');
  try {
    await fetchJson('/api/onboarding/preferences/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        voice_policy: {
          auto_reply_enabled: el.prefAutoReplyEnabled.checked,
          max_chars: Number(el.prefMaxChars.value) || 220,
          cooldown_sec_per_session: Number(el.prefCooldownSec.value) || 2,
          max_tts_calls_per_minute: Number(el.prefMaxTtsPerMinute.value) || 3
        },
        persona_defaults: {
          mode: el.prefPersonaMode.value,
          max_context_chars: Number(el.prefMaxContextChars.value) || 1500
        },
        skills: {
          workspace: el.prefSkillsWorkspace.checked,
          global: el.prefSkillsGlobal.checked
        }
      })
    });
    setStatus('偏好已保存');
  } catch (err) {
    setStatus(`[${err.code || 'ERROR'}] ${err.message}`, true);
  }
}

async function completeOnboarding() {
  setStatus('正在完成 onboarding...');
  try {
    await fetchJson('/api/onboarding/complete', { method: 'POST' });
    setStatus('配置完成，正在进入主界面...');
    setTimeout(() => {
      window.location.href = '/';
    }, 500);
  } catch (err) {
    setStatus(`[${err.code || 'ERROR'}] ${err.message}`, true);
  }
}

async function initReferenceAudioInfo() {
  try {
    const response = await fetchJson('/api/onboarding/reference-audio');
    const data = response?.data || {};
    state.referenceAudioUserPath = String(data.user_path || '');
    state.referenceAudioUserDir = String(data.user_dir || '');

    const pathText = state.referenceAudioUserPath || String(data.bundled_path || '') || '未找到';
    el.referenceAudioPath.textContent = pathText;
    if (data.bundled_url) {
      el.referenceAudioDownloadLink.href = data.bundled_url;
      el.referenceAudioPreviewLink.href = data.bundled_url;
    }
  } catch (err) {
    el.referenceAudioPath.textContent = `获取失败: ${err.message || String(err)}`;
  }
}

async function openReferenceAudioDir() {
  const target = state.referenceAudioUserDir;
  if (!target) {
    setStatus('参考音频目录不可用', true);
    return;
  }

  const openPath = window.desktopRuntime && typeof window.desktopRuntime.openPath === 'function'
    ? window.desktopRuntime.openPath
    : null;
  if (!openPath) {
    setStatus(`请手动打开目录: ${target}`, true);
    return;
  }

  const result = await openPath(target);
  if (!result?.ok) {
    setStatus(`打开目录失败: ${result?.error || 'unknown error'}`, true);
    return;
  }
  setStatus('已打开参考音频目录');
}

async function copyReferenceAudioPath() {
  const target = state.referenceAudioUserPath || el.referenceAudioPath.textContent || '';
  if (!target) {
    setStatus('没有可复制的路径', true);
    return;
  }
  try {
    await navigator.clipboard.writeText(target);
    setStatus('参考音频路径已复制');
  } catch {
    setStatus('复制失败，请手动复制', true);
  }
}

async function init() {
  initTheme();
  await initReferenceAudioInfo();

  try {
    const stateResp = await fetchJson('/api/onboarding/state');
    if (stateResp?.data?.done) {
      window.location.href = '/';
      return;
    }
    const lastStep = String(stateResp?.data?.last_step || 'provider');
    if (lastStep === 'voice') switchStep(2);
    if (lastStep === 'preferences' || lastStep === 'complete') switchStep(3);
  } catch {
    // keep default step
  }

  el.saveProviderBtn.addEventListener('click', saveProvider);
  el.voiceCloneBtn.addEventListener('click', cloneVoice);
  el.openReferenceAudioDirBtn.addEventListener('click', openReferenceAudioDir);
  el.copyReferenceAudioPathBtn.addEventListener('click', copyReferenceAudioPath);
  el.voiceSaveManualBtn.addEventListener('click', saveManualVoiceId);
  el.backToStep1Btn.addEventListener('click', () => switchStep(1));
  el.backToStep2Btn.addEventListener('click', () => switchStep(2));
  el.savePrefsBtn.addEventListener('click', savePreferences);
  el.completeBtn.addEventListener('click', completeOnboarding);
}

void init();
