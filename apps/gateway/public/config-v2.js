// config-v2.js — shell: hash router for the four pages.
(function () {
  const { h } = window.CV2;
  const PAGES = [
    { id: 'overview', title: '概览' },
    { id: 'models', title: '模型与路由' },
    { id: 'voice', title: '语音' },
    { id: 'advanced', title: '高级' }
  ];
  const main = document.getElementById('cv-main');
  let token = 0;

  async function show() {
    const id = PAGES.some((p) => p.id === location.hash.slice(1)) ? location.hash.slice(1) : 'overview';
    const mine = ++token;
    document.querySelectorAll('.cv-nav-item').forEach((a) => {
      const active = a.dataset.page === id;
      a.classList.toggle('is-active', active);
      if (active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    const page = window.CV2.getPage(id);
    document.title = `${PAGES.find((p) => p.id === id).title} — 设置 — 八千代`;
    const root = h('div', { class: 'cv-page' });
    main.replaceChildren(root);
    main.scrollTop = 0;
    if (!page) { root.append(h('p', { class: 'cv-hint', text: '此页面尚未提供。' })); return; }
    try {
      await page.render(root, () => mine === token);
    } catch (err) {
      root.replaceChildren(h('div', { class: 'cv-error' }, h('strong', { text: '加载失败' }), h('p', { text: err.message })));
    }
  }

  window.addEventListener('hashchange', show);
  show();
})();
