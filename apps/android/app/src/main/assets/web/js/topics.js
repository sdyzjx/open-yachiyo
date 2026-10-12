/* Hub topic pattern matching (contract C1.2: '*' one segment, '**' many, lone '*' = everything). UMD global YachiyoTopics. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.YachiyoTopics = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function matchTopic(pattern, topic) {
    if (typeof pattern !== 'string' || typeof topic !== 'string' || !pattern || !topic) return false;
    if (pattern === '*') return true;
    const p = pattern.split('.');
    const t = topic.split('.');
    for (let i = 0; i < p.length; i += 1) {
      if (p[i] === '**') return t.length > i;
      if (i >= t.length) return false;
      if (p[i] !== '*' && p[i] !== t[i]) return false;
    }
    return p.length === t.length;
  }

  // True when every topic matched by `requested` is also matched by `allowed`.
  function patternCovers(allowed, requested) {
    if (allowed === '*') return true;
    if (requested === '*') return false;
    const a = allowed.split('.');
    const r = requested.split('.');
    for (let i = 0; i < a.length; i += 1) {
      if (a[i] === '**') return r.length > i;
      if (i >= r.length) return false;
      if (r[i] === '**') return false;
      if (a[i] === '*') continue;
      if (a[i] !== r[i] || r[i] === '*') return false;
    }
    return a.length === r.length;
  }

  return { matchTopic, patternCovers };
});
