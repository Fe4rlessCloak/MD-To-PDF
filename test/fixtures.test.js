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
import { buildHtml } from '../src/core/build-html.js';
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

  const mermaidScript = html.indexOf('mermaid.esm.min.mjs');
  const katexScript = html.indexOf('katex.mjs');
  assert.ok(mermaidScript > -1 && katexScript > -1, 'both bootstraps must be present');
  assert.ok(
    mermaidScript < katexScript,
    'the Mermaid bootstrap must be injected before the KaTeX bootstrap',
  );

  // The historical failure was KaTeX mutating the DOM while Mermaid was still
  // rendering, which broke later diagrams. The KaTeX bootstrap must therefore
  // wait on Mermaid readiness before it touches any math node.
  const waitsForMermaid = html.indexOf('await window[RF.mermaidReady]');
  const firstMathQuery = html.indexOf("querySelectorAll('.math-display')");
  assert.ok(waitsForMermaid > -1, 'the KaTeX bootstrap must await Mermaid readiness');
  assert.ok(firstMathQuery > -1, 'the KaTeX bootstrap must query math nodes');
  assert.ok(
    waitsForMermaid < firstMathQuery,
    'waiting for Mermaid must precede the first DOM mutation by KaTeX',
  );

  // Mermaid signals completion before the KaTeX script can observe it. Both
  // bootstraps are module scripts, so order is source order: a marker that is
  // absent (-1) would satisfy a bare `indexOf(...) < indexOf(...)` comparison,
  // so the position is asserted positively.
  const mermaidDone = html.indexOf('view[flags.mermaidRenderDone] = true');
  assert.ok(mermaidDone > -1, 'the Mermaid program must publish the completion flag');
  assert.ok(
    mermaidDone < katexScript,
    'the Mermaid program must be inlined before the KaTeX script runs',
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
