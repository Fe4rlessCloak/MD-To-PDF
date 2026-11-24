/**
 * @file Tests for the shared Mermaid styling block.
 *
 * The block lives in `src/core/mermaid-styles/mermaid.css` and is emitted for
 * every document. It targets Mermaid's generated DOM and takes every colour,
 * weight and typeface from `--mermaid-*` variables, so a theme is a palette
 * rather than a copy of the selector list.
 *
 * These tests are cross-file structural assertions, which is the only way to
 * state the contract: the block and each theme are separate files that have to
 * agree. Two failures are caught here that nothing else can catch —
 * a theme that omits a variable the block reads (a half-styled theme), and a
 * theme that has quietly re-grown its own copy of the selectors (the drift this
 * ticket exists to remove).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  MERMAID_VARIABLES,
  MERMAID_STYLESHEET_NAME,
  mermaidStylesheetSource,
  requiredVariableNames,
  optionalVariableNames,
  missingVariables,
  selectorList,
  canonicalSelector,
  redeclaredSelectors,
  stripComments,
} from '../src/core/mermaid-styles/mermaid-styles.js';
import { NORMALIZE_VARIABLE } from '../src/core/mermaid-bootstrap.js';
import { bundledThemes, readTheme } from './helpers/themes.js';

/** The block's own text. */
const block = () => mermaidStylesheetSource();

/**
 * Split comment-stripped CSS into rules: the selector list of each, and its
 * declaration body.
 *
 * `selectorList` answers "which selectors appear", which is not enough to say
 * *which* declaration sits under one. A rule that paints a shape and a rule
 * that inks a label can name the same element family, and telling them apart is
 * exactly what the sequence-diagram fixes depend on.
 *
 * At-rule preludes are dropped and their inner rules kept, as in
 * `selectorList`.
 *
 * @param {string} css
 * @returns {Array<{selectors: Array<string>, body: string}>}
 */
function rules(css) {
  const withoutComments = stripComments(css);
  const found = [];

  for (const match of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const prelude = match[1].trim();
    if (!prelude || prelude.startsWith('@')) continue;

    found.push({
      selectors: prelude.split(',').map((selector) => selector.trim()).filter(Boolean),
      body: match[2].trim(),
    });
  }

  return found;
}

/**
 * The body of the `@container style(<variable>)` block, brace-matched.
 *
 * A property asserted inside an opt-in container is inert for every theme that
 * does not define the variable, so the assertion has to say *where* the
 * declaration lives, not merely that the text appears somewhere in the file.
 *
 * @param {string} variable  e.g. `--mermaid-edge-label-bg`.
 * @returns {string}
 */
function containerBody(variable) {
  const source = stripComments(block());
  const prelude = '@container style(' + variable + ')';
  const start = source.indexOf(prelude);
  assert.notEqual(start, -1, `${variable} must gate a shared rule`);

  const open = source.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    else if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, index);
    }
  }

  assert.fail(`the ${variable} container is not closed`);
}

/**
 * Does this selector's rightmost thing depend on the element being a shape?
 *
 * Used to state the actor rule the way the render does: `rect.actor` is the
 * participant box, `text.actor` is its label, and a bare `.actor` is both.
 *
 * @param {string} selector
 * @returns {boolean}
 */
function namesShape(selector) {
  return /(^|[\s>+~])(rect|circle|ellipse|polygon|path|line)\.actor(?![-\w])/.test(selector);
}

// ---------------------------------------------------------------------------
// The block is a real file with an interface
// ---------------------------------------------------------------------------

test('the shared block is a real file whose contents the module reads', async () => {
  assert.equal(MERMAID_STYLESHEET_NAME, 'mermaid');

  const onDisk = (
    await readFile(new URL('../src/core/mermaid-styles/mermaid.css', import.meta.url), 'utf-8')
  ).trim();

  assert.ok(onDisk.length > 0, 'mermaid.css must not be empty');
  assert.equal(block(), onDisk, 'the block must be read from its file, not rebuilt in code');
});

