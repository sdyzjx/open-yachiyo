#!/usr/bin/env node
// Regenerates docs/README.md from the categorized docs tree (see AGENT.md §2).
const fs = require('node:fs');
const path = require('node:path');

const DOCS_DIR = path.resolve(__dirname, '..', 'docs');

const CATEGORIES = [
  ['architecture', '架构 Architecture', '系统级架构与长期设计决策'],
  ['features', '功能 Features', '功能级文档（FEAT-*），每个用户可见功能一份'],
  ['guides', '指南 Guides', '配置、安装、打包等使用指南'],
  ['plans', '施工 Plans', '施工方案、实施计划、任务拆分'],
  ['experiments', '实验 Experiments', '实验记录（EXP-*）'],
  ['research', '调研 Research', '调研报告与方案对比'],
  ['modules', '模块参考 Modules', '代码模块 API 与内部结构'],
  ['testing', '测试 Testing', '测试策略与用例集（TC-*）'],
  ['debug', '排障 Debug', '调试指南与问题调查'],
  ['process', '流程 Process', '协作流程、SOP、阶段日志'],
  ['archive', '归档 Archive', '已废弃文档']
];

function listMarkdown(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listMarkdown(full));
    else if (entry.name.endsWith('.md')) out.push(full);
  }
  return out.sort();
}

function readTitle(file) {
  const firstHeading = fs.readFileSync(file, 'utf8').split('\n').find((line) => line.startsWith('# '));
  return firstHeading ? firstHeading.slice(2).trim() : path.basename(file, '.md');
}

function buildIndex() {
  const lines = [
    '# 文档索引 Docs Index',
    '',
    '> 本文件由 `npm run docs:index` 生成，请勿手工编辑。分类规则见仓库根目录 [AGENT.md](../AGENT.md)。',
    '',
    '运行时加载的文档：[memory_sop.md](memory_sop.md)（长期记忆 SOP，路径被代码引用，不要移动）。',
    ''
  ];
  for (const [dir, title, desc] of CATEGORIES) {
    const files = listMarkdown(path.join(DOCS_DIR, dir));
    lines.push(`## ${title}`, '', `${desc}。`, '');
    if (files.length === 0) {
      lines.push('_（暂无）_', '');
      continue;
    }
    for (const file of files) {
      const rel = path.relative(DOCS_DIR, file).split(path.sep).join('/');
      lines.push(`- [${readTitle(file)}](${rel})`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

if (require.main === module) {
  const target = path.join(DOCS_DIR, 'README.md');
  fs.writeFileSync(target, buildIndex(), 'utf8');
  console.log(`wrote ${path.relative(process.cwd(), target)}`);
}

module.exports = { buildIndex, CATEGORIES };
