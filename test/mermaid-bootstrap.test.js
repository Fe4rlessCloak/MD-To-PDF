/**
 * @file Tests for the Mermaid browser program.
 *
 * Two seams are exercised here, and they are different on purpose:
 *
 * - `isDarkColor` and `labelColorFor` are pure functions, tested directly.
 *   The luminance regex used to live inside a template literal, where one
 *   level of escaping had to be written as `\\(`; importing the module is the
 *   only thing that proves the real regex survived the move.
 * - `runMermaidBootstrap` is the browser entry point, tested by driving it
 *   against a stubbed readiness protocol and a fake document. That is the
 *   second adapter for the seam: the production one is a real page.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  isDarkColor,
  labelColorFor,
  runMermaidBootstrap,
  mermaidInitOptions,
  NORMALIZE_VARIABLE,
  LABEL_LIGHT_COLOR,
  MERMAID_CDN_URL,
} from '../src/core/mermaid-bootstrap.js';
import { READINESS_FLAGS, FATAL_REPORT_INDEX } from '../src/core/readiness-protocol.js';

const stylesDir = (name) => readFile(new URL(`../styles/${name}`, import.meta.url), 'utf-8');

// ---------------------------------------------------------------------------
// The luminance rule
// ---------------------------------------------------------------------------

test('the module carries no readiness globals of its own before it is run', () => {
  const before = Object.keys(globalThis).filter((key) => key.startsWith('__'));
  assert.deepEqual(
    before,
    [],
    'importing the browser program must not publish readiness flags',
  );
});

test('isDarkColor reads a computed-style rgb() string for a dark fill', () => {
  // What getComputedStyle actually returns for the OLED theme's node fill.
  assert.equal(isDarkColor('rgb(20, 24, 40)'), true);
});

test('isDarkColor reads a computed-style rgba() string for a light fill', () => {
  assert.equal(isDarkColor('rgba(240, 242, 255, 1)'), false);
  assert.equal(isDarkColor('rgb(255, 255, 255)'), false);
});

test('isDarkColor treats the luminance threshold as light', () => {
  // The rule is `luminance < 128` on the 0–255 YIQ scale: comfortably above
  // the threshold is light, comfortably below is dark.
  assert.equal(isDarkColor('rgb(130, 130, 130)'), false);
  assert.equal(isDarkColor('rgb(126, 126, 126)'), true);
});

test('isDarkColor rejects anything that is not an rgb() or rgba() colour', () => {
  for (const value of ['', 'none', 'transparent', '#000000', null, undefined, 42]) {
    assert.equal(isDarkColor(value), false, `${String(value)} is not a measurable colour`);
  }
});

test('isDarkColor accepts the spacing and casing variants browsers emit', () => {
  // Chrome writes `rgb(0, 0, 0)` for an opaque colour and `rgba(...)` when
  // alpha is present; both must parse, as must either case.
  assert.equal(isDarkColor('rgb(0, 0, 0)'), true);
  assert.equal(isDarkColor('rgb(0,0,0)'), true);
  assert.equal(isDarkColor('RGBA( 10 , 10 , 10 , 1 )'), true);
  assert.equal(isDarkColor('rgba(250, 250, 250, 0.9)'), false);
});

// ---------------------------------------------------------------------------
// The dark-fill labelling decision
// ---------------------------------------------------------------------------

test('labelColorFor forces light ink on a dark author fill', () => {
  assert.equal(labelColorFor('rgb(20, 24, 40)'), LABEL_LIGHT_COLOR);
});

test('labelColorFor leaves a light author fill alone', () => {
  assert.equal(labelColorFor('rgb(240, 242, 255)'), null);
  assert.equal(labelColorFor('none'), null);
});

// ---------------------------------------------------------------------------
// A stubbed page: the second adapter for the bootstrap seam
// ---------------------------------------------------------------------------

/** A computed-style stub: `fill` for shapes, `getPropertyValue` for the root. */
function styleStub({ fill = '', variables = {} } = {}) {
  return {
    fill,
    getPropertyValue: (name) => variables[name] ?? '',
  };
}

/** An element carrying only the inline-style surface the program touches. */
function element() {
  const props = {};
  return {
    style: {
      props,
      setProperty(name, value, priority) {
        props[name] = { value, priority };
      },
      removeProperty(name) {
        delete props[name];
      },
    },
  };
}

/** A `.mermaid` container: text before render, SVG markup after. */
function diagramNode(text) {
  return {
    textContent: text,
    innerHTML: '',
    svg: null,
    querySelector(selector) {
      return selector === 'svg' ? this.svg : null;
    },
    getBoundingClientRect: () => ({ width: 120, height: 40 }),
  };
}

