/* Launcher app drawer content (task 4): grid of launchable apps with search. Slide animation lives in app.js. */
(function (global) {
  'use strict';

  function create({ list, search, bridge, onLaunch }) {
    let apps = [];
    let loaded = false;

    function render() {
      const q = search.value.trim().toLowerCase();
      const shown = apps.filter((a) => !q || a.label.toLowerCase().includes(q) || a.package.toLowerCase().includes(q));
      list.replaceChildren(...shown.map((a) => {
        const b = document.createElement('button');
        b.className = 'app-item';
        b.type = 'button';
        const icon = document.createElement('div');
        icon.className = 'app-icon';
        const img = document.createElement('img');
        img.loading = 'lazy';
        img.src = a.icon_url;
        img.alt = '';
        icon.appendChild(img);
        const label = document.createElement('div');
        label.className = 'app-label';
        label.textContent = a.label;
        b.append(icon, label);
        b.onclick = () => { bridge.call('launchApp', a.package); if (onLaunch) onLaunch(a); };
        return b;
      }));
    }

    function ensureLoaded(force) {
      if (loaded && !force) return;
      loaded = true;
      apps = bridge.json('listLaunchableApps', []).sort((a, b) => a.label.localeCompare(b.label, 'zh'));
      render();
    }

    search.addEventListener('input', render);
    return { ensureLoaded, refresh: () => ensureLoaded(true) };
  }

  global.YachiyoLauncher = { create };
})(window);
