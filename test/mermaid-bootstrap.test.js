/**
 * @file Tests for the Mermaid browser program.
 *
 * Three seams are exercised here, and they are different on purpose:
 *
 * - The colour maths — parsing, alpha compositing, relative luminance, WCAG
 *   contrast and the surface sampler — are pure functions over plain data,
 *   tested directly. They carry the whole contrast decision, so they are the
 *   part that must be verifiable without a browser: every diagram family the
 *   fixture pins is reproduced here as a handful of records.
 * - `runMermaidBootstrap` is the browser entry point, tested by driving it
 *   against a stubbed readiness protocol and a fake document. That is the
 *   second adapter for the seam: the production one is a real page.
 * - The DOM adapter that reads rects and computed styles is *not* unit-tested
 *   here. It is exercised by the rendered PDFs, because a fake DOM that
 *   agreed with the adapter would prove only that the fake agrees with itself.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  isDarkColor,
  runMermaidBootstrap,
  mermaidInitOptions,
  rootVariableValue,
  normalizeLabelColors,
  parseColor,
  compositeOver,
  relativeLuminance,
  contrastRatio,
  chooseInk,
  normalizedInk,
  paintedSurfaceAt,
  isExcludedLabel,
  ganttThemeVariables,
  NORMALIZE_VARIABLE,
  THEME_VARIABLE,
  BOOTSTRAP_VARIABLES,
  GANTT_VARIABLES,
  DEFAULT_MERMAID_THEME,
  LABEL_LIGHT_COLOR,
  LABEL_DARK_COLOR,
  LABEL_INK_CANDIDATES,
  LABEL_EXCLUSIONS,
  MIN_CONTRAST_RATIO,
  PAINTED_SHAPE_TAGS,
  PAINTED_SHAPE_SELECTOR,
  MERMAID_CDN_URL,
} from '../src/core/mermaid-bootstrap.js';
import { READINESS_FLAGS, FATAL_REPORT_INDEX, publishFlag } from '../src/core/readiness-protocol.js';
import { bundledThemes, readTheme } from './helpers/themes.js';

// ---------------------------------------------------------------------------
// Colour parsing
// ---------------------------------------------------------------------------

test('the module carries no readiness globals of its own before it is run', () => {
  const before = Object.keys(globalThis).filter((key) => key.startsWith('__'));
  assert.deepEqual(
    before,
    [],
    'importing the browser program must not publish readiness flags',
  );
});

test('parseColor reads the six colour forms a document can carry', () => {
  // Hex, in every length CSS allows: 3 and 4 are the shorthand forms, 6 and 8
  // the full ones, and the extra digit in 4 and 8 is alpha.
  assert.deepEqual(parseColor('#fff'), { r: 255, g: 255, b: 255, a: 1 });
  assert.deepEqual(parseColor('#000'), { r: 0, g: 0, b: 0, a: 1 });
  assert.deepEqual(parseColor('#f00'), { r: 255, g: 0, b: 0, a: 1 });
  assert.deepEqual(parseColor('#1b2130'), { r: 27, g: 33, b: 48, a: 1 });
  assert.deepEqual(parseColor('#00000080'), { r: 0, g: 0, b: 0, a: 128 / 255 });

  // rgb()/rgba(), comma-separated, as Chrome writes it for computed styles.
  assert.deepEqual(parseColor('rgb(20, 24, 40)'), { r: 20, g: 24, b: 40, a: 1 });
  assert.deepEqual(parseColor('rgba(211, 211, 211, 0.5)'), { r: 211, g: 211, b: 211, a: 0.5 });

  // The space/slash form is legal CSS and is what an author `style` directive
  // can produce, so it parses too.
  assert.deepEqual(parseColor('rgb(20 24 40 / 0.25)'), { r: 20, g: 24, b: 40, a: 0.25 });
});

test('parseColor is case- and whitespace-insensitive, as computed styles are', () => {
  assert.deepEqual(parseColor('  RGB(0,0,0)  '), { r: 0, g: 0, b: 0, a: 1 });
  assert.deepEqual(parseColor('RGBA( 10 , 10 , 10 , 1 )'), { r: 10, g: 10, b: 10, a: 1 });
  assert.deepEqual(parseColor('#ABC'), { r: 170, g: 187, b: 204, a: 1 });
});

test('parseColor reports a transparent colour and an absent fill by alpha, not by a special value', () => {
  // A `<g>` wrapper and a Mermaid plate both compute to these, and both must
  // contribute no paint. Reporting them as a colour with alpha 0 lets the
  // compositor treat them uniformly instead of the sampler carrying a
  // transparent-versus-absent branch.
  assert.deepEqual(parseColor('transparent'), { r: 0, g: 0, b: 0, a: 0 });
  assert.deepEqual(parseColor('rgba(0, 0, 0, 0)'), { r: 0, g: 0, b: 0, a: 0 });
  assert.equal(parseColor('none'), null);
});

test('parseColor refuses anything it cannot measure, rather than guessing a colour', () => {
  // Named colours other than the two below are deliberately unsupported: the
  // sampler reads `getComputedStyle`, which resolves every keyword to rgb(),
  // so a keyword here means the input did not come from a computed style and
  // guessing would hide that. The two primaries are read anyway because tests
  // and fixtures state surfaces as `black`/`white` for legibility.
  for (const value of ['', '   ', 'none', 'currentColor', 'hsl(210 40% 20%)', 'red', null, undefined, 42, {}, []]) {
    assert.equal(parseColor(value), null, `${String(value)} is not a measurable colour`);
  }
  assert.deepEqual(parseColor('black'), { r: 0, g: 0, b: 0, a: 1 });
  assert.deepEqual(parseColor('white'), { r: 255, g: 255, b: 255, a: 1 });
});

// ---------------------------------------------------------------------------
// Alpha compositing
// ---------------------------------------------------------------------------

test('compositeOver returns the top colour when it is opaque', () => {
  assert.deepEqual(
    compositeOver(parseColor('#123456'), parseColor('#ffffff')),
    { r: 0x12, g: 0x34, b: 0x56, a: 1 },
  );
});

test('compositeOver mixes a half-transparent coat over its backdrop', () => {
  // 50% white over black is the canonical case, and the one a Gantt section
  // band reproduces at 20%: the band is pale, but what the label sits on is
  // the composite, not the band's own colour.
  assert.deepEqual(compositeOver(parseColor('rgba(255,255,255,0.5)'), parseColor('#000000')), {
    r: 127.5, g: 127.5, b: 127.5, a: 1,
  });
});

test('compositeOver leaves a fully transparent coat invisible', () => {
  assert.deepEqual(
    compositeOver(parseColor('rgba(255,255,255,0)'), parseColor('#1b2130')),
    { r: 27, g: 33, b: 48, a: 1 },
  );
});

// ---------------------------------------------------------------------------
// Relative luminance and WCAG contrast
// ---------------------------------------------------------------------------

test('relativeLuminance is the WCAG definition, linearised per channel', () => {
  assert.equal(relativeLuminance(parseColor('#000000')), 0);
  assert.equal(relativeLuminance(parseColor('#ffffff')), 1);
  // 0.5 in the sRGB channel scale linearises to 0.2140; the weighting of three
  // equal channels leaves it there.
  assert.ok(Math.abs(relativeLuminance(parseColor('#808080')) - 0.2159) < 0.001);
  // A computed-style string is accepted as well as a parsed colour, because
  // the deciding caller has one and the testing caller has the other.
  assert.equal(relativeLuminance('#ffffff'), 1);
  assert.equal(relativeLuminance('not a colour'), null);
});

test('contrastRatio is the WCAG ratio, symmetric and bounded', () => {
  assert.equal(contrastRatio(parseColor('#000000'), parseColor('#ffffff')), 21);
  assert.equal(contrastRatio(parseColor('#ffffff'), parseColor('#000000')), 21);
  assert.equal(contrastRatio(parseColor('#1b2130'), parseColor('#1b2130')), 1);

  // The value the old threshold rule got wrong: mid grey is neither dark nor
  // light enough to be decided by halves, and the ratio is the only measure.
  const grey = parseColor('#808080');
  assert.ok(Math.abs(contrastRatio(grey, parseColor('#ffffff')) - 3.95) < 0.05);
  assert.ok(Math.abs(contrastRatio(grey, parseColor('#000000')) - 5.32) < 0.05);
});

test('contrastRatio reports null when either side cannot be measured', () => {
  assert.equal(contrastRatio(parseColor('none'), parseColor('#ffffff')), null);
  assert.equal(contrastRatio(parseColor('#ffffff'), 'nonsense'), null);
});

// ---------------------------------------------------------------------------
// The ink decision
// ---------------------------------------------------------------------------

test('chooseInk picks the candidate that maximises contrast, not the lighter one', () => {
  const light = parseColor('#f5f5f5');
  const dark = parseColor('#1b2130');

  assert.equal(chooseInk(LABEL_INK_CANDIDATES, dark), LABEL_LIGHT_COLOR);
  assert.equal(chooseInk(LABEL_INK_CANDIDATES, light), LABEL_DARK_COLOR);

  // And on a mid-tone surface it picks whichever of the two wins, which is the
  // computation the 128 threshold replaced with a coin flip.
  const mid = parseColor('#808080');
  assert.equal(chooseInk(LABEL_INK_CANDIDATES, mid), LABEL_DARK_COLOR);
});

test('chooseInk returns null when no candidate is measurable', () => {
  assert.equal(chooseInk(LABEL_INK_CANDIDATES, null), null);
  assert.equal(chooseInk([], parseColor('#ffffff')), null);
});

test('normalizedInk leaves an ink that already meets AA alone', () => {
  // Nothing is restyled that did not need it: a theme's own ink is typographic
  // intent, and the decision is a repair, not a repaint.
  assert.equal(normalizedInk({ surface: parseColor('#ffffff'), ink: parseColor('#333333') }), null);
  assert.equal(normalizedInk({ surface: parseColor('#000000'), ink: parseColor('#e6e9f5') }), null);
});

test('normalizedInk replaces an ink that fails AA on the surface behind it', () => {
  // Light ink on a light author fill — the defect a dark-fill-only rule left
  // in place — becomes dark ink.
  assert.equal(
    normalizedInk({ surface: parseColor('#f5f5f5'), ink: parseColor('#ffffff') }),
    LABEL_DARK_COLOR,
  );
  // And the mirror: dark runtime ink left on a dark surface.
  assert.equal(
    normalizedInk({ surface: parseColor('#1b2130'), ink: parseColor('#2c2c2c') }),
    LABEL_LIGHT_COLOR,
  );
});

test('normalizedInk repairs an ink it cannot parse instead of leaving it', () => {
  assert.equal(normalizedInk({ surface: parseColor('#ffffff'), ink: null }), LABEL_DARK_COLOR);
  assert.equal(normalizedInk({ surface: null, ink: parseColor('#000000') }), null, 'no surface, no decision');
});

test('the AA threshold is the one the assertions name', () => {
  assert.equal(MIN_CONTRAST_RATIO, 4.5);
});

// ---------------------------------------------------------------------------
// Background sampling
// ---------------------------------------------------------------------------

/** A painted-geometry record, as the DOM adapter produces one. */
function shape(tag, x, y, width, height, fill, { opacity = 1, fillOpacity = 1 } = {}) {
  return { tag, x, y, width, height, fill, opacity, fillOpacity };
}