/**
 * Build a page stub plus the injected runtime loader.
 *
 * The document throws on any selector the program is not expected to use, so
 * the fake pins the DOM contract instead of silently accepting anything.
 */
function createPage({
  diagrams,
  normalizing = false,
  shapeFill = 'rgb(20, 24, 40)',
  runtimeFails = false,
  failingText = null,
} = {}) {
  const calls = { initialize: null, rendered: [], loads: 0, removed: [] };
  const root = element();
  const shape = element();
  const labels = [element(), element()];
  const inlineStyled = [element()];

  const graphNodes = [
    {
      querySelector: (selector) => (selector.includes('rect') ? shape : null),
      querySelectorAll: () => labels,
    },
  ];

  const doc = {
    documentElement: root,
    querySelectorAll(selector) {
      if (selector === '.mermaid') return diagrams;
      if (selector === '.mermaid svg [style]') return inlineStyled;
      if (selector === '.mermaid svg .node') return graphNodes;
      throw new Error(`unexpected selector: ${selector}`);
    },
    getElementById(id) {
      return {
        id,
        remove() {
          calls.removed.push(id);
        },
      };
    },
  };

  const computed = new Map([
    [root, styleStub({ variables: { [NORMALIZE_VARIABLE]: normalizing ? '1' : '' } })],
    [shape, styleStub({ fill: shapeFill })],
  ]);

  const win = {
    document: doc,
    getComputedStyle: (el) => computed.get(el) ?? styleStub(),
  };

  const runtime = {
    initialize(options) {
      calls.initialize = options;
    },
    async render(id, source) {
      calls.rendered.push({ id, source });
      if (source === failingText) throw new Error('Parse error on line 2');
      const node = diagrams.find((candidate) => candidate.textContent === source);
      node.svg = {
        querySelectorAll: () => [],
        getBoundingClientRect: () => ({ width: 120, height: 40 }),
      };
      return { svg: `<svg id="${id}"></svg>` };
    },
  };

  const loadRuntime = async () => {
    calls.loads++;
    if (runtimeFails) throw new Error('Failed to fetch dynamically imported module');
    return runtime;
  };

  return { win, doc, loadRuntime, calls, labels, inlineStyled, shape };
}

/** Run the program the way assembly does: flags from the protocol, injected page. */
function run(page) {
  return runMermaidBootstrap({
    flags: READINESS_FLAGS,
    fatalReportIndex: FATAL_REPORT_INDEX,
    win: page.win,
    doc: page.doc,
    loadRuntime: page.loadRuntime,
  });
}

// ---------------------------------------------------------------------------
// The render loop and its failure isolation
// ---------------------------------------------------------------------------

test('every diagram is rendered and the protocol is published', async () => {
  const diagrams = [diagramNode('graph TD; A-->B'), diagramNode('graph TD; B-->C')];
  const page = createPage({ diagrams });

  await run(page);

  assert.equal(page.calls.loads, 1, 'the runtime is loaded once, not once per diagram');
  assert.deepEqual(page.calls.rendered.map((r) => r.id), ['mermaid-0', 'mermaid-1']);
  assert.equal(diagrams[0].innerHTML, '<svg id="mermaid-0"></svg>');
  assert.deepEqual(page.win[READINESS_FLAGS.mermaidErrors], []);
  assert.equal(page.win[READINESS_FLAGS.mermaidRenderDone], true);
  await page.win[READINESS_FLAGS.mermaidReady];

  // Mermaid must be told not to auto-run and to use the themable base theme.
  assert.equal(page.calls.initialize.startOnLoad, false);
  assert.equal(page.calls.initialize.theme, 'base');
  assert.equal(mermaidInitOptions().theme, 'base');
});

test('one broken diagram becomes a placeholder without stopping the rest', async () => {
  const diagrams = [
    diagramNode('graph TD; A-->B'),
    diagramNode('graph TD; this is not mermaid'),
    diagramNode('graph TD; C-->D'),
  ];
  const page = createPage({ diagrams, failingText: 'graph TD; this is not mermaid' });

  await run(page);

  assert.equal(diagrams[0].innerHTML, '<svg id="mermaid-0"></svg>');
  assert.equal(diagrams[2].innerHTML, '<svg id="mermaid-2"></svg>');
  assert.match(diagrams[1].textContent, /Mermaid diagram failed to render/);
  assert.match(diagrams[1].textContent, /Parse error on line 2/);

  assert.deepEqual(page.win[READINESS_FLAGS.mermaidErrors], [
    { index: 1, error: 'Parse error on line 2' },
  ]);
  assert.equal(page.win[READINESS_FLAGS.mermaidRenderDone], true);
  await page.win[READINESS_FLAGS.mermaidReady];
});