test('the block targets Mermaid’s generated DOM', () => {
  const selectors = selectorList(block());

  assert.ok(selectors.length >= 5, 'the block must carry the selector list, not just tokens');
  for (const selector of selectors) {
    assert.match(
      selector,
      /^@?\.mermaid\b/,
      `every selector must be scoped to .mermaid, found: ${selector}`,
    );
  }
  // The roles the four theme blocks used to enumerate by hand.
  for (const role of ['.node', '.cluster', 'marker', '.actor', '.note', '.edgeLabel', 'foreignObject']) {
    assert.ok(
      selectors.some((selector) => selector.includes(role)),
      `the block must style ${role}`,
    );
  }
});

// ---------------------------------------------------------------------------
// Variables: the block reads them, the themes supply them
// ---------------------------------------------------------------------------

test('every variable the block requires is actually read by it', () => {
  const source = block();

  for (const name of requiredVariableNames()) {
    assert.ok(
      source.includes(`var(${name})`),
      `${name} is declared required but the block never reads it`,
    );
  }
  for (const name of optionalVariableNames()) {
    assert.ok(
      source.includes(`var(${name})`),
      `${name} is declared optional but the block never reads it`,
    );
  }
});

test('every bundled theme defines every required variable', async () => {
  const required = requiredVariableNames();
  assert.ok(required.length >= 4, 'the block must require a real palette');

  for (const theme of await bundledThemes()) {
    const missing = missingVariables(await readTheme(theme));
    assert.deepEqual(
      missing,
      [],
      `${theme} is missing ${missing.join(', ')}; a theme supplies a palette, not partial rules`,
    );
  }
});

test('a theme cannot ship half-styled: a missing variable is reported by name', () => {
  const complete = requiredVariableNames()
    .map((name) => `${name}: #123456;`)
    .join('\n');
  assert.deepEqual(missingVariables(`:root { ${complete} }`), []);

  const withoutInk = requiredVariableNames()
    .filter((name) => name !== '--mermaid-ink')
    .map((name) => `${name}: #123456;`)
    .join('\n');
  assert.deepEqual(missingVariables(`:root { ${withoutInk} }`), ['--mermaid-ink']);
});

test('a variable declared with no value counts as missing', () => {
  const all = requiredVariableNames()
    .map((name) => `${name}: #123456;`)
    .join('\n');

  assert.deepEqual(
    missingVariables(`:root { ${all} --mermaid-ink: ; }`),
    ['--mermaid-ink'],
  );
});

// ---------------------------------------------------------------------------
// No theme redeclares the block's selectors
// ---------------------------------------------------------------------------

test('no bundled theme redeclares a selector from the shared block', async () => {
  for (const theme of await bundledThemes()) {
    const redeclared = redeclaredSelectors(await readTheme(theme));
    assert.deepEqual(
      redeclared,
      [],
      `${theme} redeclares ${redeclared.join(', ')}; those belong to the shared block`,
    );
  }
});

test('a theme that re-grows a shared selector is reported by name', () => {
  const shared = selectorList(block())[0];

  assert.deepEqual(redeclaredSelectors(`${shared} { fill: red; }`), [shared]);
});

test('selector drift is caught even when the spacing or combinator form differs', () => {
  // The failure this closes: a theme restating a block rule as
  // `.mermaid svg .node .label>rect` used to compare unequal to the block's
  // `.mermaid svg .node .label > rect` and slip through as `[]`.
  const drifted = '.mermaid svg .node .label>rect { fill: red; }';
  assert.deepEqual(redeclaredSelectors(drifted), ['.mermaid svg .node .label > rect']);

  const padded = '.mermaid   svg  .edgeLabel    .background { fill: red; }';
  assert.deepEqual(redeclaredSelectors(padded), ['.mermaid svg .edgeLabel .background']);

  const inGroup = '.mermaid svg .label > rect, .mermaid svg .node rect { fill: red; }';
  assert.deepEqual(redeclaredSelectors(inGroup), ['.mermaid svg .node rect']);
});

test('canonicalSelector normalises spacing without changing what a selector targets', () => {
  assert.equal(canonicalSelector('.a  .b>c'), '.a .b > c');
  assert.equal(canonicalSelector('  .a .b > c  '), '.a .b > c');
  assert.equal(canonicalSelector('.a + .b ~ .c'), '.a + .b ~ .c');
});

