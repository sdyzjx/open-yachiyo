(function expose(root) {
  function createAvatarTransfer({ element, setVisible, stopVoice, greet, height = () => window.innerHeight }) {
    let host = false;
    let deviceId = null;
    let prepared = false;
    let animation = null;
    let generation = 0;
    let exiting = false;
    const show = (visible) => { setVisible(visible); if (!visible) stopVoice(); };
    const reset = () => { animation?.cancel(); animation = null; element.style.transform = ''; };
    async function animate(frames, options) {
      animation = element.animate(frames, { fill: 'forwards', ...options });
      try { await animation.finished; } catch { /* Cancellation restores current ownership. */ }
    }
    return {
      get isHost() { return host && !exiting && !prepared; },
      async handle({ topic, data = {} }) {
        if (!['avatar.connection.lost', 'avatar.welcome', 'avatar.host.changed', 'avatar.transfer.prepare', 'avatar.transfer.exit', 'avatar.transfer.enter', 'avatar.transfer.cancel', 'avatar.transfer.failed'].includes(topic)) return { ok: true };
        const current = ++generation;
        if (topic === 'avatar.connection.lost') { host = false; prepared = false; exiting = false; reset(); show(false); }
        if (topic === 'avatar.welcome' || topic === 'avatar.host.changed') {
          exiting = false;
          deviceId = data.device_id || deviceId;
          host = data.host === 'desktop' || data.host === deviceId;
          if (!prepared || !host) { reset(); show(host); }
        } else if (topic === 'avatar.transfer.prepare') {
          prepared = true; reset(); show(false);
          element.style.transform = `translateY(${height() + element.getBoundingClientRect().height}px)`;
        } else if (topic === 'avatar.transfer.exit') {
          exiting = true; stopVoice();
          await animate([{ transform: 'translateY(0)' }, { transform: `translateY(${height() * 0.02}px)` }], { duration: 120, easing: 'ease-out' });
          if (current !== generation) return { ok: false };
          await animate([{ transform: `translateY(${height() * 0.02}px)` }, { transform: `translateY(${height() + element.getBoundingClientRect().height}px)` }], { duration: 480, easing: 'cubic-bezier(.55,0,.75,.2)' });
          if (current !== generation) return { ok: false };
          show(false); reset();
        } else if (topic === 'avatar.transfer.enter') {
          show(true);
          await animate([{ transform: `translateY(${height() + element.getBoundingClientRect().height}px)` }, { transform: 'translateY(0)' }], { duration: 520, easing: 'cubic-bezier(.2,.8,.2,1.1)' });
          if (current !== generation) return { ok: false };
          prepared = false; exiting = false; reset();
          if (host) await greet();
        } else if (topic === 'avatar.transfer.cancel' || topic === 'avatar.transfer.failed') {
          prepared = false; exiting = false; reset(); show(host);
        }
        return { ok: true };
      }
    };
  }
  if (typeof module === 'object' && module.exports) module.exports = { createAvatarTransfer };
  else root.AvatarTransfer = { createAvatarTransfer };
})(typeof window === 'undefined' ? globalThis : window);