const CANVAS_BLACK = parseColor('#000000');
const CANVAS_WHITE = parseColor('#ffffff');

test('paintedSurfaceAt finds the Gantt bar directly behind an inside-bar label', () => {
  // The measured OLED Gantt: a section band at 20% opacity and a task bar. The
  // label sits inside the bar, so the bar is the surface.
  const shapes = [
    shape('rect', 0, 48, 763, 24, '#b4ac76', { opacity: 0.2 }),
    shape('rect', 75, 50, 137, 20, '#d3d3d3'),
  ];

  const surface = paintedSurfaceAt(100, 60, shapes, CANVAS_BLACK);
  assert.deepEqual(surface, { r: 211, g: 211, b: 211, a: 1 });
});

test('paintedSurfaceAt falls through to the canvas for an outside-bar label', () => {
  // The same row, sampled just past the end of the bar. Nothing contains the
  // point but the translucent band, and the band composites over the page.
  const shapes = [
    shape('rect', 0, 48, 763, 24, '#b4ac76', { opacity: 0.2 }),
    shape('rect', 75, 50, 137, 20, '#d3d3d3'),
  ];

  const surface = paintedSurfaceAt(400, 60, shapes, CANVAS_BLACK);
  // 20% of rgb(180,172,118) over black.
  assert.deepEqual(surface, { r: 36, g: 34.4, b: 23.6, a: 1 });
});

