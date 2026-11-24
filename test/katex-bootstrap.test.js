/**
 * @file Tests for the KaTeX browser program.
 *
 * The seam is the exported entry point, driven against a stubbed readiness
 * protocol and a fake document — the same second-adapter arrangement the
 * Mermaid program's tests use. Per-expression error isolation is proved by
 * running the program over a document where one expression is broken and
 * asserting that its siblings still rendered, never by matching a substring of
 * the source.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  runKatexBootstrap,
  renderExpression,
  loadKatexFromCdn,
  KATEX_VERSION,
  KATEX_SCRIPT_URL,
  KATEX_STYLESHEET_URL,
} from '../src/core/katex-bootstrap.js';
import { READINESS_FLAGS, FATAL_REPORT_INDEX } from '../src/core/readiness-protocol.js';

// ---------------------------------------------------------------------------
// A stubbed page
// ---------------------------------------------------------------------------

/** A math node: raw LaTeX in `textContent`, KaTeX output replacing it. */
function mathNode(latex) {
  return {
    textContent: latex,
    innerHTML: '',
  };
}

/**
 * Build a page stub plus a runtime loader.
 *
 * `rendered` records every successful render so a test can prove that the
 * siblings of a broken expression were still typeset.
 *
 * @param {Object} params
 * @param {ReturnType<typeof mathNode>[]} [params.display]
 * @param {ReturnType<typeof mathNode>[]} [params.inline]
 * @param {string[]} [params.failing]  LaTeX that KaTeX must refuse to parse.
 */
function createPage({ display = [], inline = [], failing = [], runtimeFails = false } = {}) {
  const calls = { rendered: [], loads: 0, queried: [] };

  const doc = {
    querySelectorAll(selector) {
      calls.queried.push(selector);
      if (selector === '.math-display') return display;
      if (selector === '.math-inline') return inline;
      throw new Error(`unexpected selector: ${selector}`);
    },
  };

  const win = { document: doc };

  const katex = {
    render(raw, el, options) {
      if (failing.includes(raw)) {
        throw new Error(`KaTeX parse error: Undefined control sequence: ${raw}`);
      }
      calls.rendered.push({ raw, displayMode: options.displayMode, target: el });
      el.innerHTML = `<span class="katex">${raw}</span>`;
    },
  };

  const loadRuntime = async () => {
    calls.loads++;
    if (runtimeFails) throw new Error('Failed to fetch dynamically imported module');
    return katex;
  };

  return { win, doc, loadRuntime, calls, katex };
}

/** Run the program the way assembly does: flags from the protocol, injected page. */
function run(page) {
  return runKatexBootstrap({
    flags: READINESS_FLAGS,
    fatalReportIndex: FATAL_REPORT_INDEX,
    win: page.win,
    doc: page.doc,
    loadRuntime: page.loadRuntime,
  });
}

// ---------------------------------------------------------------------------
// No import side effects
// ---------------------------------------------------------------------------

test('importing the program publishes no readiness flags and touches no DOM', () => {
  const globals = Object.keys(globalThis).filter((key) => key.startsWith('__'));
  assert.deepEqual(globals, []);
});

// ---------------------------------------------------------------------------
// The render loop
// ---------------------------------------------------------------------------

test('every expression is rendered with the display mode its container implies', async () => {
  const display = [mathNode('\\int_0^1 x dx')];
  const inline = [mathNode('E = mc^2'), mathNode('\\pi')];
  const page = createPage({ display, inline });

  await run(page);

  assert.equal(page.calls.loads, 1, 'the runtime is loaded once, not once per expression');
  assert.deepEqual(
    page.calls.rendered.map((entry) => [entry.raw, entry.displayMode]),
    [
      ['\\int_0^1 x dx', true],
      ['E = mc^2', false],
      ['\\pi', false],
    ],
  );
  assert.deepEqual(page.win[READINESS_FLAGS.mathErrors], []);
  assert.equal(page.win[READINESS_FLAGS.mathRenderDone], true);
});

test('a document with no math never loads the runtime', async () => {
  const page = createPage({});

  await run(page);

  assert.equal(page.calls.loads, 0, 'no CDN fetch when there is nothing to typeset');
  assert.deepEqual(page.win[READINESS_FLAGS.mathErrors], []);
  assert.equal(page.win[READINESS_FLAGS.mathRenderDone], true);
});

