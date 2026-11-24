/**
 * @file Documentation guard: root agent instructions.
 *
 * `AGENTS.md` is loaded into every agent's context before it touches the code,
 * so a stale line anchor or a link into a file that has since moved does not
 * just mislead one reader — it misleads every agent that starts work here, and
 * it does so with the authority of an instruction. The README guard in
 * `readme.test.js` exists for the same reason, and both run the checks in
 * `helpers/documentation.js` so a fix to one cannot leave the other wrong.
 *
 * This test enforces the mechanical half only: cite a path and a symbol never a
 * line number, keep every relative link and heading fragment resolving, point at
 * the README and the glossary instead of restating them, and keep machine-
 * specific absolute paths out of a document that ships to every host.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  brokenTargets,
  hostPaths,
  lineAnchors,
  localTargets,
} from './helpers/documentation.js';

const repoRoot = new URL('../', import.meta.url);
const agents = () => readFile(new URL('AGENTS.md', repoRoot), 'utf8');
const read = (url) => readFile(url, 'utf8');

test('the agent instructions cite symbols, never line numbers', async () => {
  const { linked, prose } = lineAnchors(await agents());

  assert.deepEqual(linked, [], `these references still carry line anchors: ${linked.join(', ')}`);
  assert.deepEqual(prose, [], `these prose references still carry line anchors: ${prose.join(', ')}`);
});

test('every relative link and heading fragment in the agent instructions resolves', async () => {
  // A `README.md#manual-render-check` link survives a path-only check while the
  // heading it points at is renamed, which is exactly the rot that matters: the
  // file still exists, the section does not.
  const text = await agents();
  const targets = localTargets(text);
  assert.ok(targets.length > 0, 'the agent instructions must link into the repo rather than restate it');

  const { missingFiles, missingFragments } = await brokenTargets(targets, repoRoot, read);

  assert.deepEqual(missingFiles, [], `the agent instructions link to files that do not exist: ${missingFiles.join(', ')}`);
  assert.deepEqual(
    missingFragments,
    [],
    `these links name headings that do not exist: ${missingFragments.join(', ')}`,
  );
});

test('the agent instructions point at the README and the glossary', async () => {
  // The section is a pointer, not a copy: the module inventory belongs to the
  // README and the vocabulary to the glossary, and a second copy of either drifts.
  const targets = localTargets(await agents());

  for (const source of ['README.md', 'GLOSSARY.md']) {
    assert.ok(
      targets.some((target) => target.split('#')[0] === source),
      `the agent instructions must link to ${source} instead of restating it`,
    );
  }
});

test('the agent instructions carry no host-specific absolute paths', async () => {
  // A workflow tied to one machine is not a workflow. Rendered PDFs go to a
  // scratch path, browser fixes stay in the environment, and the committed
  // document names neither.
  const absolute = hostPaths(await agents());

  assert.deepEqual(absolute, [], `these paths belong to one machine, not the repo: ${absolute.join(', ')}`);
});