test('paintedSurfaceAt samples a sequence actor box', () => {
  const shapes = [shape('rect', 293, 257, 26, 11, '#1b2130')];
  assert.deepEqual(paintedSurfaceAt(300, 260, shapes, CANVAS_BLACK), { r: 27, g: 33, b: 48, a: 1 });
});

test('paintedSurfaceAt never samples a non-geometry wrapper, whatever fill it claims', () => {
  // The class-diagram defect in one assertion: a `<g>` label container with a
  // fill on it is not paint. Neither is a transparent rect. Both must leave
  // the canvas showing through.
  assert.ok(!PAINTED_SHAPE_TAGS.includes('g'));
  assert.equal(PAINTED_SHAPE_SELECTOR.includes('g,'), false);

  const shapes = [
    shape('g', 0, 0, 200, 200, '#1b2130'),
    shape('rect', 0, 0, 200, 200, 'rgba(0, 0, 0, 0)'),
  ];
  assert.deepEqual(paintedSurfaceAt(10, 10, shapes, CANVAS_WHITE), { r: 255, g: 255, b: 255, a: 1 });
});

test('paintedSurfaceAt ignores a fill of none, zero opacity and zero fill-opacity', () => {
  const shapes = [
    shape('path', 0, 0, 200, 200, 'none'),
    shape('rect', 0, 0, 200, 200, '#ff0000', { opacity: 0 }),
    shape('rect', 0, 0, 200, 200, '#00ff00', { fillOpacity: 0 }),
  ];
  assert.deepEqual(paintedSurfaceAt(10, 10, shapes, CANVAS_WHITE), { r: 255, g: 255, b: 255, a: 1 });
});

test('paintedSurfaceAt composites a semi-transparent fill over what is beneath it', () => {
  const shapes = [
    shape('rect', 0, 0, 100, 100, '#ffffff'),
    shape('rect', 0, 0, 100, 100, '#000000', { fillOpacity: 0.5 }),
  ];
  assert.deepEqual(paintedSurfaceAt(50, 50, shapes, CANVAS_BLACK), {
    r: 127.5, g: 127.5, b: 127.5, a: 1,
  });
});

