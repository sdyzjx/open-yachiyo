function validPattern(value) {
  return typeof value === 'string' && value.length <= 256 && value.split('.').every((part) => /^(\*\*?|[\w-]+)$/.test(part));
}

function matches(pattern, topic) {
  if (pattern === '*') return true;
  const p = pattern.split('.');
  const t = topic.split('.');
  const visit = (i, j) => {
    if (i === p.length) return j === t.length;
    if (p[i] === '**') return visit(i + 1, j) || (j < t.length && visit(i, j + 1));
    return j < t.length && (p[i] === '*' || p[i] === t[j]) && visit(i + 1, j + 1);
  };
  return visit(0, 0);
}

module.exports = { matches, validPattern };