test('the bundled themes no longer carry a Mermaid selector list of their own', async () => {
  for (const theme of await bundledThemes()) {
    const mermaidSelectors = selectorList(await readTheme(theme)).filter((selector) =>
      selector.includes('.mermaid'),
    );
    assert.deepEqual(
      mermaidSelectors,
      [],
      `${theme} still carries Mermaid selectors: ${mermaidSelectors.join(', ')}`,
    );
  }
});

// ---------------------------------------------------------------------------
// The opt-in that must not be flattened
// ---------------------------------------------------------------------------

test('the light default supplies the palette but keeps its normalisation opt-out', async () => {
  const light = await readTheme('style.css');

  assert.deepEqual(missingVariables(light), [], 'the light default is a theme too');
  assert.ok(
    !light.includes('--mermaid-normalize'),
    'the light default must stay opted out: Mermaid’s own colours are correct there',
  );
});

test('the four non-default themes keep their normalisation opt-in', async () => {
  for (const theme of (await bundledThemes()).filter((name) => name !== 'style.css')) {
    assert.ok(
      (await readTheme(theme)).includes('--mermaid-normalize: 1'),
      `${theme} must keep opting in to label normalisation`,
    );
  }
});

// ---------------------------------------------------------------------------
// Genuine divergence is expressed as variables, not duplicated rules
// ---------------------------------------------------------------------------

test('the OLED divergence is declared as optional variables, not extra selectors', () => {
  const source = block();

  // A theme that repaints Mermaid opts in through a style query, so its rules
  // are part of the shared block and inert for every other theme. This is the
  // whole mechanism: divergence costs a variable, never a selector copy.
  for (const name of [
    '--mermaid-shape-fill',
    '--mermaid-edge-label-bg',
    '--mermaid-shape-stroke',
    '--mermaid-line',
    '--mermaid-badge-ink',
  ]) {
    const escaped = name.replace(/-/g, '\\-');
    assert.match(
      source,
      new RegExp(`@container\\s+style\\(${escaped}\\)`),
      `${name} must gate a shared rule rather than be copied into a theme`,
    );
  }
});

test('every --mermaid-* variable read by the block or declared by a theme is in MERMAID_VARIABLES', async () => {
  const known = new Set(MERMAID_VARIABLES.map((variable) => variable.name));
  const blockCss = stripComments(block());

  for (const match of blockCss.matchAll(/(--mermaid-[\w-]+)/g)) {
    assert.ok(known.has(match[1]), `mermaid.css references ${match[1]}, which is missing from MERMAID_VARIABLES`);
  }

  for (const theme of await bundledThemes()) {
    const themeCss = await readTheme(theme, { stripComments: true });
    for (const match of themeCss.matchAll(/(--mermaid-[\w-]+)\s*:/g)) {
      if (match[1] === NORMALIZE_VARIABLE) continue;
      assert.ok(known.has(match[1]), `${theme} declares ${match[1]}, which is missing from MERMAID_VARIABLES`);
    }
  }
});

test('the shared block preserves polyline, .labelLine, and .edgeLabel foreignObject selectors', () => {
  const selectors = new Set(selectorList(block()).map(canonicalSelector));

  for (const expected of [
    '.mermaid svg polyline',
    '.mermaid svg .labelLine',
    '.mermaid svg .edgeLabel foreignObject',
  ]) {
    assert.ok(selectors.has(expected), `mermaid.css must retain ${expected} for theme visual parity`);
  }
});

// ---------------------------------------------------------------------------
// The sequence-diagram ink split (issue #17)
// ---------------------------------------------------------------------------

