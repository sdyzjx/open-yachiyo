(function expose(root) {
  function createAvatarTransfer({ element, setVisible, stopVoice, greet, height = () => window.innerHeight }) {
    let host = false;
    let deviceId = null;
    let prepared = false;
    let animation = null;
    const show = (visible) => { setVisible(visible); if (!visible) stopVoice(); };
    const reset = () => { animation?.cancel(); animation = null; element.style.transform = ''; };
    async function animate(frames, options) {
      animation = element.animate(frames, { fill: 'forwards', ...options });
      try { await animation.finished; } catch { /* Cancellation restores current ownership. */ }
    }
    return {
      get isHost() { return host; },
      async handle({ topic, data = {} }) {
        if (topic === 'avatar.connection.lost') { host = false; prepared = false; reset(); show(false); }
        if (topic === 'avatar.welcome' || topic === 'avatar.host.changed') {
          deviceId = data.device_id || deviceId;
          host = data.host === 'desktop' || data.host === deviceId;
          if (!prepared || !host) { reset(); show(host); }
        } else if (topic === 'avatar.transfer.prepare') {
          prepared = true; reset(); show(false);
          element.style.transform = `translateY(${height() + element.getBoundingClientRect().height}px)`;
        } else if (topic === 'avatar.transfer.exit') {
          stopVoice();
          await animate([{ transform: 'translateY(0)' }, { transform: `translateY(${height() * 0.02}px)` }], { duration: 120, easing: 'ease-out' });
          await animate([{ transform: `translateY(${height() * 0.02}px)` }, { transform: `translateY(${height() + element.getBoundingClientRect().height}px)` }], { duration: 480, easing: 'cubic-bezier(.55,0,.75,.2)' });
          show(false); reset();
        } else if (topic === 'avatar.transfer.enter') {
          show(true);
          await animate([{ transform: `translateY(${height() + element.getBoundingClientRect().height}px)` }, { transform: 'translateY(0)' }], { duration: 520, easing: 'cubic-bezier(.2,.8,.2,1.1)' });
          prepared = false; reset();
          await greet();
        } else if (topic === 'avatar.transfer.cancel' || topic === 'avatar.transfer.failed') {
          prepared = false; reset(); show(host);
        }
        return { ok: true };
      }
    };
  }
  if (typeof module === 'object' && module.exports) module.exports = { createAvatarTransfer };
  else root.AvatarTransfer = { createAvatarTransfer };
})(typeof window === 'undefined' ? globalThis : window);
