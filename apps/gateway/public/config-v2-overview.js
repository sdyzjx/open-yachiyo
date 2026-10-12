// config-v2-overview.js — current model, voice and Device Hub status at a glance.
(function () {
  const { h, api, chip, card, register } = window.CV2;

  function providerName(voice, key) {
    const provider = voice.providers.find((item) => item.key === key);
    return provider?.display_name || key || '未配置';
  }

  function tile(label, value, detail, tone) {
    return h('section', { class: 'cv-tile y-glass' },
      h('span', { class: 'cv-tile-label', text: label }),
      h('strong', { class: 'cv-tile-value', title: value, text: value }),
      h('div', { class: 'cv-tile-sub' },
        h('span', { class: `cv-dot${tone === 'on' ? ' is-on' : ''}`, 'aria-hidden': 'true' }),
        h('span', { text: detail })));
  }

  function deviceCard(deviceState) {
    const devices = Array.isArray(deviceState.devices) ? deviceState.devices : [];
    return card('设备状态',
      h('div', { class: 'cv-device-summary' },
        h('div', {}, h('strong', { class: 'cv-device-count', text: String(devices.length) }), h('span', { class: 'cv-dim', text: ' 台设备在线' })),
        chip(`角色在 ${deviceState.avatar_host || '未知位置'}`, devices.length ? 'good' : 'warn')),
      devices.length
        ? h('div', { class: 'cv-list' }, devices.map((device) => h('div', { class: 'cv-row cv-row--tight' },
          h('span', { class: 'cv-dot is-on', 'aria-label': '在线' }),
          h('div', { class: 'cv-row-main' },
            h('strong', { text: device.alias || device.name || device.device_id }),
            h('span', { class: 'cv-mono cv-dim', text: `${device.device_type || 'device'} · ${device.device_id}` })),
          chip(device.mode === 'lockscreen' ? '锁屏' : '在线', 'good'))))
        : h('p', { class: 'cv-hint', text: '目前没有手机或桌面客户端连接到 Device Hub。' }));
  }

  register('overview', {
    async render(root, isCurrent) {
      const [models, voice, deviceState] = await Promise.all([
        api('GET', '/api/config/models'),
        api('GET', '/api/config/voice'),
        api('GET', '/api/device/devices')
      ]);
      if (!isCurrent()) return;
      const model = models.models.find((item) => item.ref === models.active);
      const enabledCount = models.enabled.length;
      const tts = voice.providers.find((item) => item.key === voice.active_tts);
      const asr = voice.providers.find((item) => item.key === voice.active_asr);
      root.replaceChildren(
        h('header', { class: 'cv-page-head cv-overview-head' },
          h('div', {}, h('span', { class: 'cv-eyebrow', text: 'YACHIYO CONTROL ROOM' }), h('h1', { text: '晚上好' }),
            h('p', { class: 'cv-hint', text: '这里是八千代当前使用的模型、声音与连接状态。' })),
          h('span', { class: 'cv-moon', 'aria-hidden': 'true', text: '◐' })),
        h('div', { class: 'cv-tiles' },
          tile('当前模型', model?.name || models.active || '未选择', `${models.active || '—'} · ${enabledCount} 个模型已启用`, models.active ? 'on' : 'off'),
          tile('语音合成', providerName(voice, voice.active_tts), tts ? `${tts.tts_model || '默认模型'} · ${tts.tts_voice || '默认音色'}` : '尚未配置 TTS', tts ? 'on' : 'off'),
          tile('语音识别', providerName(voice, voice.active_asr), asr ? (asr.model || '默认识别模型') : '尚未配置 ASR', asr ? 'on' : 'off'),
          tile('设备连接', `${deviceState.devices?.length || 0} 台在线`, `角色位置：${deviceState.avatar_host || '未知'}`, deviceState.devices?.length ? 'on' : 'off')),
        card('快捷入口', h('div', { class: 'cv-quick' },
          h('a', { class: 'y-btn y-btn--primary', href: '#models', text: '调整模型路由' }),
          h('a', { class: 'y-btn', href: '#voice', text: '配置语音服务' }),
          h('a', { class: 'y-btn', href: '#advanced', text: '打开高级配置' }),
          h('a', { class: 'y-btn y-btn--ghost', href: '/', text: '返回聊天' }))),
        deviceCard(deviceState));
    }
  });
})();
