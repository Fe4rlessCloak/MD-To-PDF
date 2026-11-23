/**
 * @file Tests for the readiness protocol module: the single source of truth
 * for the browser-side flag names the injected program publishes and the PDF
 * renderer reads.
 *
 * The guard that matters here is the divergence test: the flag names a
 * consumer references are read out of the consumer's own source, so renaming
 * a flag on one side only breaks this suite instead of every PDF.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

import { READINESS_FLAGS, readinessFlagsSource } from '../src/core/readiness-protocol.js';

const CORE = new URL('../src/core/', import.meta.url);
const sourceOf = (file) => readFile(new URL(file, CORE), 'utf8');

// Independent source of truth: the six names the pipeline has always used,
// as recorded by the ticket. If the module drifts from this, that is a bug.
const EXPECTED_NAMES = {
  mermaidReady: '__MERMAID_READY__',
  mermaidErrors: '__MERMAID_ERRORS__',
  mermaidDebug: '__MERMAID_DEBUG__',
  mermaidRenderDone: '__MERMAID_RENDER_DONE__',
  mathErrors: '__MATH_ERRORS__',
  mathRenderDone: '__MATH_RENDER_DONE__',
};

/** Keys a consumer file references through its protocol handle. */
function referencedKeys(source, handle) {
  const pattern = new RegExp(`\\b${handle}\\.([A-Za-z_]\\w*)`, 'g');
  return [...new Set([...source.matchAll(pattern)].map((m) => m[1]))].sort();
}

/** Raw readiness globals written as literals in a consumer file. */
function hardcodedGlobals(source) {
  return [...new Set(source.match(/__[A-Z][A-Z0-9_]*__/g) ?? [])];
}

test('defines exactly the flag names the pipeline publishes', () => {
  assert.deepEqual({ ...READINESS_FLAGS }, EXPECTED_NAMES);
});

test('flag names are unique and shaped like browser globals', () => {
  const names = Object.values(READINESS_FLAGS);
  assert.equal(new Set(names).size, names.length);
  for (const name of names) {
    assert.match(name, /^__[A-Z][A-Z0-9_]*__$/);
  }
});

test('the protocol is frozen so a consumer cannot rename a flag at runtime', () => {
  assert.ok(Object.isFrozen(READINESS_FLAGS));
});

test('readinessFlagsSource exposes the whole protocol to the injected program', () => {
  const source = readinessFlagsSource();

  assert.equal(typeof source, 'string');
  assert.ok(!source.includes('</script'), 'source must be safe to inline in a <script>');

  const handle = vm.runInNewContext(`${source}\nRF;`);
  assert.deepEqual({ ...handle }, EXPECTED_NAMES);
});

test('the injected program references flags only through the protocol', async () => {
  const source = await sourceOf('build-html.js');
  const keys = referencedKeys(source, 'RF');

  assert.deepEqual(hardcodedGlobals(source), [], 'build-html.js must not hardcode readiness globals');
  assert.deepEqual(keys, Object.keys(EXPECTED_NAMES).sort());
});

test('the renderer references flags only through the protocol', async () => {
  const source = await sourceOf('render-pdf.js');
  const keys = referencedKeys(source, 'READINESS_FLAGS');

  assert.deepEqual(hardcodedGlobals(source), [], 'render-pdf.js must not hardcode readiness globals');
  assert.ok(keys.length > 0, 'renderer must read flags through the protocol');

  for (const key of keys) {
    assert.ok(key in READINESS_FLAGS, `renderer references unknown flag "${key}"`);
  }
});

test('every flag the renderer reads is published by the injected program', async () => {
  const published = new Set(referencedKeys(await sourceOf('build-html.js'), 'RF'));
  const polled = referencedKeys(await sourceOf('render-pdf.js'), 'READINESS_FLAGS');

  const orphans = polled.filter((key) => !published.has(key));
  assert.deepEqual(orphans, [], `renderer polls flags nothing publishes: ${orphans.join(', ')}`);
});
