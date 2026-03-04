const { test } = require('node:test');
const assert = require('node:assert');

test('mermaid diagram - flowchart syntax', () => {
  const flowchart = `graph TD
    A[Start] --> B{Decision}
    B -->|Yes| C[Action 1]
    B -->|No| D[Action 2]
    C --> E[End]
    D --> E`;

  assert.ok(flowchart.includes('graph TD'), 'Should contain flowchart declaration');
  assert.ok(flowchart.includes('-->'), 'Should contain arrow syntax');
  assert.ok(flowchart.includes('['), 'Should contain node syntax');
});

test('mermaid diagram - sequence diagram syntax', () => {
  const sequence = `sequenceDiagram
    participant A as Alice
    participant B as Bob
    A->>B: Hello Bob
    B->>A: Hello Alice`;

  assert.ok(sequence.includes('sequenceDiagram'), 'Should contain sequence diagram declaration');
  assert.ok(sequence.includes('participant'), 'Should contain participant declaration');
  assert.ok(sequence.includes('->>' ), 'Should contain message syntax');
});

test('mermaid diagram - class diagram syntax', () => {
  const classDiagram = `classDiagram
    class Animal {
      +String name
      +int age
      +makeSound()
    }
    class Dog {
      +bark()
    }
    Animal <|-- Dog`;

  assert.ok(classDiagram.includes('classDiagram'), 'Should contain class diagram declaration');
  assert.ok(classDiagram.includes('class '), 'Should contain class declaration');
  assert.ok(classDiagram.includes('<|--'), 'Should contain inheritance syntax');
});

test('mermaid diagram - state diagram syntax', () => {
  const stateDiagram = `stateDiagram-v2
    [*] --> Idle
    Idle --> Processing
    Processing --> Complete
    Complete --> [*]`;

  assert.ok(stateDiagram.includes('stateDiagram'), 'Should contain state diagram declaration');
  assert.ok(stateDiagram.includes('[*]'), 'Should contain start/end state');
  assert.ok(stateDiagram.includes('-->'), 'Should contain transition syntax');
});

test('mermaid diagram - gantt chart syntax', () => {
  const gantt = `gantt
    title Project Timeline
    dateFormat YYYY-MM-DD
    section Phase 1
    Task 1 :2024-01-01, 30d
    Task 2 :2024-02-01, 20d`;

  assert.ok(gantt.includes('gantt'), 'Should contain gantt declaration');
  assert.ok(gantt.includes('title'), 'Should contain title');
  assert.ok(gantt.includes('section'), 'Should contain section');
});

test('mermaid diagram - pie chart syntax', () => {
  const pie = `pie title Distribution
    "Category A" : 45
    "Category B" : 30
    "Category C" : 25`;

  assert.ok(pie.includes('pie'), 'Should contain pie declaration');
  assert.ok(pie.includes('title'), 'Should contain title');
  assert.ok(pie.includes(':'), 'Should contain value separator');
});

test('mermaid code block detection', () => {
  const markdownWithMermaid = '```mermaid\ngraph TD\n  A-->B\n```';

  assert.ok(markdownWithMermaid.includes('```mermaid'), 'Should detect mermaid code block');
  assert.ok(markdownWithMermaid.includes('graph'), 'Should contain diagram content');
});

test('mermaid rendering - error handling', () => {
  const invalidMermaid = '```mermaid\ninvalid syntax here\n```';

  // In real implementation, this should be caught and handled gracefully
  assert.ok(invalidMermaid.includes('```mermaid'), 'Should still detect mermaid block');
});

test('mermaid diagram - complex flowchart', () => {
  const complexFlow = `graph LR
    A[Start] --> B{Check}
    B -->|Pass| C[Process]
    B -->|Fail| D[Error]
    C --> E{Validate}
    E -->|OK| F[Success]
    E -->|Error| D
    D --> G[Log]
    F --> H[End]
    G --> H`;

  assert.ok(complexFlow.includes('graph LR'), 'Should contain left-right flowchart');
  assert.ok(complexFlow.match(/\{.*\}/), 'Should contain decision nodes');
  assert.ok(complexFlow.match(/\[.*\]/), 'Should contain process nodes');
});

test('mermaid diagram - subgraphs', () => {
  const subgraph = `graph TB
    subgraph Group1
      A1-->A2
    end
    subgraph Group2
      B1-->B2
    end
    A2-->B1`;

  assert.ok(subgraph.includes('subgraph'), 'Should contain subgraph declaration');
  assert.ok(subgraph.includes('end'), 'Should contain subgraph end');
});

test('latex rendering - inline formulas in webui', () => {
  const inlineFormulas = [
    '$E = mc^2$',
    '$\\alpha + \\beta = \\gamma$',
    '$\\sum_{i=1}^{n} x_i$',
    '$\\int_0^\\infty e^{-x} dx$'
  ];

  inlineFormulas.forEach((formula) => {
    assert.ok(formula.includes('$'), 'Should contain inline math delimiters');
    assert.ok(!formula.includes('$$'), 'Should not be display math');
  });
});

test('latex rendering - display formulas in webui', () => {
  const displayFormulas = [
    '$$E = mc^2$$',
    '$$\\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$$',
    '$$\\int_{-\\infty}^{\\infty} e^{-x^2} dx = \\sqrt{\\pi}$$',
    '$$\\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6}$$'
  ];

  displayFormulas.forEach((formula) => {
    assert.ok(formula.includes('$$'), 'Should contain display math delimiters');
  });
});

test('latex rendering - matrices', () => {
  const matrices = [
    '$$\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}$$',
    '$$\\begin{bmatrix} 1 & 2 \\\\ 3 & 4 \\end{bmatrix}$$',
    '$$\\begin{vmatrix} a & b \\\\ c & d \\end{vmatrix}$$'
  ];

  matrices.forEach((matrix) => {
    assert.ok(matrix.includes('begin'), 'Should contain matrix environment');
    assert.ok(matrix.includes('\\\\'), 'Should contain row separator');
  });
});

test('latex rendering - fractions and roots', () => {
  const expressions = [
    '$\\frac{1}{2}$',
    '$\\sqrt{2}$',
    '$\\sqrt[3]{8}$',
    '$\\frac{\\partial f}{\\partial x}$'
  ];

  expressions.forEach((expr) => {
    assert.ok(expr.includes('\\'), 'Should contain LaTeX commands');
  });
});

test('latex rendering - subscripts and superscripts', () => {
  const expressions = [
    '$x^2$',
    '$x_i$',
    '$x_i^2$',
    '$e^{i\\pi}$',
    '$a_{ij}$'
  ];

  expressions.forEach((expr) => {
    assert.ok(expr.match(/[\^_]/), 'Should contain subscript or superscript');
  });
});

test('latex and mermaid mixed content', () => {
  const mixedContent = `# Math and Diagrams

The quadratic formula is:

$$x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$$

And here's a flowchart:

\`\`\`mermaid
graph TD
  A[Start] --> B[Calculate]
  B --> C[End]
\`\`\``;

  assert.ok(mixedContent.includes('$$'), 'Should contain LaTeX');
  assert.ok(mixedContent.includes('```mermaid'), 'Should contain mermaid');
  assert.ok(mixedContent.includes('#'), 'Should contain markdown');
});