test('paintedSurfaceAt respects paint order, so the last shape wins', () => {
  // A Mermaid state cluster is an `outer` rect with an `inner` rect painted on
  // top. Sampling the pair must give the inner one, and reversing the list
  // must give the outer — the sampler has no other notion of depth.
  const outer = shape('rect', 0, 0, 100, 100, '#1f2020');
  const inner = shape('rect', 5, 5, 90, 90, '#555555');

  assert.deepEqual(paintedSurfaceAt(50, 50, [outer, inner], CANVAS_BLACK), { r: 85, g: 85, b: 85, a: 1 });
  assert.deepEqual(paintedSurfaceAt(50, 50, [inner, outer], CANVAS_BLACK), { r: 31, g: 32, b: 32, a: 1 });
});

test('paintedSurfaceAt decides a custom dark node fill needs light ink', () => {
  const shapes = [shape('rect', 0, 0, 100, 40, '#1b2130')];
  const surface = paintedSurfaceAt(50, 20, shapes, CANVAS_BLACK);
  assert.equal(chooseInk(LABEL_INK_CANDIDATES, surface), LABEL_LIGHT_COLOR);
});

test('paintedSurfaceAt decides a custom light node fill needs dark ink', () => {
  // The author `style B fill:#f5f5f5` case on a black page: the shape is
  // light, so the page's own light ink would be invisible on it.
  const shapes = [shape('rect', 0, 0, 100, 40, '#f5f5f5')];
  const surface = paintedSurfaceAt(50, 20, shapes, CANVAS_BLACK);
  assert.equal(chooseInk(LABEL_INK_CANDIDATES, surface), LABEL_DARK_COLOR);
});

test('a point outside every shape is the canvas, not nothing', () => {
  assert.deepEqual(paintedSurfaceAt(500, 500, [shape('rect', 0, 0, 10, 10, '#123456')], CANVAS_BLACK), CANVAS_BLACK);
  assert.deepEqual(paintedSurfaceAt(0, 0, [], CANVAS_WHITE), CANVAS_WHITE);
});

// ---------------------------------------------------------------------------
// The label exclusions
// ---------------------------------------------------------------------------

test('the sequence autonumber badge is the one excluded marker, named once', () => {
  assert.deepEqual([...LABEL_EXCLUSIONS], ['sequenceNumber']);
  assert.equal(isExcludedLabel('sequenceNumber'), true);
  assert.equal(isExcludedLabel('actor actor-top sequenceNumber'), true);
  assert.equal(isExcludedLabel('taskText taskText0 doneText0'), false);
  assert.equal(isExcludedLabel(''), false);
  assert.equal(isExcludedLabel(null), false);
});

// ---------------------------------------------------------------------------
// The Gantt theme variables (#18 carry-over)
// ---------------------------------------------------------------------------

test('the Gantt variables map a root property to the Mermaid theme key it sets', () => {
  assert.deepEqual(
    GANTT_VARIABLES.map((variable) => variable.name).sort(),
    [
      '--mermaid-gantt-active-fill',
      '--mermaid-gantt-done-fill',
      '--mermaid-gantt-task-fill',
    ].sort(),
  );
  for (const variable of GANTT_VARIABLES) {
    assert.equal(typeof variable.key, 'string');
    assert.ok(variable.purpose.length > 10, `${variable.name} must say what it is for`);
  }
});

test('ganttThemeVariables returns only the keys a theme declared', () => {
  const declared = {
    '--mermaid-gantt-done-fill': '#1b2130',
    '--mermaid-gantt-task-fill': '#24304a',
  };
  const read = (name) => declared[name] ?? '';

  assert.deepEqual(ganttThemeVariables(read), {
    doneTaskBkgColor: '#1b2130',
    taskBkgColor: '#24304a',
  });
});

test('ganttThemeVariables returns an empty object when a theme declares none', () => {
  assert.deepEqual(ganttThemeVariables(() => ''), {});
  assert.deepEqual(ganttThemeVariables(() => '   '), {});
});

test('mermaidInitOptions merges theme variables only when there are some', () => {
  // The light themes must reach Mermaid with byte-identical options: an
  // absent `themeVariables` key is not the same document as one carrying `{}`.
  assert.equal(Object.hasOwn(mermaidInitOptions(), 'themeVariables'), false);

  const withGantt = mermaidInitOptions('dark', { doneTaskBkgColor: '#1b2130' });
  assert.deepEqual(withGantt.themeVariables, { doneTaskBkgColor: '#1b2130' });
  assert.equal(withGantt.theme, 'dark');

  // Merged, not replaced: a caller that also passes its own variables keeps
  // them, and a caller's object is not mutated.
  const callerVariables = { primaryColor: '#111111' };
  const merged = mermaidInitOptions('base', callerVariables, { gridColor: '#222222' });
  assert.deepEqual(merged.themeVariables, { primaryColor: '#111111', gridColor: '#222222' });
  assert.deepEqual(callerVariables, { primaryColor: '#111111' });
});

// ---------------------------------------------------------------------------
// A stubbed page: the second adapter for the bootstrap seam
// ---------------------------------------------------------------------------

