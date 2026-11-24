/**
 * @file Documentation guard.
 *
 * The README is the first thing a reader trusts, and it had drifted twice: it
 * cited a function that no longer existed, and it carried line-number anchors
 * into files that had since moved. Ticket #9 existed to prevent exactly that,
 * so the fix has to be structural rather than another round of hand-correction.
 *
 * This test enforces the method: cite a path and a symbol, never a line number.
 * It also checks that every relative link and heading fragment in the README
 * resolves, and that the file overview names every module that exists. It
 * cannot tell whether the prose is *true* — nothing can — but it keeps the
 * mechanical half from rotting.
 *
 * The checks live in `helpers/documentation.js` because the agent instructions
 * need exactly the same ones, and two copies of a guard drift apart.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  brokenTargets,
  lineAnchors,
  localTargets,
} from './helpers/documentation.js';

const repoRoot = new URL('../', import.meta.url);
const readme = () => readFile(new URL('README.md', repoRoot), 'utf8');

test('the README cites symbols, never line numbers', async () => {
  // `path.js:42` inside a link, and a bare `path.js:42` in prose, are both
  // anchors. A line number is wrong the moment anything above it is edited, so
  // the project cites the file and the symbol instead.
  const { linked, prose } = lineAnchors(await readme());

  assert.deepEqual(linked, [], `these references still carry line anchors: ${linked.join(', ')}`);
  assert.deepEqual(prose, [], `these prose references still carry line anchors: ${prose.join(', ')}`);
});

test('every relative link and heading fragment in the README resolves', async () => {
  // A `README.md#testing` link survives a path-only check after that heading is
  // renamed. The file still exists, the section does not, and the reader lands
  // at the top of the document wondering what happened.
  const targets = localTargets(await readme());
  assert.ok(targets.length > 0, 'the README must link into the repo');

  const { missingFiles, missingFragments } = await brokenTargets(targets, repoRoot);

  assert.deepEqual(missingFiles, [], `the README links to files that do not exist: ${missingFiles.join(', ')}`);
  assert.deepEqual(
    missingFragments,
    [],
    `these links name headings that do not exist: ${missingFragments.join(', ')}`,
  );
});

test('the file overview names every module that exists', async () => {
  // The README's job is to say what the tree contains. A module that ships
  // without a mention is a module a reader will not find.
  const text = await readme();

  const modules = [
    'convert.js',
    'src/cli/parse-args.js',
    'src/core/document-options.js',
    'src/core/load-input.js',
    'src/core/render-markdown.js',
    'src/core/readiness-protocol.js',
    'src/core/mermaid-bootstrap.js',
    'src/core/katex-bootstrap.js',
    'src/core/css-declarations.js',
    'src/core/page-geometry.js',
    'src/core/build-html.js',
    'src/core/render-pdf.js',
    'src/core/write-output.js',
    'src/core/errors.js',
    'src/core/print-styles/print-styles.js',
    'src/core/mermaid-styles/mermaid-styles.js',
    'GLOSSARY.md',
  ];

  const absent = modules.filter((module) => !text.includes(module));
  assert.deepEqual(absent, [], `the README never mentions: ${absent.join(', ')}`);
});

test('the README does not name symbols that no longer exist', async () => {
  const text = await readme();

  // Each of these was cited by an earlier revision and is gone. The list is a
  // regression guard, not an exhaustive audit: a new stale name needs a new
  // entry, and the line-anchor test above is what keeps the rest honest.
  for (const gone of ['waitForFlag', 'KATEX_CSS', 'KATEX_BOOTSTRAP', 'preprocessMath']) {
    assert.ok(!text.includes(gone), `the README still cites ${gone}, which does not exist`);
  }
});