test('a failed runtime load reports the fatal index and still signals completion', async () => {
  const page = createPage({ diagrams: [diagramNode('graph TD; A-->B')], runtimeFails: true });

  await run(page);

  assert.deepEqual(page.win[READINESS_FLAGS.mermaidErrors], [
    { index: FATAL_REPORT_INDEX, error: 'Failed to fetch dynamically imported module' },
  ]);
  assert.equal(page.win[READINESS_FLAGS.mermaidRenderDone], true);
  // The ready promise must resolve, or the renderer would time out instead of
  // reporting the fatal load failure it already has in the error array.
  await page.win[READINESS_FLAGS.mermaidReady];
});

test('a document with no diagrams never loads the runtime', async () => {
  const page = createPage({ diagrams: [] });

  await run(page);

  assert.equal(page.calls.loads, 0, 'no CDN fetch when there is nothing to render');
  assert.deepEqual(page.win[READINESS_FLAGS.mermaidErrors], []);
  assert.equal(page.win[READINESS_FLAGS.mermaidRenderDone], true);
  await page.win[READINESS_FLAGS.mermaidReady];
});

test('render diagnostics are published per diagram', async () => {
  const diagrams = [diagramNode('graph TD; A-->B')];
  const page = createPage({ diagrams });

  await run(page);

  assert.deepEqual(page.win[READINESS_FLAGS.mermaidDebug], [
    {
      index: 0,
      foreignObjects: 0,
      container: { width: 120, height: 40 },
      svg: { width: 120, height: 40 },
    },
  ]);
});

test('the program refuses to run without the protocol handle', async () => {
  await assert.rejects(
    () => runMermaidBootstrap({ win: {}, doc: {}, loadRuntime: async () => ({}) }),
    /readiness protocol flags/i,
  );
  await assert.rejects(
    () => runMermaidBootstrap({ flags: READINESS_FLAGS, win: {}, doc: {}, loadRuntime: async () => ({}) }),
    /fatal-report index/i,
  );
});

// ---------------------------------------------------------------------------
// The theme opt-in, across the file boundary
// ---------------------------------------------------------------------------

test('a theme that defines the opt-in variable gets its label colours normalised', async () => {
  const diagrams = [diagramNode('graph TD; A-->B')];
  const page = createPage({ diagrams, normalizing: true });

  await run(page);

  assert.equal(page.inlineStyled[0].style.props.color, undefined, 'inline color must be stripped');
  for (const label of page.labels) {
    assert.deepEqual(label.style.props.fill, { value: LABEL_LIGHT_COLOR, priority: 'important' });
    assert.deepEqual(label.style.props.color, { value: LABEL_LIGHT_COLOR, priority: 'important' });
  }
});

test('a theme without the opt-in variable keeps author label colours', async () => {
  const diagrams = [diagramNode('graph TD; A-->B')];
  const page = createPage({ diagrams, normalizing: false });

  const normalised = await run(page);

  assert.equal(normalised, undefined);
  for (const label of page.labels) {
    assert.deepEqual(label.style.props, {}, 'labels must not be touched without the opt-in');
  }
});

test('a light author fill is not overridden even when the theme opts in', async () => {
  const page = createPage({
    diagrams: [diagramNode('graph TD; A-->B')],
    normalizing: true,
    shapeFill: 'rgb(240, 242, 255)',
  });

  await run(page);

  for (const label of page.labels) {
    assert.equal(label.style.props.fill, undefined);
  }
});

test('four of the five bundled themes opt in to label normalisation', async () => {
  for (const theme of [
    'oled-style.css',
    'paper-style.css',
    'contrast-style.css',
    'compact-style.css',
  ]) {
    assert.ok(
      (await stylesDir(theme)).includes(`${NORMALIZE_VARIABLE}: 1`),
      `${theme} should opt in to Mermaid normalisation`,
    );
  }

  const light = await stylesDir('style.css');
  assert.ok(
    !light.includes(NORMALIZE_VARIABLE),
    'the light default must stay opted out',
  );
});

test('the program reads the opt-in through the variable name it exports', async () => {
  const source = await readFile(
    new URL('../src/core/mermaid-bootstrap.js', import.meta.url),
    'utf8',
  );
  assert.ok(source.includes('getComputedStyle'), 'the opt-in is read at render time');
  assert.ok(
    source.includes('getPropertyValue(NORMALIZE_VARIABLE)'),
    'the variable name must come from the exported constant, not a literal',
  );
  assert.ok(source.includes(MERMAID_CDN_URL), 'the runtime URL is a single exported constant');
});
