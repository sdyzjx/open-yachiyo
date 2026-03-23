const fs = require('fs');
const path = require('path');
const { getRuntimePaths } = require('./runtimePaths');
const { parseFrontmatter } = require('./frontmatter');

function extractSkillBody(raw) {
  if (typeof raw !== 'string' || !raw.startsWith('---')) return raw || '';
  const lines = raw.split(/\r?\n/);
  if (lines[0].trim() !== '---') return raw;

  let end = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === '---') {
      end = i;
      break;
    }
  }
  if (end === -1) return raw;
  return lines.slice(end + 1).join('\n').trim();
}

function listSkillDirs(rootDir, maxCandidates = 300) {
  if (!rootDir || !fs.existsSync(rootDir)) return [];
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .slice(0, Math.max(1, maxCandidates))
    .map((e) => path.join(rootDir, e.name));
}

function readSkillFromDir(dirPath, source, maxSkillFileBytes = 262144) {
  const skillPath = path.join(dirPath, 'SKILL.md');
  if (!fs.existsSync(skillPath)) return null;

  const st = fs.statSync(skillPath);
  if (st.size > maxSkillFileBytes) return null;

  const raw = fs.readFileSync(skillPath, 'utf8');
  const fm = parseFrontmatter(raw);
  const name = String(fm.name || path.basename(dirPath)).trim();
  const description = String(fm.description || '').trim();
  const keywords = String(fm.keywords || fm.trigger_keywords || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  const aliases = String(fm.aliases || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

  return {
    name,
    description,
    keywords,
    aliases,
    raw,
    body: extractSkillBody(raw),
    source,
    filePath: skillPath,
    baseDir: dirPath,
    frontmatter: fm
  };
}

function resolveSkillRoots({ workspaceDir, config }) {
  const roots = [];
  const runtimePaths = getRuntimePaths({
    envKey: config.home.envKey,
    defaultPath: config.home.defaultPath
  });

  for (const extra of config.load.extraDirs || []) {
    roots.push({ dir: path.resolve(extra), source: 'extra' });
  }

  if (config.load.global) {
    roots.push({ dir: runtimePaths.skillsDir, source: 'yachiyo-global' });
  }

  if (config.load.workspace !== false && workspaceDir) {
    roots.push({ dir: path.resolve(workspaceDir, 'skills'), source: 'workspace' });
  }

  return roots;
}

function loadSkills({ workspaceDir, config }) {
  const roots = resolveSkillRoots({ workspaceDir, config });
  const limits = config.limits || {};
  const maxCandidatesPerRoot = Number(limits.maxCandidatesPerRoot || 300);
  const maxSkillsLoadedPerSource = Number(limits.maxSkillsLoadedPerSource || 200);
  const maxSkillFileBytes = Number(limits.maxSkillFileBytes || 262144);

  const merged = new Map();
  for (const root of roots) {
    const dirs = listSkillDirs(root.dir, maxCandidatesPerRoot);
    let loadedCount = 0;
    for (const dirPath of dirs) {
      if (loadedCount >= maxSkillsLoadedPerSource) break;
      try {
        const skill = readSkillFromDir(dirPath, root.source, maxSkillFileBytes);
        if (!skill) continue;
        merged.set(skill.name, skill);
        loadedCount += 1;
      } catch {
        // skip malformed skills
      }
    }
  }

  return Array.from(merged.values()).sort((a, b) => a.name.localeCompare(b.name));
}

module.exports = {
  parseFrontmatter,
  extractSkillBody,
  listSkillDirs,
  readSkillFromDir,
  resolveSkillRoots,
  loadSkills
};
