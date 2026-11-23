/**
 * @file Tests for the print stylesheets.
 *
 * These stylesheets used to be template literals inside HTML assembly, so the
 * only assertion anyone could make was that a generated document contained a
 * familiar selector. Now they are files with an interface: each one can be
 * read on its own, and the emission order is a returned value rather than an
 * accident of the order three `push` calls happen to be written in.
 *
 * The ordering test is the important one. User CSS must land after the base
 * stylesheet and before the Mermaid-containment and math stylesheets, because
 * the containment rules are deliberately un-overridable by user CSS.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';

import {
  PRINT_STYLESHEET_NAMES,
  printStylesheetSource,
  stylesheetPayload,
} from '../src/core/print-styles/print-styles.js';

const fileOf = (name) => new URL(`../src/core/print-styles/${name}.css`, import.meta.url);

// ---------------------------------------------------------------------------
// The files
// ---------------------------------------------------------------------------

test('every print stylesheet is a real file whose contents the module reads', async () => {
  assert.deepEqual(PRINT_STYLESHEET_NAMES, ['base', 'mermaid-containment', 'math']);

  for (const name of PRINT_STYLESHEET_NAMES) {
    const onDisk = (await readFile(fileOf(name), 'utf8')).trim();
    assert.ok(onDisk.length > 0, `${name}.css must not be empty`);
    assert.equal(
      printStylesheetSource(name),
      onDisk,
      `${name} must be read from its file, not reconstructed in code`,
    );
  }
});

test('the base stylesheet keeps the print defaults user CSS is meant to override', () => {
  // Comments in the sheet explain that the page rule lives elsewhere; strip
  // them so the assertion is about declarations, not prose.
  const base = printStylesheetSource('base').replace(/\/\*[\s\S]*?\*\//g, '');

  assert.match(base, /box-sizing: border-box/);
  assert.match(base, /font-family: Georgia/);
  assert.match(base, /font-size: 11pt/);
  assert.match(base, /line-height: 1\.6/);
  // Page geometry is a separate concern with its own owner: the base sheet must
  // not declare a page rule, or a document would carry two of them and the
  // theme's margin could lose to a fallback.
  assert.ok(!base.includes('@page'), 'the base sheet must not declare a page rule');
});

test('the containment stylesheet keeps its un-overridable scaling rules', () => {
  const containment = printStylesheetSource('mermaid-containment');

  assert.match(containment, /^\.mermaid \{/m);
  assert.match(containment, /max-height: 45vh/);
  assert.match(containment, /break-inside: avoid/);
  assert.match(containment, /\.mermaid svg \{/);
  // `!important` is the mechanism that makes these rules beat user CSS, so
  // losing one here would silently change the layout contract.
  assert.deepEqual(
    containment
      .split('\n')
      .filter((line) => line.includes('!important'))
      .map((line) => line.trim()),
    [
      'max-width: 100% !important;',
      'max-height: 45vh !important;',
      'width: auto !important;',
      'height: auto !important;',
      'margin: 0 auto !important;',
    ],
  );
});

test('the math stylesheet keeps display blocks out of page breaks', () => {
  const math = printStylesheetSource('math');

  assert.match(math, /^\.math-display \{/m);
  assert.match(math, /break-inside: avoid/);
  assert.match(math, /^\.math-inline \{/m);
  assert.match(math, /white-space: nowrap/);
});

test('an unknown stylesheet name fails loudly instead of returning nothing', () => {
  assert.throws(() => printStylesheetSource('no-such-stylesheet'), /unknown print stylesheet/i);
});

// ---------------------------------------------------------------------------
// The emission order — the acceptance criterion
// ---------------------------------------------------------------------------

test('user CSS is emitted after base and before containment and math', () => {
  const layers = stylesheetPayload({ userCss: '.custom { color: red; }' });

  assert.deepEqual(
    layers.map((layer) => layer.name),
    ['base', 'user', 'mermaid-containment', 'math'],
  );
  assert.equal(layers[1].css, '.custom { color: red; }');
  assert.equal(layers[0].css, printStylesheetSource('base'));
  assert.equal(layers[3].css, printStylesheetSource('math'));
});

test('without user CSS the base stylesheet still precedes the containment rules', () => {
  for (const userCss of [null, undefined, '']) {
    assert.deepEqual(
      stylesheetPayload({ userCss }).map((layer) => layer.name),
      ['base', 'mermaid-containment', 'math'],
    );
  }
});

test('the payload is a fresh array, so a caller cannot reorder the shared order', () => {
  const first = stylesheetPayload({ userCss: null });
  first.reverse();

  assert.deepEqual(
    stylesheetPayload({ userCss: null }).map((layer) => layer.name),
    ['base', 'mermaid-containment', 'math'],
  );
});

// ---------------------------------------------------------------------------
// The move itself: assembly keeps no CSS of its own
// ---------------------------------------------------------------------------

test('HTML assembly holds no stylesheet text of its own', async () => {
  const assembly = readFileSync(
    new URL('../src/core/build-html.js', import.meta.url),
    'utf8',
  );

  for (const marker of [
    'font-family: Georgia',
    'max-height: 45vh',
    'break-inside: avoid',
    'box-sizing: border-box',
  ]) {
    assert.ok(
      !assembly.includes(marker),
      `assembly must not carry stylesheet content any more (found: ${marker})`,
    );
  }
});
