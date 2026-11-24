/**
 * @file Regression tests over the bundled fixture documents.
 *
 * These are the only tests that read `documents/*.md`. Their job is to keep
 * the large-mixed-document regression — a document carrying both Mermaid
 * diagrams and KaTeX math — from recurring silently. No browser is launched:
 * the fixture is driven through the same two steps the CLI runs, Markdown
 * rendering and HTML assembly, and the assertions are on the resulting
 * structure.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { renderMarkdown } from '../src/core/render-markdown.js';
import { buildHtml, mermaidBootstrapSource, katexBootstrapSource } from '../src/core/build-html.js';
import { createDocumentOptions } from '../src/core/document-options.js';

/**
 * Read a fixture document from `documents/`.
 *
 * @param {string} name  File name, e.g. `test-math.md`.
 * @returns {Promise<string>}
 */
function readFixture(name) {
  return readFile(new URL(`../documents/${name}`, import.meta.url), 'utf-8');
}

/**
 * Count fenced blocks of a given language directly in the Markdown source.
 *
 * This is an independent count: the expected number of containers comes from
 * the document itself rather than from re-running the renderer's own regular
 * expressions, so a tokenizer that stops recognising a fence cannot agree with
 * a total it produced.
 *
 * @param {string} markdown
 * @param {string} language
 * @returns {number}
 */
function countFences(markdown, language) {
  const pattern = new RegExp(
    `^ {0,3}\`{3,}[ \\t]*${language}[ \\t]*$`,
    'gm',
  );
  return (markdown.match(pattern) || []).length;
}

/**
 * Decode the entities the renderer writes into math wrappers, recovering the
 * LaTeX exactly as KaTeX would read it back through `textContent`.
 *
 * @param {string} text
 * @returns {string}
 */
