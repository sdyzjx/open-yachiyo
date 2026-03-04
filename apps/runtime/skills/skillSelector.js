class SkillSelector {
  constructor({ now = () => Date.now() } = {}) {
    this.now = now;
    this.lastSelectedAt = new Map();
  }

  static toLowerText(input) {
    return String(input || '').toLowerCase();
  }

  static detectInputIntentTags(text) {
    const tags = new Set();
    if (!text) return tags;

    if (/(音乐|歌曲|歌单|播放|暂停|下一首|上一首|music|song|playlist|track|apple music)/i.test(text)) tags.add('music');
    if (/(天气|温度|气温|下雨|weather|forecast|temperature|rain)/i.test(text)) tags.add('weather');
    if (/(命令|终端|shell|bash|zsh|command|terminal)/i.test(text)) tags.add('shell');
    if (/(文件|读文件|写文件|file|write|read|path|目录|folder|dir)/i.test(text)) tags.add('file');

    return tags;
  }

  static detectSkillIntentTags({ name, desc, keywords = [], aliases = [] }) {
    const tags = new Set();
    const merged = [name, desc, ...keywords, ...aliases].filter(Boolean).join(' ').toLowerCase();

    if (/(music|song|playlist|track|apple music|player)/.test(merged)) tags.add('music');
    if (/(weather|forecast|temperature|rain)/.test(merged)) tags.add('weather');
    if (/(shell|bash|zsh|terminal|command|cli)/.test(merged)) tags.add('shell');
    if (/(file|write|read|path|folder|directory)/.test(merged)) tags.add('file');

    return tags;
  }

  scoreSkill({ skill, input, trigger }) {
    let score = 0;
    const text = SkillSelector.toLowerText(input);
    const name = SkillSelector.toLowerText(skill.name);
    const desc = SkillSelector.toLowerText(skill.description);
    const explicitSet = new Set((trigger?.explicitSkills || []).map((v) => String(v || '').toLowerCase()));
    const explicitMatched = explicitSet.has(name);
    const ruleKeywords = trigger?.rules?.[skill.name]?.keywords || [];
    const entryAliases = Array.isArray(trigger?.entries?.[skill.name]?.aliases)
      ? trigger.entries[skill.name].aliases
      : [];
    const skillKeywords = Array.isArray(skill.keywords) ? skill.keywords : [];
    const skillAliases = Array.isArray(skill.aliases) ? skill.aliases : [];
    const mergedKeywords = [...ruleKeywords, ...skillKeywords];
    const mergedAliases = [...entryAliases, ...skillAliases];
    const inputTags = SkillSelector.detectInputIntentTags(text);
    const skillTags = SkillSelector.detectSkillIntentTags({
      name,
      desc,
      keywords: mergedKeywords,
      aliases: mergedAliases
    });

    if (explicitMatched) score += 100;
    if (text.includes(name)) score += 60;

    for (const kw of mergedKeywords) {
      if (text.includes(String(kw).toLowerCase())) score += 20;
    }

    for (const alias of mergedAliases) {
      if (text.includes(String(alias).toLowerCase())) score += 40;
    }

    for (const tag of inputTags) {
      if (skillTags.has(tag)) score += 30;
    }

    if (desc && text && desc.split(/\s+/).some((w) => w && text.includes(w))) score += 5;

    const risk = trigger?.entries?.[skill.name]?.risk || 'safe';
    if (risk === 'danger') score -= 50;
    if (risk === 'review') score -= 10;

    return score;
  }

  select({ skills, input, triggerConfig }) {
    const cfg = triggerConfig || {};
    const threshold = Number(cfg.scoreThreshold ?? 45);
    const maxSelected = Number(cfg.maxSelectedPerTurn ?? 2);
    const cooldownMs = Number(cfg.cooldownMs ?? 15000);

    const scored = [];
    const dropped = [];
    const nowTs = this.now();
    const explicitSet = new Set((cfg.explicitSkills || []).map((v) => String(v || '').toLowerCase()));

    for (const skill of skills || []) {
      const isExplicit = explicitSet.has(String(skill?.name || '').toLowerCase());
      const last = this.lastSelectedAt.get(skill.name);
      if (!isExplicit && typeof last === 'number' && nowTs - last < cooldownMs) {
        dropped.push({ name: skill.name, reason: 'cooldown' });
        continue;
      }

      const score = this.scoreSkill({ skill, input, trigger: cfg });
      if (score < threshold) {
        dropped.push({ name: skill.name, reason: `below_threshold:${score}` });
        continue;
      }

      const risk = cfg.entries?.[skill.name]?.risk || 'safe';
      if (risk === 'danger') {
        dropped.push({ name: skill.name, reason: 'risk_blocked' });
        continue;
      }

      scored.push({ skill, score });
    }

    scored.sort((a, b) => b.score - a.score || a.skill.name.localeCompare(b.skill.name));
    const selected = scored.slice(0, Math.max(1, maxSelected)).map((v) => v.skill);

    for (const skill of selected) {
      this.lastSelectedAt.set(skill.name, nowTs);
    }

    return {
      selected,
      dropped,
      scored: scored.map((v) => ({ name: v.skill.name, score: v.score }))
    };
  }
}

module.exports = { SkillSelector };
