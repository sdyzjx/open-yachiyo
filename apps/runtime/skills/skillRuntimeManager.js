const { SkillConfigStore } = require('./skillConfigStore');
const { loadSkills, resolveSkillRoots } = require('./skillLoader');
const { filterEligibleSkills } = require('./skillEligibility');
const { SkillSelector } = require('./skillSelector');
const { clipSkillsForPrompt } = require('./skillPromptBudgeter');
const { getRuntimePaths } = require('./runtimePaths');
const { SkillWatcher } = require('./skillWatcher');
const { SkillSnapshotStore } = require('./skillSnapshotStore');
const { SkillTelemetry } = require('./skillTelemetry');

function extractExplicitSkillsFromInput(input, skills) {
  const raw = String(input || '');
  if (!raw.trim()) return [];

  const lower = raw.toLowerCase();
  const byName = new Map((skills || []).map((s) => [String(s.name || '').toLowerCase(), s.name]));
  const explicit = new Set();

  const markerRegex = /\$([a-zA-Z0-9._-]+)/g;
  let match = markerRegex.exec(raw);
  while (match) {
    const token = String(match[1] || '').toLowerCase();
    const skillName = byName.get(token);
    if (skillName) explicit.add(skillName);
    match = markerRegex.exec(raw);
  }

  const mentionRegex = /(?:使用|用|invoke|use)\s+([a-zA-Z0-9._-]+)/gi;
  match = mentionRegex.exec(raw);
  while (match) {
    const token = String(match[1] || '').toLowerCase();
    const skillName = byName.get(token);
    if (skillName) explicit.add(skillName);
    match = mentionRegex.exec(raw);
  }

  for (const [normalizedName, originalName] of byName.entries()) {
    if (normalizedName && lower.includes(normalizedName)) {
      explicit.add(originalName);
    }
  }

  return Array.from(explicit);
}

function isSkillDiscoveryQuery(input) {
  const text = String(input || '').trim().toLowerCase();
  if (!text) return false;
  return /(?:\bskills?\b|available\s+skills?|你有什么技能|有哪些技能|有什么技能|你会什么|能力列表|可用技能)/i.test(text);
}

function resolveDefaultSessionSkills(skills, config) {
  const names = config?.defaults?.sessionSkills?.names || [];
  if (config?.defaults?.sessionSkills?.enabled !== true || !Array.isArray(names) || names.length === 0) {
    return [];
  }

  const byName = new Map((skills || []).map((skill) => [String(skill.name || '').toLowerCase(), skill]));
  const selected = [];
  const seen = new Set();
  for (const name of names) {
    const normalized = String(name || '').toLowerCase();
    const skill = byName.get(normalized);
    if (!skill || seen.has(skill.name)) continue;
    seen.add(skill.name);
    selected.push(skill);
  }
  return selected;
}

function mergeSkillSelections(primary, secondary) {
  const merged = [];
  const seen = new Set();
  for (const skill of [...(primary || []), ...(secondary || [])]) {
    if (!skill || seen.has(skill.name)) continue;
    seen.add(skill.name);
    merged.push(skill);
  }
  return merged;
}

class SkillRuntimeManager {
  constructor({ workspaceDir, configStore, selector, snapshotStore, telemetry } = {}) {
    this.workspaceDir = workspaceDir || process.cwd();
    this.configStore = configStore || new SkillConfigStore();
    this.selector = selector || new SkillSelector();
    this.snapshotStore = snapshotStore || new SkillSnapshotStore();

    const cfg = this.configStore.load();
    const runtimePaths = getRuntimePaths({
      envKey: cfg.home.envKey,
      defaultPath: cfg.home.defaultPath
    });

    this.telemetry = telemetry || new SkillTelemetry({ logsDir: runtimePaths.logsDir });
    this.watcher = null;

    if (cfg.load.watch) {
      const roots = resolveSkillRoots({ workspaceDir: this.workspaceDir, config: cfg }).map((r) => r.dir);
      this.watcher = new SkillWatcher({
        roots,
        debounceMs: cfg.load.watchDebounceMs,
        onChange: ({ changedPath, reason }) => {
          const bumped = this.snapshotStore.bump(reason);
          this.telemetry.write({ event: 'skills.bump', changedPath, ...bumped });
        }
      });
      this.watcher.start();
    }
  }

  stop() {
    this.watcher?.stop();
  }

  buildTurnContext({ sessionId = 'default', input }) {
    const config = this.configStore.load();
    const cached = this.snapshotStore.get(sessionId);
    if (cached && cached.version === this.snapshotStore.getVersion() && cached.input === input) {
      return cached;
    }

    const loaded = loadSkills({ workspaceDir: this.workspaceDir, config });
    const { accepted, dropped } = filterEligibleSkills({ skills: loaded, config });
    const explicitSkills = extractExplicitSkillsFromInput(input, accepted);
    const discoveryMode = isSkillDiscoveryQuery(input);
    const defaultSessionSkills = resolveDefaultSessionSkills(accepted, config);
    const selectedResult = this.selector.select({
      skills: accepted,
      input,
      triggerConfig: {
        ...config.trigger,
        entries: config.entries,
        rules: config.trigger?.rules || {},
        explicitSkills
      }
    });

    const promptResult = clipSkillsForPrompt(
      discoveryMode ? accepted : mergeSkillSelections(defaultSessionSkills, selectedResult.selected),
      config.limits || {}
    );

    const context = {
      prompt: promptResult.prompt,
      selected: promptResult.selected.map((s) => s.name),
      defaultSelected: defaultSessionSkills.map((s) => s.name),
      dropped: discoveryMode ? dropped : [...dropped, ...selectedResult.dropped],
      clippedBy: promptResult.clippedBy,
      input
    };

    this.snapshotStore.set(sessionId, context);
    this.telemetry.write({
      event: 'skills.turn',
      sessionId,
      selected: context.selected,
      defaultSelected: context.defaultSelected,
      droppedCount: context.dropped.length,
      clippedBy: context.clippedBy
    });

    return context;
  }
}

module.exports = { SkillRuntimeManager };