function decodeEntities(text) {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/**
 * Extract the inner text of every wrapper element of the given kind.
 *
 * @param {string} html
 * @param {'mermaid'|'math-display'} kind  Block wrappers are `<div>`s.
 * @returns {string[]}
 */
function blockContents(html, kind) {
  const pattern = new RegExp(
    `<div class="${kind}">([\\s\\S]*?)</div>`,
    'g',
  );
  return [...html.matchAll(pattern)].map((match) =>
    decodeEntities(match[1]).trim(),
  );
}

/**
 * Extract the inner text of every inline math span.
 *
 * @param {string} html
 * @returns {string[]}
 */
function inlineContents(html) {
  return [...html.matchAll(/<span class="math-inline">([\s\S]*?)<\/span>/g)].map(
    (match) => decodeEntities(match[1]).trim(),
  );
}

/**
 * Extract every fenced code block from rendered HTML, whole.
 *
 * @param {string} html
 * @returns {string[]}
 */
function codeBlocks(html) {
  return [...html.matchAll(/<pre><code[^>]*>[\s\S]*?<\/code><\/pre>/g)].map(
    (match) => match[0],
  );
}

/**
 * Extract the raw (still entity-encoded) inner text of every math wrapper.
 *
 * @param {string} html
 * @returns {string[]}
 */
function rawMathContents(html) {
  const blocks = [...html.matchAll(/<div class="math-(?:display)">([\s\S]*?)<\/div>/g)];
  const spans = [...html.matchAll(/<span class="math-inline">([\s\S]*?)<\/span>/g)];
  return [...blocks, ...spans].map((match) => match[1]);
}

/**
 * Convert a fixture document exactly as `convert.js` does up to, but not
 * including, the browser step.
 *
 * @param {string} name
 * @returns {Promise<{ markdown: string, bodyHtml: string, html: string }>}
 */
async function convertFixture(name) {
  const markdown = await readFixture(name);
  const bodyHtml = await renderMarkdown(markdown);
  const html = buildHtml({
    bodyHtml,
    userCss: null,
    options: createDocumentOptions({ input: name, title: name }),
  });
  return { markdown, bodyHtml, html };
}

// ---------------------------------------------------------------------------
// The mixed document: diagrams and math in one pass
// ---------------------------------------------------------------------------

test('the mixed fixture renders both diagrams and math from one document', async () => {
  const { markdown, bodyHtml } = await convertFixture('test-math.md');

  const fences = countFences(markdown, 'mermaid');
  assert.ok(fences >= 2, 'the fixture must carry more than one diagram');

  assert.equal(
    blockContents(bodyHtml, 'mermaid').length,
    fences,
    'every Mermaid fence must become exactly one .mermaid container',
  );
  assert.ok(
    blockContents(bodyHtml, 'math-display').length > 0,
    'the fixture must produce display math',
  );
  assert.ok(
    inlineContents(bodyHtml).length > 0,
    'the fixture must produce inline math',
  );
});

test('no Mermaid fence survives into the rendered document as code', async () => {
  const { bodyHtml } = await convertFixture('test-math.md');

  assert.ok(
    !bodyHtml.includes('```mermaid'),
    'a Mermaid fence left behind means the diagram would print as source text',
  );
  assert.ok(
    !codeBlocks(bodyHtml).some((block) => block.includes('flowchart')),
    'diagram source must not reach the document inside a code block',
  );
});

test('diagram source is preserved inside each container', async () => {
  const { bodyHtml } = await convertFixture('test-math.md');
  const diagrams = blockContents(bodyHtml, 'mermaid');

  assert.ok(
    diagrams.some((source) => source.includes('flowchart TD')),
    'the top-down flowchart must survive tokenisation',
  );
  assert.ok(
    diagrams.some((source) => source.includes('flowchart LR')),
    'the left-to-right flowchart must survive tokenisation',
  );
});

test('display and inline math survive the mixed document intact', async () => {
  const { bodyHtml } = await convertFixture('test-math.md');

  const display = blockContents(bodyHtml, 'math-display');
  const inline = inlineContents(bodyHtml);

  assert.equal(display.length, 4, 'four display blocks are declared in the fixture');
  assert.equal(
    inline.length,
    6,
    'six inline expressions are declared in the fixture',
  );

  // Literal expectations are the independent source of truth here: the fixture
  // is a checked-in artifact and these are the expressions it contains.
  assert.ok(
    display.some((latex) => latex.includes('\\int_{-\\infty}^{\\infty}')),
    'the Gaussian integral must remain intact LaTeX',
  );
  assert.ok(
    display.some((latex) => latex.includes('\\begin{pmatrix}')),
    'the matrix block must remain intact LaTeX',
  );
  assert.ok(
    inline.includes('E = mc^2'),
    'single-symbol and multi-symbol inline math must both be captured',
  );
  assert.ok(inline.includes('\\pi'), 'a bare symbol inline expression must be captured');

  // A "<" or "&" reaching the wrapper unescaped lets the HTML parser open a
  // bogus tag and dumps raw LaTeX into the page. The matrix block contains
  // "&", so the emitted wrapper must carry the entity, and decoding it must
  // give back the author's LaTeX.
  assert.ok(
    rawMathContents(bodyHtml).some((latex) => latex.includes('a &amp; b')),
    'the wrapper must carry an escaped ampersand, not a bare one',
  );
  assert.ok(
    display.some((latex) => latex.includes('a & b')),
    'matrix alignment characters must decode back to literal text',
  );
});

test('math inside code stays raw in a mixed document', async () => {
  const { bodyHtml } = await convertFixture('test-math.md');

  // The latex fence keeps its own copy of the integral and must not be
  // rewritten into a math wrapper.
  const blocks = codeBlocks(bodyHtml);
  assert.ok(blocks.length > 0, 'the fixture carries a fenced code block');
  assert.ok(
    blocks.some((block) => block.includes('\\int_{-\\infty}^{\\infty}')),
    'the fenced LaTeX must be preserved verbatim',
  );
  for (const block of blocks) {
    assert.ok(
      !block.includes('math-display') && !block.includes('math-inline'),
      'math wrappers inside a code block would be rendered instead of shown',
    );
  }

  // Inline code containing maths stays a code span, not a math span.
  assert.ok(
    /<code>\$E = mc\^2\$<\/code>/.test(bodyHtml),
    'inline code containing dollars must remain literal',
  );
});

test('currency in the mixed fixture is not mistaken for math', async () => {
  const { bodyHtml } = await convertFixture('test-math.md');
  const inline = inlineContents(bodyHtml);

  for (const amount of ['10', '3.50', '5']) {
    assert.ok(
      !inline.some((latex) => latex.trim() === amount),
      `"$${amount}" must not become a math expression`,
    );
  }
  assert.ok(
    bodyHtml.includes('$10') && bodyHtml.includes('$3.50'),
    'currency amounts must survive as literal text',
  );
});

test('the assembled mixed document sequences math after Mermaid', async () => {
  const { html } = await convertFixture('test-math.md');

  assert.match(html, /^<!DOCTYPE html>/);
  assert.ok(html.trimEnd().endsWith('</html>'));

  const mermaidScript = html.indexOf(mermaidBootstrapSource().trim());
  const katexScript = html.indexOf(katexBootstrapSource().trim());
  assert.ok(mermaidScript > -1 && katexScript > -1, 'both bootstraps must be inlined');
  assert.ok(
    mermaidScript < katexScript,
    'the Mermaid bootstrap must be injected before the KaTeX bootstrap',
  );
});

// ---------------------------------------------------------------------------
// The diagram-only fixture
// ---------------------------------------------------------------------------

test('the diagram fixture renders every fence it declares', async () => {
  const { markdown, bodyHtml } = await convertFixture('test-fixtures.md');

  const fences = countFences(markdown, 'mermaid');
  assert.ok(fences >= 5, 'the fixture must declare its diagram cases');

  assert.equal(
    blockContents(bodyHtml, 'mermaid').length,
    fences,
    'each diagram case must become its own container',
  );
  assert.ok(!bodyHtml.includes('```mermaid'));
  assert.ok(
    blockContents(bodyHtml, 'math-display').length === 0,
    'the diagram fixture carries no block math',
  );
});

test('the diagram fixture exercises the diagram families the theme selection reaches', async () => {
  // The theme selection is passed to `mermaid.initialize` once, for every
  // diagram in the document, so a family that no fixture declares is a family
  // whose surfaces nobody checks. Gantt is the family that was missing: its
  // bars and task rows are painted from Mermaid's own theme variables, not
  // from the shared block's shape rules, so it is the one that shows whether
  // the native dark theme actually took effect. The state diagram and pie
  // chart are here for the same reason at "default shapes" scale.
  const { markdown, bodyHtml } = await convertFixture('test-fixtures.md');
  const declarations = blockContents(bodyHtml, 'mermaid');

  for (const opener of ['gantt', 'stateDiagram', 'pie', 'flowchart', 'sequenceDiagram']) {
    assert.ok(
      declarations.some((source) => source.split('\n')[0].trim().startsWith(opener)),
      `the fixture must declare a ${opener} diagram, or its surfaces go unchecked`,
    );
  }

  assert.equal(
    declarations.length,
    countFences(markdown, 'mermaid'),
    'every declared family must reach the document as its own container',
  );
});

test('the diagram fixture pins the label-surface cases the normaliser decides', async () => {
  // Every case below is a surface the old `.node`-only normaliser could not
  // see, and each one is also a pure-function case in
  // `mermaid-bootstrap.test.js`. The fixture is what makes them real DOM: if
  // Mermaid changes the markup, the unit tests keep passing and the rendered
  // check fails, which is the split the ticket asks for.
  const { markdown } = await convertFixture('test-fixtures.md');

  const fences = [...markdown.matchAll(/^ {0,3}```[ \t]*mermaid[ \t]*\n([\s\S]*?)^ {0,3}```/gm)].map(
    (match) => match[1],
  );
  const declares = (pattern) => fences.some((source) => pattern.test(source));

  /** The task-name part of a Gantt task line, i.e. what precedes its colon. */
  const taskNames = (source) =>
    source
      .split('\n')
      .filter((line) => /^\s+\S/.test(line) && /:/.test(line) && /\d+d\s*$/.test(line))
      .map((line) => line.slice(0, line.indexOf(':')).trim());

  assert.ok(
    fences.some((source) => /^gantt/.test(source) && /:done/.test(source) && /:active/.test(source)),
    'the Gantt case must declare a done task and an active task, so both bar fills are painted',
  );
  assert.ok(
    fences.some((source) => {
      if (!/^gantt/.test(source)) return false;
      const names = taskNames(source);
      // An inside-bar label needs a task short enough to hold its name, and an
      // outside-bar label needs one long enough to overflow it. Both must be
      // in the same chart or the two surfaces are never compared in one render.
      return names.some((name) => name.length < 20) && names.some((name) => name.length > 45);
    }),
    'the Gantt case must carry a short task (label inside the bar) and a long one (label outside it)',
  );

  assert.ok(declares(/^classDiagram/), 'the class case pins the non-painting group wrapper');
  assert.ok(
    fences.some((source) => /^stateDiagram/.test(source) && /state \w+ \{[\s\S]*state \w+ \{/.test(source)),
    'the state case must nest one composite state inside another',
  );
  assert.ok(
    fences.some(
      (source) => /fill:#[0-9a-f]{6}/i.test(source) && /fill:#f[0-9a-f]{5}/i.test(source),
    ),
    'the styled-fill case must declare both a dark and a light author fill',
  );
  assert.ok(
    fences.some((source) => /<br\/?>/.test(source) && /-->/.test(source)),
    'the edge-label case must declare a multi-line edge label',
  );
});