// ---------------------------------------------------------------------------
// Per-expression isolation: the behaviour this move must not lose
// ---------------------------------------------------------------------------

test('one unparseable expression does not stop its siblings rendering', async () => {
  const display = [mathNode('a^2'), mathNode('\\notacommand{x}'), mathNode('b^2')];
  const page = createPage({ display, failing: ['\\notacommand{x}'] });

  await run(page);

  assert.deepEqual(
    page.calls.rendered.map((entry) => entry.raw),
    ['a^2', 'b^2'],
    'the two healthy expressions must still be typeset',
  );
  assert.match(display[1].innerHTML, /^$/, 'the broken node must not receive KaTeX output');
  assert.equal(
    display[1].textContent,
    '\\notacommand{x}',
    'the broken node keeps its raw LaTeX so the reader sees what failed',
  );
  assert.deepEqual(page.win[READINESS_FLAGS.mathErrors], [
    { index: 1, kind: 'display', error: 'KaTeX parse error: Undefined control sequence: \\notacommand{x}' },
  ]);
  assert.equal(page.win[READINESS_FLAGS.mathRenderDone], true);
});

test('the reported index counts every expression, display first then inline', async () => {
  const display = [mathNode('a'), mathNode('b')];
  const inline = [mathNode('c'), mathNode('\\bad{d}')];
  const page = createPage({ display, inline, failing: ['\\bad{d}'] });

  await run(page);

  assert.deepEqual(page.win[READINESS_FLAGS.mathErrors], [
    { index: 3, kind: 'inline', error: 'KaTeX parse error: Undefined control sequence: \\bad{d}' },
  ]);
  assert.equal(inline[0].innerHTML, '<span class="katex">c</span>', 'earlier inline math still typeset');
});

test('renderExpression reports a failure instead of throwing', () => {
  const node = mathNode('\\oops');
  const page = createPage({ failing: ['\\oops'] });

  const report = renderExpression(page.katex, node, { displayMode: false, index: 7 });

  assert.deepEqual(report, {
    index: 7,
    kind: 'inline',
    error: 'KaTeX parse error: Undefined control sequence: \\oops',
  });
  assert.equal(node.textContent, '\\oops');
});

test('renderExpression returns null when the expression typesets', () => {
  const node = mathNode('x^2');
  const page = createPage({});

  assert.equal(renderExpression(page.katex, node, { displayMode: true, index: 0 }), null);
  assert.equal(node.innerHTML, '<span class="katex">x^2</span>');
});

// ---------------------------------------------------------------------------
// Sequencing: Mermaid first, then the DOM
// ---------------------------------------------------------------------------

test('the program awaits Mermaid readiness before querying the DOM', async () => {
  const display = [mathNode('x^2')];
  const page = createPage({ display });

  let resolveMermaid;
  page.win[READINESS_FLAGS.mermaidReady] = new Promise((resolve) => {
    resolveMermaid = resolve;
  });

  const running = run(page);
  await Promise.resolve();
  assert.deepEqual(page.calls.queried, [], 'no DOM query may happen while Mermaid is still rendering');

  resolveMermaid();
  await running;

  assert.ok(page.calls.queried.includes('.math-display'), 'math nodes are queried once Mermaid is ready');
  assert.equal(display[0].innerHTML, '<span class="katex">x^2</span>');
});

test('the program runs when no Mermaid bootstrap published a ready promise', async () => {
  const display = [mathNode('x^2')];
  const page = createPage({ display });

  await run(page);

  assert.equal(display[0].innerHTML, '<span class="katex">x^2</span>');
  assert.equal(page.win[READINESS_FLAGS.mathRenderDone], true);
});

test('a rejected Mermaid readiness promise becomes a bootstrap report, not a hang', async () => {
  const page = createPage({ display: [mathNode('x^2')] });
  page.win[READINESS_FLAGS.mermaidReady] = Promise.reject(new Error('mermaid blew up'));
  // The rejection is observed by the program, so it must not surface as an
  // unhandled rejection in the test process.
  page.win[READINESS_FLAGS.mermaidReady].catch(() => {});

  await run(page);

  assert.deepEqual(page.win[READINESS_FLAGS.mathErrors], [
    { index: FATAL_REPORT_INDEX, kind: 'bootstrap', error: 'mermaid blew up' },
  ]);
  assert.equal(page.win[READINESS_FLAGS.mathRenderDone], true);
});

