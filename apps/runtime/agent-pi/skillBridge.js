const { loadPi } = require('./loadPi');
const { loadSkills } = require('../skills/skillLoader');
const { filterEligibleSkills } = require('../skills/skillEligibility');
const { SkillConfigStore } = require('../skills/skillConfigStore');

async function createResourceLoader({ cwd = process.cwd(), agentDir, settingsManager, systemPrompt, getSystemPrompt, skillConfigStore,
  extensionFactories = [] }) {
  const { sdk } = await loadPi();
  const store = skillConfigStore || new SkillConfigStore();
  let skillResources = { skills: [], diagnostics: [] };
  const loader = new sdk.DefaultResourceLoader({
    cwd, agentDir, settingsManager,
    noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
    extensionFactories,
    systemPromptOverride: () => [getSystemPrompt?.() ?? systemPrompt, sdk.formatSkillsForPrompt(skillResources.skills, 'indirect')].filter(Boolean).join('\n\n'),
    appendSystemPromptOverride: () => [],
    agentsFilesOverride: () => ({ agentsFiles: [] }),
    skillsOverride: () => {
      const config = store.load();
      const loaded = loadSkills({ workspaceDir: cwd, config });
      const { accepted } = filterEligibleSkills({ skills: loaded, config });
      // Existing source precedence/eligibility first, pi parses and owns the final resources.
      skillResources = sdk.loadSkills({ cwd, agentDir, includeDefaults: false, skillPaths: accepted.map((skill) => skill.filePath) });
      return skillResources;
    }
  });
  await loader.reload();
  return loader;
}

module.exports = { createResourceLoader };
