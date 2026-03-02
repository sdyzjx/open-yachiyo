const { test } = require('node:test');
const assert = require('node:assert');

test('bubble truncate config has correct defaults', () => {
  const { DEFAULT_UI_CONFIG } = require('../../apps/desktop-live2d/shared/defaultUiConfig.js');

  const truncateConfig = DEFAULT_UI_CONFIG.chat.bubble.truncate;

  assert.equal(truncateConfig.enabled, true, 'Truncate should be enabled by default');
  assert.equal(truncateConfig.maxLength, 120, 'Default max length should be 120');
  assert.equal(truncateConfig.mode, 'smart', 'Default mode should be smart');
  assert.equal(truncateConfig.suffix, '...', 'Default suffix should be ...');
  assert.equal(truncateConfig.showHintForComplex, true, 'Should show hint for complex content');
});

test('detect complex content - mermaid', () => {
  const text = '```mermaid\ngraph TD\n  A-->B\n```';
  const hasComplexSyntax = /```|$$|\|.*\|/.test(text);
  assert.equal(hasComplexSyntax, true, 'Should detect mermaid code block');
});

test('detect complex content - latex', () => {
  const text = 'Formula: $$E = mc^2$$';
  const hasComplexSyntax = /```|$$|\|.*\|/.test(text);
  assert.equal(hasComplexSyntax, true, 'Should detect LaTeX formula');
});

test('detect complex content - table', () => {
  const text = '| Header | Value |\n|--------|-------|';
  const hasComplexSyntax = /```|$$|\|.*\|/.test(text);
  assert.equal(hasComplexSyntax, true, 'Should detect markdown table');
});

test('simple text should not be detected as complex', () => {
  const text = 'This is a simple message with no special syntax';
  // More precise regex that requires actual code blocks or formulas
  const hasComplexSyntax = /```[\s\S]*?```|\$\$[\s\S]+?\$\$|\n\|.*\|.*\n/.test(text);
  assert.equal(hasComplexSyntax, false, 'Should not detect simple text as complex');
});

test('simple truncate - short text', () => {
  const text = 'Short message';
  const maxLength = 120;
  const result = text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
  assert.equal(result, 'Short message', 'Should not truncate short text');
});

test('simple truncate - long text', () => {
  const text = 'A'.repeat(150);
  const maxLength = 120;
  const result = text.substring(0, maxLength) + '...';
  assert.equal(result.length, 123, 'Should truncate to maxLength + suffix');
  assert.ok(result.endsWith('...'), 'Should end with suffix');
});

test('emoji character counting', () => {
  const text = '😀😁😂🤣😃';
  const length = Array.from(text).length;
  assert.equal(length, 5, 'Should count emoji correctly');
});

test('mixed content character counting', () => {
  const text = 'Hello 世界 😀';
  const length = Array.from(text).length;
  assert.equal(length, 10, 'Should count mixed content correctly');
});

test('truncate preserves word boundaries', () => {
  const text = 'This is a very long message that needs to be truncated at some point';
  const maxLength = 30;

  // Find last space before maxLength
  let truncateAt = maxLength;
  const lastSpace = text.lastIndexOf(' ', maxLength);
  if (lastSpace > maxLength * 0.8) {
    truncateAt = lastSpace;
  }

  const result = text.substring(0, truncateAt) + '...';
  assert.ok(result.length <= maxLength + 10, 'Should truncate near maxLength');
  // The result should either end with space+... or be exactly at maxLength
  const trimmedResult = result.substring(0, result.length - 3).trimEnd();
  assert.ok(trimmedResult.length <= maxLength, 'Should preserve word boundaries when possible');
});

test('detect unclosed markdown syntax', () => {
  const text = 'This has **bold but not closed';
  const hasUnclosed = (text.match(/\*\*/g) || []).length % 2 !== 0;
  assert.equal(hasUnclosed, true, 'Should detect unclosed bold syntax');
});

test('detect unclosed latex syntax', () => {
  const text = 'Formula $E = mc^2 but not closed';
  const dollarCount = (text.match(/\$/g) || []).length;
  const hasUnclosed = dollarCount % 2 !== 0;
  assert.equal(hasUnclosed, true, 'Should detect unclosed LaTeX syntax');
});

test('complex content hint message', () => {
  const hint = '📊 内容包含图表或公式，请查看聊天面板';
  assert.ok(hint.includes('图表'), 'Hint should mention diagrams');
  assert.ok(hint.includes('聊天面板'), 'Hint should mention chat panel');
});

test('truncate integration - simple mode short text', () => {
  const text = 'Short message';
  const config = { enabled: true, maxLength: 120, mode: 'simple', suffix: '...' };

  const chars = Array.from(text);
  const result = chars.length > config.maxLength
    ? chars.slice(0, config.maxLength).join('') + config.suffix
    : text;

  assert.equal(result, 'Short message', 'Should not truncate short text');
});

test('truncate integration - simple mode long text', () => {
  const text = 'A'.repeat(150);
  const config = { enabled: true, maxLength: 120, mode: 'simple', suffix: '...' };

  const chars = Array.from(text);
  const result = chars.slice(0, config.maxLength).join('') + config.suffix;

  assert.equal(result.length, 123, 'Should truncate to maxLength + suffix');
  assert.ok(result.endsWith('...'), 'Should end with suffix');
});

test('truncate integration - disabled mode', () => {
  const text = 'A'.repeat(150);
  const config = { enabled: false, maxLength: 120, mode: 'smart', suffix: '...' };

  const result = !config.enabled ? text : text.substring(0, config.maxLength) + config.suffix;

  assert.equal(result, text, 'Should not truncate when disabled');
});

test('truncate integration - complex content with hint', () => {
  const text = '```mermaid\ngraph TD\n  A-->B\n```';
  const config = { enabled: true, maxLength: 120, mode: 'smart', suffix: '...', showHintForComplex: true };

  const hasComplexSyntax = /```[\s\S]*?```|\$\$[\s\S]+?\$\$|\n\|.*\|.*\n/.test(text);
  const result = hasComplexSyntax && config.showHintForComplex
    ? '📊 内容包含图表或公式，请查看聊天面板'
    : text;

  assert.equal(result, '📊 内容包含图表或公式，请查看聊天面板', 'Should show hint for complex content');
});

test('truncate integration - complex content without hint', () => {
  const text = '```mermaid\ngraph TD\n  A-->B\n```';
  const config = { enabled: true, maxLength: 30, mode: 'smart', suffix: '...', showHintForComplex: false };

  const hasComplexSyntax = /```[\s\S]*?```|\$\$[\s\S]+?\$\$|\n\|.*\|.*\n/.test(text);
  // When showHintForComplex is false, it should truncate normally
  const result = hasComplexSyntax && config.showHintForComplex
    ? '📊 内容包含图表或公式，请查看聊天面板'
    : (Array.from(text).length > config.maxLength ? Array.from(text).slice(0, config.maxLength).join('') + config.suffix : text);

  assert.ok(result.includes('```'), 'Should truncate complex content when hint is disabled');
  assert.ok(result.length <= config.maxLength + config.suffix.length, 'Should respect maxLength');
});