// ---------------------------------------------------------------------------
// Fatal failures
// ---------------------------------------------------------------------------

test('a failed runtime load reports the fatal index and still signals completion', async () => {
  const page = createPage({ display: [mathNode('x^2')], runtimeFails: true });

  await run(page);

  assert.deepEqual(page.win[READINESS_FLAGS.mathErrors], [
    { index: FATAL_REPORT_INDEX, kind: 'bootstrap', error: 'Failed to fetch dynamically imported module' },
  ]);
  assert.equal(page.win[READINESS_FLAGS.mathRenderDone], true);
});

test('the program refuses to run without the protocol handle', async () => {
  await assert.rejects(
    () => runKatexBootstrap({ win: {}, doc: {}, loadRuntime: async () => ({}) }),
    /readiness protocol flags/i,
  );
  await assert.rejects(
    () => runKatexBootstrap({ flags: READINESS_FLAGS, win: {}, doc: {}, loadRuntime: async () => ({}) }),
    /fatal-report index/i,
  );
});

// ---------------------------------------------------------------------------
// The CDN version, owned here
// ---------------------------------------------------------------------------

test('both CDN URLs derive from the one exported version', () => {
  assert.equal(KATEX_SCRIPT_URL, `https://cdn.jsdelivr.net/npm/katex@${KATEX_VERSION}/dist/katex.mjs`);
  assert.equal(
    KATEX_STYLESHEET_URL,
    `https://cdn.jsdelivr.net/npm/katex@${KATEX_VERSION}/dist/katex.min.css`,
  );
});

test('the version literal appears exactly once in the module', async () => {
  const source = await readFile(new URL('../src/core/katex-bootstrap.js', import.meta.url), 'utf8');
  const occurrences = source.split(KATEX_VERSION).length - 1;
  assert.equal(occurrences, 1, 'the version must be written once, then derived into both URLs');
  assert.ok(source.includes('import(KATEX_SCRIPT_URL)'), 'the loader must import the exported URL');
  assert.equal(typeof loadKatexFromCdn, 'function');
});

test('no other file in the package repeats the CDN version', async () => {
  // One source, checked against the files that used to carry a copy: the
  // manifest (which declared the unused npm dependency) and HTML assembly
  // (which wrote the version into both the stylesheet link and the import).
  const { readdirSync } = await import('node:fs');
  const { join, relative } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const root = fileURLToPath(new URL('../', import.meta.url));
  const coreDir = join(root, 'src/core');

  function collectJsFiles(dir) {
    const files = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...collectJsFiles(fullPath));
      } else if (entry.isFile() && entry.name.endsWith('.js')) {
        files.push(fullPath);
      }
    }
    return files;
  }

  const offenders = [];
  for (const [file, text] of [
    ['package.json', await readFile(new URL('../package.json', import.meta.url), 'utf8')],
    ['package-lock.json', await readFile(new URL('../package-lock.json', import.meta.url), 'utf8')],
    ['src/core/build-html.js', await readFile(new URL('../src/core/build-html.js', import.meta.url), 'utf8')],
  ]) {
    if (text.includes(KATEX_VERSION)) offenders.push(file);
  }

  for (const fullPath of collectJsFiles(coreDir)) {
    const relPath = relative(coreDir, fullPath);
    if (relPath === 'katex-bootstrap.js') continue;
    const text = await readFile(fullPath, 'utf8');
    if (text.includes(KATEX_VERSION)) offenders.push(`src/core/${relPath}`);
  }

  assert.deepEqual(offenders, [], 'the CDN version must have exactly one owner');
});

test('the stylesheet link assembly emits uses the exported URL, not a second literal', async () => {
  const { buildHtml } = await import('../src/core/build-html.js');
  const html = buildHtml({ bodyHtml: '<p>x</p>', userCss: null });
  assert.ok(
    html.includes(`<link rel="stylesheet" href="${KATEX_STYLESHEET_URL}" crossorigin="anonymous">`),
    'assembly must link the URL the module owns',
  );
});
