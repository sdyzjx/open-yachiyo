function escapeCdata(text) {
  return String(text || '').replaceAll(']]>', ']]]]><![CDATA[>');
}

function formatSkillsForPrompt(skills) {
  const lines = ['<available_skills>'];
  for (const skill of skills || []) {
    lines.push(`  <skill>`);
    lines.push(`    <name>${skill.name}</name>`);
    lines.push(`    <description>${skill.description || ''}</description>`);
    lines.push(`    <location>${skill.filePath}</location>`);
    if (skill.injectScript === true) {
      lines.push(`    <script><![CDATA[${escapeCdata(skill.body || skill.raw || '')}]]></script>`);
    }
    lines.push(`  </skill>`);
  }
  lines.push('</available_skills>');
  return lines.join('\n');
}

function clipSkillsForPrompt(skills, limits) {
  const maxSkills = Math.max(1, Number(limits.maxSkillsInPrompt || 80));
  const maxChars = Math.max(1000, Number(limits.maxSkillsPromptChars || 24000));

  const byCount = (skills || []).slice(0, maxSkills);
  let clippedBy = null;
  if ((skills || []).length > byCount.length) clippedBy = 'count';

  const renderLen = (arr) => formatSkillsForPrompt(arr).length;

  if (renderLen(byCount) <= maxChars) {
    return {
      selected: byCount,
      clippedBy,
      prompt: formatSkillsForPrompt(byCount)
    };
  }

  let lo = 0;
  let hi = byCount.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (renderLen(byCount.slice(0, mid)) <= maxChars) lo = mid;
    else hi = mid - 1;
  }

  const selected = byCount.slice(0, lo);
  return {
    selected,
    clippedBy: 'chars',
    prompt: formatSkillsForPrompt(selected)
  };
}

module.exports = {
  formatSkillsForPrompt,
  clipSkillsForPrompt
};
