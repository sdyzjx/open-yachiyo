#!/usr/bin/env node
// Lints docs/ against AGENT.md §2: placement, naming, header block, FEAT/TC/EXP sections,
// globally unique TC ids, and FEAT references to defined TC ids.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');
const AREAS = ['runtime', 'gateway', 'llm', 'device-hub', 'desktop', 'android', 'plugin', 'voice', 'live2d', 'docs'];
const CATEGORIES = ['architecture', 'features', 'guides', 'plans', 'experiments', 'research', 'modules', 'testing', 'debug', 'process', 'archive'];
const ROOT_ALLOWED = new Set(['README.md', 'memory_sop.md']);
const NAMING = {
  features: /^FEAT-[a-z0-9-]+\.md$/,
  testing: /^(TC-[a-z0-9-]+|TESTING)\.md$/,  // TESTING.md = 测试策略总览
  experiments: /^EXP-\d{8}-[a-z0-9-]+\.md$/
};
// Categories whose new-style documents must carry the header block (AGENT.md §2.1).
const HEADER_REQUIRED = new Set(['features', 'experiments']);
const HEADER_FIELDS = ['类型', '状态', '负责人', '更新', '关联'];
const FEAT_SECTIONS = ['概述', '行为', '接口', '配置', '限制', '测试用例'];
const EXP_SECTIONS = ['背景', '环境', '方法', '数据', '结论', '后续'];

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

function hasSection(text, keyword) {
  return new RegExp(`^#+ .*${keyword}`, 'm').test(text);
}

// New-style PLAN-* files follow PLAN-<area>-<slug>; historical plan names are kept as-is.
function checkAreaPrefixed(prefix, base) {
  const rest = base.slice(prefix.length + 1, -3);
  const area = AREAS.find((a) => rest.startsWith(`${a}-`));
  return area ? null : `${prefix} 名称需为 ${prefix}-<area>-<slug>，area ∈ ${AREAS.join('/')}`;
}

function lintDocs() {
  const problems = [];
  const report = (file, message) => problems.push({ file: path.relative(ROOT, file), message });
  const files = walk(DOCS);
  const tcDefs = new Map();
  const featRefs = [];

  for (const file of files) {
    const rel = path.relative(DOCS, file).split(path.sep);
    const base = path.basename(file);
    const text = fs.readFileSync(file, 'utf8');
    if (rel.length === 1) {
      if (!ROOT_ALLOWED.has(base)) report(file, 'docs/ 根目录不得放散落文档');
      continue;
    }
    const category = rel[0];
    if (!CATEGORIES.includes(category)) report(file, `未知分类目录 ${category}`);
    if (NAMING[category] && !NAMING[category].test(base)) report(file, `命名不符 ${NAMING[category]}`);
    if (category === 'features' && base.startsWith('FEAT-')) {
      const msg = checkAreaPrefixed('FEAT', base);
      if (msg) report(file, msg);
    }
    if (category === 'testing' && base.startsWith('TC-')) {
      const msg = checkAreaPrefixed('TC', base);
      if (msg) report(file, msg);
    }
    if (category === 'plans' && base.startsWith('PLAN-')) {
      const msg = checkAreaPrefixed('PLAN', base);
      if (msg) report(file, msg);
    }

    const isNewStyle = HEADER_REQUIRED.has(category)
      || (category === 'testing' && base.startsWith('TC-'))
      || (category === 'plans' && base.startsWith('PLAN-'))
      || /^(RESEARCH|HANDOFF)-/.test(base);
    if (isNewStyle) {
      const head = text.split('\n').slice(0, 12).join('\n');
      for (const field of HEADER_FIELDS) {
        if (!new RegExp(`^> ${field}:`, 'm').test(head)) report(file, `缺少文档头字段「${field}」`);
      }
    }
    if (category === 'features') {
      for (const section of FEAT_SECTIONS) {
        if (!hasSection(text, section)) report(file, `FEAT 缺少章节「${section}」`);
      }
      featRefs.push({ file, ids: [...new Set(text.match(/TC-[A-Z0-9]+-\d{3}/g) || [])] });
    }
    if (category === 'experiments') {
      for (const section of EXP_SECTIONS) {
        if (!hasSection(text, section)) report(file, `EXP 缺少章节「${section}」`);
      }
    }
    if (category === 'testing') {
      for (const line of text.split('\n')) {
        const match = line.match(/^(?:\|\s*|#+\s*)(TC-[A-Z0-9]+-\d{3})\b/);
        if (!match) continue;
        const prev = tcDefs.get(match[1]);
        if (prev && prev !== file) report(file, `用例 ID ${match[1]} 与 ${path.relative(ROOT, prev)} 重复`);
        tcDefs.set(match[1], file);
      }
    }
  }

  for (const { file, ids } of featRefs) {
    const missing = ids.filter((id) => !tcDefs.has(id));
    if (missing.length) report(file, `引用了未定义的用例 ${missing.join(', ')}`);
  }
  return problems;
}

if (require.main === module) {
  const problems = lintDocs();
  for (const p of problems) console.log(`✗ ${p.file}: ${p.message}`);
  console.log(problems.length ? `${problems.length} problem(s)` : 'docs lint passed');
  process.exitCode = problems.length ? 1 : 0;
}

module.exports = { lintDocs };
