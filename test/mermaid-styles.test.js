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
