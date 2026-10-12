const { loadPi } = require('./loadPi');
const { loadSkills } = require('../skills/skillLoader');
const { filterEligibleSkills } = require('../skills/skillEligibility');
const { SkillConfigStore } = require('../skills/skillConfigStore');

async function createResourceLoader({ cwd = process.cwd(), agentDir, settingsManager, systemPrompt, skillConfigStore,
  extensionFactories = [] }) {
  const { sdk } = await loadPi();
  const store = skillConfigStore || new SkillConfigStore();
  const loader = new sdk.DefaultResourceLoader({
    cwd, agentDir, settingsManager,
    noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
    extensionFactories,
    systemPromptOverride: () => systemPrompt,
    appendSystemPromptOverride: () => [],
    agentsFilesOverride: () => ({ agentsFiles: [] }),
    skillsOverride: () => {
      const config = store.load();
      const loaded = loadSkills({ workspaceDir: cwd, config });
      const { accepted } = filterEligibleSkills({ skills: loaded, config });
      // Existing source precedence/eligibility first, pi parses and owns the final resources.
      return sdk.loadSkills({ cwd, agentDir, includeDefaults: false, skillPaths: accepted.map((skill) => skill.filePath) });
    }
  });
  await loader.reload();
  return loader;
}

module.exports = { createResourceLoader };
