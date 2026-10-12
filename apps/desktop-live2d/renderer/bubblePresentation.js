(function exposeBubblePresentation(root) {
  'use strict';

  function truncateLines(lines, maxCharacters = 180) {
    const safeLines = Array.isArray(lines) ? lines : [];
    const limit = Math.max(24, Number(maxCharacters) || 180);
    let remaining = limit;
    let truncated = false;
    const output = [];
    for (const line of safeLines) {
      const characters = Array.from(String(line?.text || ''));
      if (characters.length <= remaining) {
        output.push({ ...line, text: characters.join('') });
        remaining -= characters.length;
        continue;
      }
      output.push({ ...line, text: `${characters.slice(0, Math.max(0, remaining)).join('').trimEnd()}…` });
      truncated = true;
      break;
    }
    if (output.length < safeLines.length) truncated = true;
    return { lines: output, truncated };
  }

  const api = { truncateLines };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BubblePresentation = api;
})(typeof window === 'undefined' ? globalThis : window);