/** A computed-style stub: `fill` for shapes, `getPropertyValue` for the root. */
function styleStub({
  fill = '',
  opacity = '1',
  fillOpacity = '1',
  color = '',
  backgroundColor = '',
  variables = {},
} = {}) {
  return {
    fill,
    color,
    opacity,
    fillOpacity,
    backgroundColor,
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

/**
 * A label or shape in the fake SVG.
 *
 * `matches` answers only the exclusions the program asks about, so the fake
 * pins which selectors the adapter actually uses.
 */
function svgElement({
  tag = 'rect',
  className = '',
  text = '',
  box = { x: 0, y: 0, width: 10, height: 10 },
  style = {},
  computed = {},
  children = [],
} = {}) {
  const inline = element();
  Object.assign(inline.style.props, style);
  return {
    ...inline,
    tagName: tag.toUpperCase(),
    textContent: text,
    children,
    getAttribute: (name) => (name === 'class' ? className : null),
    matches(selector) {
      return selector
        .split(',')
        .map((part) => part.trim().replace(/^\./, ''))
        .some((token) => token !== '' && className.split(/\s+/).includes(token));
    },
    querySelectorAll(selector) {
      if (selector === 'tspan') return children.filter((child) => child.tagName === 'TSPAN');
      return [];
    },
    getBoundingClientRect: () => ({ ...box, top: box.y, left: box.x, right: box.x + box.width, bottom: box.y + box.height }),
    __computed: computed,
  };
}

/** A fake SVG whose selector results the test declares. */
function fakeSvg({ shapes = [], texts = [], foreignLeaves = [] } = {}) {
  const all = [...shapes, ...texts, ...foreignLeaves];
  return {
    getBoundingClientRect: () => ({ x: 0, y: 0, width: 200, height: 200 }),
    querySelectorAll(selector) {
      if (selector === PAINTED_SHAPE_SELECTOR) return shapes;
      if (selector === 'text') return texts;
      if (selector === 'foreignObject *') return foreignLeaves;
      if (selector === 'foreignObject') return [];
      throw new Error(`unexpected svg selector: ${selector}`);
    },
    __all: all,
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
  mermaidTheme,
  shapeFill = 'rgb(20, 24, 40)',
  runtimeFails = false,
  failingText = null,
  svgFactory = () => fakeSvg(),
  rootVariables = {},
  canvas = 'rgb(255, 255, 255)',
} = {}) {
  const calls = { initialize: null, rendered: [], loads: 0, removed: [] };
  const root = element();
  const body = element();

  const doc = {
    documentElement: root,
    body,
    querySelectorAll(selector) {
      if (selector === '.mermaid') return diagrams;
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

  const variables = { ...rootVariables, [NORMALIZE_VARIABLE]: normalizing ? '1' : '' };
  if (mermaidTheme !== undefined) variables[THEME_VARIABLE] = mermaidTheme;

  const computed = new Map([
    [root, styleStub({ variables, backgroundColor: canvas })],
    [body, styleStub({ variables, backgroundColor: 'rgba(0, 0, 0, 0)' })],
  ]);

  const computedStyle = (el) => {
    if (computed.has(el)) return computed.get(el);
    if (el.__computed) return styleStub(el.__computed);
    return styleStub({ fill: shapeFill });
  };

  const win = {
    document: doc,
    getComputedStyle: computedStyle,
  };

  const runtime = {
    initialize(options) {
      calls.initialize = options;
    },
    async render(id, source) {
      calls.rendered.push({ id, source });
      if (source === failingText) throw new Error('Parse error on line 2');
      const node = diagrams.find((candidate) => candidate.textContent === source);
      node.svg = { ...svgFactory(), getBoundingClientRect: () => ({ x: 0, y: 0, width: 120, height: 40 }) };
      return { svg: `<svg id="${id}"></svg>` };
    },
  };

  const loadRuntime = async () => {
    calls.loads++;
    if (runtimeFails) throw new Error('Failed to fetch dynamically imported module');
    return runtime;
  };

  return { win, doc, root, body, loadRuntime, calls, computedStyle, svgFactory };
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
// The theme selection, read before Mermaid initialises
// ---------------------------------------------------------------------------

test('the exported theme variable is the one the bootstrap reads', () => {
  assert.equal(THEME_VARIABLE, '--mermaid-theme');
  assert.ok(
    BOOTSTRAP_VARIABLES.includes(NORMALIZE_VARIABLE) && BOOTSTRAP_VARIABLES.includes(THEME_VARIABLE),
    'both root properties the browser program owns must be declared together',
  );
});

test('a theme setting --mermaid-theme: dark makes Mermaid initialise with dark', async () => {
  const page = createPage({ diagrams: [diagramNode('graph TD; A-->B')], mermaidTheme: 'dark' });

  await run(page);

  assert.equal(page.calls.initialize.theme, 'dark');
});

test('a theme without --mermaid-theme keeps Mermaid on its base theme', async () => {
  const page = createPage({ diagrams: [diagramNode('graph TD; A-->B')] });

  await run(page);

  assert.equal(page.calls.initialize.theme, 'base');
});

test('an empty or whitespace-only --mermaid-theme falls back to base', async () => {
  for (const value of ['', '   ', '\n\t']) {
    const page = createPage({ diagrams: [diagramNode('graph TD; A-->B')], mermaidTheme: value });

    await run(page);

    assert.equal(page.calls.initialize.theme, 'base', `${JSON.stringify(value)} must not become a theme`);
  }
});

test('the resolved theme is trimmed, so a padded declaration still selects it', async () => {
  const page = createPage({ diagrams: [diagramNode('graph TD; A-->B')], mermaidTheme: '  dark\n' });

  await run(page);

  assert.equal(page.calls.initialize.theme, 'dark');
});

test('mermaidInitOptions keeps its other options and returns a fresh object per theme', () => {
  const base = mermaidInitOptions();
  const dark = mermaidInitOptions('dark');

  assert.equal(dark.theme, 'dark');
  assert.equal(base.theme, DEFAULT_MERMAID_THEME);
  assert.equal(DEFAULT_MERMAID_THEME, 'base');
  assert.notEqual(base, mermaidInitOptions(), 'a caller must not be able to mutate a shared options object');
  for (const options of [base, dark]) {
    assert.equal(options.startOnLoad, false);
    assert.equal(options.securityLevel, 'loose');
    assert.deepEqual(options.flowchart, { htmlLabels: false });
    assert.deepEqual(options.sequence, { useMaxWidth: true, htmlLabels: false });
    assert.deepEqual(options.gantt, { useMaxWidth: true });
  }
});

test('rootVariableValue treats an empty declaration as absent, with a per-read fallback', () => {
  const root = (value) => ({ getPropertyValue: () => value });

  assert.equal(rootVariableValue(root('dark'), THEME_VARIABLE), 'dark');
  assert.equal(rootVariableValue(root('  dark\n'), THEME_VARIABLE), 'dark');
  assert.equal(rootVariableValue(root(''), THEME_VARIABLE, 'base'), 'base');
  assert.equal(rootVariableValue(root('   '), THEME_VARIABLE, 'base'), 'base');
  assert.equal(rootVariableValue(root('1'), NORMALIZE_VARIABLE), '1');
});

test('the theme and the Gantt variables are read before Mermaid initialises, not after the render loop', async () => {
  // The order is the whole point: `mermaid.initialize` needs the resolved
  // theme and the theme variables it merges, and it runs before any diagram is
  // rendered. A read placed beside the normalisation opt-in would happen one
  // step too late, and the behavioural tests would still pass because the fake
  // captures the options object either way.
  const source = await readFile(
    new URL('../src/core/mermaid-bootstrap.js', import.meta.url),
    'utf8',
  );

  const themeRead = source.indexOf(`rootVariableValue(rootStyle, THEME_VARIABLE`);
  const initialise = source.indexOf('mermaid.initialize(mermaidInitOptions(');
  assert.ok(themeRead > -1, 'the theme must be read through the exported constant');
  assert.ok(initialise > -1, 'the resolved theme must be the one initialisation receives');
  assert.ok(themeRead < initialise, 'the theme must be resolved before mermaid.initialize()');

  const ganttRead = source.indexOf('ganttThemeVariables(');
  assert.ok(ganttRead > -1, 'the Gantt variables must be read through the exported contract');
  assert.ok(ganttRead < initialise, 'the Gantt variables must be resolved before mermaid.initialize()');

  // And the normalisation opt-in keeps reading the root after the render loop.
  const renderLoop = source.indexOf('for (const [index, node] of nodes.entries())');
  assert.ok(
    source.indexOf('rootVariableValue(computedStyle(document_.documentElement), NORMALIZE_VARIABLE)') > renderLoop,
    'the normalisation opt-in is read after the render loop; that behaviour is unchanged',
  );
});

test('a theme declaring Gantt variables hands them to Mermaid as themeVariables', async () => {
  const page = createPage({
    diagrams: [diagramNode('graph TD; A-->B')],
    mermaidTheme: 'dark',
    rootVariables: {
      '--mermaid-gantt-done-fill': '#1b2130',
      '--mermaid-gantt-active-fill': '#24304a',
    },
  });

  await run(page);

  assert.equal(page.calls.initialize.theme, 'dark');
  assert.deepEqual(page.calls.initialize.themeVariables, {
    doneTaskBkgColor: '#1b2130',
    activeTaskBkgColor: '#24304a',
  });
});

test('a theme declaring no Gantt variables reaches Mermaid without a themeVariables key', async () => {
  const page = createPage({ diagrams: [diagramNode('graph TD; A-->B')] });

  await run(page);

  assert.equal(Object.hasOwn(page.calls.initialize, 'themeVariables'), false);
});

// ---------------------------------------------------------------------------
// The theme opt-in, across the file seam
// ---------------------------------------------------------------------------

test('a theme without the opt-in variable leaves every label untouched', async () => {
  const labels = [svgElement({ tag: 'text', text: 'Node', computed: { fill: 'rgb(255,255,255)' } })];
  const page = createPage({
    diagrams: [diagramNode('graph TD; A-->B')],
    normalizing: false,
    svgFactory: () => fakeSvg({ texts: labels }),
  });

  const result = await run(page);

  assert.equal(result, undefined);
  for (const label of labels) {
    assert.deepEqual(label.style.props, {}, 'labels must not be touched without the opt-in');
  }
});

test('an opted-in theme inks a light label on a dark shape', async () => {
  const node = svgElement({
    tag: 'rect',
    box: { x: 0, y: 0, width: 100, height: 40 },
    computed: { fill: 'rgb(27, 33, 48)' },
  });
  const label = svgElement({
    tag: 'text',
    text: 'Node',
    box: { x: 30, y: 12, width: 40, height: 14 },
    computed: { fill: 'rgb(230, 233, 245)' },
  });
  const page = createPage({
    diagrams: [diagramNode('graph TD; A-->B')],
    normalizing: true,
    svgFactory: () => fakeSvg({ shapes: [node], texts: [label] }),
  });

  await run(page);

  // Already readable: 12:1 on the shape, so the theme's ink is left alone.
  assert.deepEqual(label.style.props, {});
});

test('an opted-in theme repairs light ink left on a light author fill', async () => {
  // The dark-fill-only rule never looked at a light shape, so white ink on an
  // author `fill:#f5f5f5` stayed white and vanished. This is that case.
  const node = svgElement({
    tag: 'rect',
    box: { x: 0, y: 0, width: 100, height: 40 },
    computed: { fill: 'rgb(245, 245, 245)' },
  });
  const label = svgElement({
    tag: 'text',
    text: 'Light fill',
    box: { x: 30, y: 12, width: 40, height: 14 },
    computed: { fill: 'rgb(255, 255, 255)' },
  });
  const page = createPage({
    diagrams: [diagramNode('graph TD; A-->B')],
    normalizing: true,
    svgFactory: () => fakeSvg({ shapes: [node], texts: [label] }),
  });

  await run(page);

  assert.deepEqual(label.style.props.fill, { value: LABEL_DARK_COLOR, priority: 'important' });
  assert.deepEqual(label.style.props.color, { value: LABEL_DARK_COLOR, priority: 'important' });
});

test('an opted-in theme re-inks a label whose runtime ink is an !important override', async () => {
  // Mermaid writes `#mermaid-N .activeText0 { fill:#2c2c2c !important }` for a
  // Gantt task's overflow label, which lands on the bare page. An inline
  // `!important` declaration is the one thing that outranks it, so that is
  // what the adapter sets.
  const label = svgElement({
    tag: 'text',
    className: 'taskText activeText0',
    text: 'Assemble HTML shell',
    box: { x: 10, y: 10, width: 80, height: 14 },
    computed: { fill: 'rgb(44, 44, 44)' },
  });
  const page = createPage({
    diagrams: [diagramNode('graph TD; A-->B')],
    normalizing: true,
    canvas: 'rgb(0, 0, 0)',
    svgFactory: () => fakeSvg({ texts: [label] }),
  });

  await run(page);

  assert.deepEqual(label.style.props.fill, { value: LABEL_LIGHT_COLOR, priority: 'important' });
});

test('an opted-in theme inks leaf text inside a foreignObject, where ink is the colour property', async () => {
  const node = svgElement({
    tag: 'rect',
    box: { x: 0, y: 0, width: 100, height: 40 },
    computed: { fill: 'rgb(27, 33, 48)' },
  });
  const leaf = svgElement({
    tag: 'p',
    text: 'Start',
    box: { x: 30, y: 12, width: 40, height: 14 },
    computed: { color: 'rgb(44, 44, 44)' },
  });
  const page = createPage({
    diagrams: [diagramNode('graph TD; A-->B')],
    normalizing: true,
    svgFactory: () => fakeSvg({ shapes: [node], foreignLeaves: [leaf] }),
  });

  await run(page);

  assert.deepEqual(leaf.style.props.color, { value: LABEL_LIGHT_COLOR, priority: 'important' });
});

test('an opted-in theme never re-inks the sequence autonumber badge', async () => {
  const badge = svgElement({
    tag: 'text',
    className: 'sequenceNumber',
    text: '1',
    box: { x: 2, y: 2, width: 8, height: 8 },
    computed: { fill: 'rgb(255, 255, 255)' },
  });
  const page = createPage({
    diagrams: [diagramNode('graph TD; A-->B')],
    normalizing: true,
    svgFactory: () => fakeSvg({ texts: [badge] }),
  });

  await run(page);

  assert.deepEqual(badge.style.props, {}, 'the badge numeral is Mermaid’s, pinned by #17');
});

test('normalizeLabelColors reports what it inspected and what it repaired', () => {
  const dark = svgElement({ tag: 'rect', box: { x: 0, y: 0, width: 100, height: 40 }, computed: { fill: 'rgb(27, 33, 48)' } });
  const fixed = svgElement({
    tag: 'text', text: 'A', box: { x: 10, y: 10, width: 20, height: 10 }, computed: { fill: 'rgb(20, 24, 40)' },
  });
  const kept = svgElement({
    tag: 'text', text: 'B', box: { x: 60, y: 10, width: 20, height: 10 }, computed: { fill: 'rgb(238, 241, 251)' },
  });
  const svg = fakeSvg({ shapes: [dark], texts: [fixed, kept] });
  const doc = {
    documentElement: element(),
    body: element(),
    querySelectorAll: (selector) => (selector === '.mermaid' ? [{ querySelector: () => svg }] : []),
  };
  const computedStyle = (el) => (el.__computed ? styleStub(el.__computed) : styleStub({}));

  const report = normalizeLabelColors(doc, computedStyle);

  assert.deepEqual(report, { checked: 2, adjusted: 1 });
});

test('the bundled themes declare the Gantt variables only where they paint dark bars', async () => {
  const themes = await bundledThemes();
  assert.ok(themes.length >= 5, 'the bundled themes must be discovered from styles/');

  for (const theme of themes) {
    const css = await readTheme(theme, { stripComments: true });
    const declares = [...css.matchAll(/(--mermaid-gantt-[\w-]+)\s*:/g)].map((match) => match[1]);
    for (const name of declares) {
      assert.ok(
        GANTT_VARIABLES.some((variable) => variable.name === name),
        `${theme} declares ${name}, which the bootstrap does not read`,
      );
    }
    if (theme === 'style.css') {
      assert.deepEqual(declares, [], 'the light default must keep Mermaid’s own Gantt bars');
    }
  }
});

test('every --mermaid-gantt-* name is a bootstrap-owned property', () => {
  const owned = new Set(BOOTSTRAP_VARIABLES);
  for (const variable of GANTT_VARIABLES) {
    assert.ok(owned.has(variable.name), `${variable.name} must be published in BOOTSTRAP_VARIABLES`);
  }
});

test('four of the five bundled themes opt in to label normalisation', async () => {
  const optInThemes = (await bundledThemes()).filter((name) => name !== 'style.css');
  assert.ok(optInThemes.length >= 4, 'bundled opt-in themes must be discovered from styles/');

  for (const theme of optInThemes) {
    assert.ok(
      (await readTheme(theme)).includes(`${NORMALIZE_VARIABLE}: 1`),
      `${theme} should opt in to Mermaid normalisation`,
    );
  }

  const light = await readTheme('style.css');
  assert.ok(
    !light.includes(NORMALIZE_VARIABLE),
    'the light default must stay opted out',
  );
});

test('the program can publish readiness through the protocol publishFlag adapter', async () => {
  const diagrams = [diagramNode('graph TD; A-->B')];
  const page = createPage({ diagrams });

  await runMermaidBootstrap({
    flags: READINESS_FLAGS,
    publish: publishFlag,
    fatalReportIndex: FATAL_REPORT_INDEX,
    win: page.win,
    doc: page.doc,
    loadRuntime: page.loadRuntime,
  });

  assert.equal(page.win[READINESS_FLAGS.mermaidRenderDone], true);
  assert.deepEqual(page.win[READINESS_FLAGS.mermaidErrors], []);
  await page.win[READINESS_FLAGS.mermaidReady];
});

test('the program reads the opt-in through the variable name it exports', async () => {
  const source = await readFile(
    new URL('../src/core/mermaid-bootstrap.js', import.meta.url),
    'utf8',
  );
  assert.ok(source.includes('getComputedStyle'), 'the opt-in is read at render time');

  // The read lives behind `rootVariableValue`, which takes the exported
  // constant as its argument: the name still has one owner, and the trim and
  // empty-as-absent rule is stated once for every root property.
  assert.ok(
    source.includes('getPropertyValue(name)'),
    'custom properties are read through the one helper that normalises them',
  );
  assert.ok(
    source.includes('rootVariableValue(computedStyle(document_.documentElement), NORMALIZE_VARIABLE)'),
    'the variable name must come from the exported constant, not a literal',
  );
  assert.ok(source.includes(MERMAID_CDN_URL), 'the runtime URL is a single exported constant');
});

// ---------------------------------------------------------------------------
// Luminance as the palette check it still is
// ---------------------------------------------------------------------------

test('isDarkColor reads a computed-style rgb() string for a dark fill', () => {
  // What getComputedStyle actually returns for the OLED theme's node fill.
  assert.equal(isDarkColor('rgb(20, 24, 40)'), true);
});

test('isDarkColor reads a computed-style rgba() string for a light fill', () => {
  assert.equal(isDarkColor('rgba(240, 242, 255, 1)'), false);
  assert.equal(isDarkColor('rgb(255, 255, 255)'), false);
});

test('isDarkColor splits the palette at the luminance threshold', () => {
  // The rule is relative luminance below the threshold on the WCAG scale, so
  // comfortably above is light and comfortably below is dark.
  assert.equal(isDarkColor('rgb(130, 130, 130)'), false);
  assert.equal(isDarkColor('rgb(126, 126, 126)'), true);
});

test('isDarkColor reports an unmeasurable colour as light rather than throwing', () => {
  for (const value of ['', 'none', 'transparent', null, undefined, 42, 'red']) {
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