test('actor fill and stroke rules target actor shape geometry, never actor text', () => {
  // Mermaid writes `class="actor"` onto both the participant `<rect>` and the
  // `<text>` label beside it. A bare `.actor` therefore paints the label with
  // the shape's fill — the dark theme's near-white — and the label vanishes
  // into its own box. The rules at fault are the ones declaring the shape-paint
  // variables, not the ink rules, which name `text.actor` on purpose.
  const paintRules = rules(block()).filter((rule) =>
    /(fill|stroke)\s*:\s*var\(--mermaid-shape-(fill|stroke)\)/.test(rule.body),
  );
  assert.ok(paintRules.length > 0, 'the block must still paint actor shapes');

  const actorSelectors = paintRules
    .flatMap((rule) => rule.selectors)
    .filter((selector) => selector.includes('.actor'));

  assert.ok(actorSelectors.length > 0, 'actor geometry must still be painted');

  for (const selector of actorSelectors) {
    assert.ok(
      namesShape(selector),
      `${selector} paints every element classed .actor, including the label; name the shape`,
    );
    assert.ok(
      !/(^|[\s>+~])text\.actor(?![-a-z])/.test(selector),
      `${selector} targets the actor label; fill and stroke belong to the shape`,
    );
    assert.ok(
      !/(^|[\s>+~])g\.actor-man(?![-a-z])/.test(selector),
      `${selector} targets the actor-man group, whose children Mermaid strokes itself`,
    );
  }

  // No shape-paint rule may carry the bare class, whatever declaration it
  // sits under: `.actor` is the selector that matched rect and text alike.
  for (const rule of paintRules) {
    assert.ok(
      !rule.selectors.includes('.mermaid svg .actor'),
      'a bare .actor paints rect.actor and text.actor alike; scope it to the shape',
    );
  }

  // And the label must still have ink of its own, or the fix is a different
  // disappearance: Mermaid puts text.actor beside rect.actor as a sibling, so
  // no descendant form can reach it.
  const actorInk = rules(block()).find(
    (rule) =>
      rule.selectors.includes('.mermaid svg text.actor') &&
      /fill:\s*var\(--mermaid-ink-on-shape\)\s*!important/.test(rule.body),
  );
  assert.ok(
    actorInk,
    'text.actor is a sibling of rect.actor; it needs an on-shape ink rule of its own',
  );
  assert.match(actorInk.body, /color:\s*var\(--mermaid-ink-on-shape\)\s*!important/);
});

test('a sequence note’s text, including nested spans, takes the on-shape ink', () => {
  // Mermaid renders a note as `rect.note` plus a sibling `text.noteText`. The
  // canvas-ink rule matches `text:not(.sequenceNumber)` and, because `:not()`
  // contributes its argument's specificity, outscores a two-class one-type
  // selector — so `.noteText` alone loses despite coming later. The rule has to
  // state the element type, and state the nested span, or the inner text falls
  // back to the canvas ink.
  for (const expected of ['.mermaid svg text.noteText', '.mermaid svg text.noteText tspan']) {
    const noteRule = rules(block()).find((rule) => rule.selectors.includes(expected));

    assert.ok(noteRule, `${expected} must carry the on-shape ink for note text`);
    assert.match(
      noteRule.body,
      /fill:\s*var\(--mermaid-ink-on-shape\)\s*!important/,
      `${expected} sits on a filled note shape, so it needs the on-shape ink`,
    );
    assert.match(
      noteRule.body,
      /color:\s*var\(--mermaid-ink-on-shape\)\s*!important/,
      `the colour property on ${expected} must follow the same ink as fill`,
    );
  }

  // The canvas-ink list must not have quietly acquired .noteText back: an
  // unconditional `text` match plus a later weaker .noteText is the bug.
  const canvasInk = rules(block()).find((rule) =>
    /fill:\s*var\(--mermaid-ink\)\s*!important/.test(rule.body),
  );
  assert.ok(canvasInk, 'the canvas-ink rule must exist');
  assert.ok(
    !canvasInk.selectors.some((selector) => /\.noteText(?![-a-z])/.test(selector)),
    'note text sits on a shape and must not be in the canvas-ink list',
  );
});

test('the loop box label text takes the on-shape ink, and the loop condition does not', () => {
  // A loop draws a tab: `polygon.labelBox` filled with Mermaid's own light
  // colour, with the word `loop` in a *sibling* `text.labelText`. On a dark
  // page the canvas ink is near-white and the tab stays light, so the word
  // disappears. `.loopText` — the condition drawn on the loop rectangle's
  // transparent interior — must stay on the canvas ink, or it turns dark on a
  // black page.
  const onShapeLoop = rules(block()).find(
    (rule) =>
      rule.selectors.includes('.mermaid svg text.labelText') &&
      /fill:\s*var\(--mermaid-ink-on-shape\)\s*!important/.test(rule.body),
  );

  assert.ok(
    onShapeLoop,
    'text.labelText is a sibling of polygon.labelBox; it needs an on-shape ink rule naming the element',
  );
  assert.match(onShapeLoop.body, /color:\s*var\(--mermaid-ink-on-shape\)\s*!important/);
  assert.ok(
    onShapeLoop.selectors.includes('.mermaid svg text.labelText tspan'),
    'the spans inside the loop tab word need the same ink as their text element',
  );

  // The condition must not be dragged onto the shape ink.
  for (const rule of rules(block())) {
    if (!/fill:\s*var\(--mermaid-ink-on-shape\)/.test(rule.body)) continue;
    assert.ok(
      !rule.selectors.some((selector) => /\.loopText(?![-a-z])/.test(selector)),
      `${rule.selectors.join(', ')} puts the loop condition on the shape ink; it is drawn on bare canvas`,
    );
  }

  // And it must still be in the canvas-ink list.
  const canvasInk = rules(block()).find((rule) =>
    /fill:\s*var\(--mermaid-ink\)\s*!important/.test(rule.body),
  );
  assert.ok(canvasInk, 'the canvas-ink rule must exist');
  assert.ok(
    canvasInk.selectors.some((selector) => /\.loopText(?![-a-z])/.test(selector)),
    'the loop condition sits on the page surface and needs the canvas ink',
  );
});

// ---------------------------------------------------------------------------
// The edge-label plate (issue #17)
// ---------------------------------------------------------------------------

test('the edge-label plate rule declares opacity: 1 inside the edge-label-bg container', () => {
  // Mermaid emits `#mermaid-N .edgeLabel rect { opacity: 0.5 }` in its own
  // generated <style>. Filling that rect with the theme's plate colour leaves
  // the connector line visible through it, so the plate has to be forced fully
  // opaque — and only inside the opt-in, or the light default would lose
  // Mermaid's translucent chip.
  const body = containerBody('--mermaid-edge-label-bg');

  const plateRules = [...body.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((match) =>
    /\.edgeLabel/.test(match[1]),
  );
  assert.ok(plateRules.length > 0, 'the edge-label-bg container must style .edgeLabel');

  const opaque = plateRules.filter((match) => /opacity:\s*1\s*!important/.test(match[2]));
  assert.ok(
    opaque.length > 0,
    'the plate stays translucent without opacity: 1, and the connector line shows through the text',
  );

  // The plate is a rectangle painted with `fill`; an opacity left off it is the
  // exact bug, so every fill-bearing plate rule in the container must say so.
  for (const match of plateRules) {
    if (!/fill\s*:\s*var\(--mermaid-edge-label-bg\)/.test(match[2])) continue;
    assert.match(
      match[2],
      /opacity:\s*1\s*!important/,
      `${match[1].trim()} fills the plate but leaves Mermaid's 0.5 opacity in force`,
    );
  }
});

test('the edge-label plate opacity is scoped to the opt-in, not declared unconditionally', () => {
  // Assertion in the negative direction: the declaration must not exist
  // outside the container, or every theme — including the light default that
  // deliberately keeps Mermaid's chip — would be forced opaque.
  const outsideContainer = stripComments(block()).replace(containerBody('--mermaid-edge-label-bg'), '');

  assert.ok(
    !/\.edgeLabel[^{}]*\{[^{}]*opacity:\s*1/.test(outsideContainer),
    'opacity: 1 on an edge-label plate outside the opt-in overrides themes that did not ask for a plate',
  );
});

test('optional variables are not required of every theme', async () => {
  const optional = optionalVariableNames();
  assert.ok(optional.length > 0, 'OLED and the paint opt-ins need variables');

  // The light default deliberately leaves Mermaid's own paint alone, so it must
  // not set the paint opt-ins — setting them would repaint every diagram and
  // flatten the per-diagram-type fills.
  const light = await readTheme('style.css');
  for (const name of ['--mermaid-shape-stroke', '--mermaid-shape-fill', '--mermaid-line']) {
    assert.ok(optional.includes(name), `${name} must be optional`);
    assert.ok(!light.includes(`${name}:`), `the light default must keep Mermaid's own ${name}`);
  }
});

test('every required variable is declared with a purpose', () => {
  for (const variable of MERMAID_VARIABLES) {
    assert.match(variable.name, /^--mermaid-[\w-]+$/);
    assert.ok(variable.purpose.length > 10, `${variable.name} must say what it is for`);
    assert.equal(typeof variable.required, 'boolean');
  }
});
