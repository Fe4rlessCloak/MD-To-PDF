/**
 * @file Documentation guard.
 *
 * The README is the first thing a reader trusts, and it had drifted twice: it
 * cited a function that no longer existed, and it carried line-number anchors
 * into files that had since moved. Ticket #9 existed to prevent exactly that,
 * so the fix has to be structural rather than another round of hand-correction.
 *
 * This test enforces the method: cite a path and a symbol, never a line number.
 * It also checks that every relative link in the README resolves, and that the
 * file overview names every module that exists. It cannot tell whether the prose
 * is *true* — nothing can — but it keeps the mechanical half from rotting.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';

const repoRoot = new URL('../', import.meta.url);
const readme = () => readFile(new URL('README.md', repoRoot), 'utf8');

test('the README cites symbols, never line numbers', async () => {
  const text = await readme();

  // `path.js:42` inside a link, and a bare `path.js:42` in prose, are both
  // anchors. A line number is wrong the moment anything above it is edited, so
  // the project cites the file and the symbol instead.
  const anchoredLinks = [...text.matchAll(/\]\(([^)\s]+):\d+\)/g)].map((m) => m[1]);
  assert.deepEqual(anchoredLinks, [], `these references still carry line anchors: ${anchoredLinks.join(', ')}`);

  const anchoredProse = [...text.matchAll(/[\w./-]+\.(?:js|css|md|json):\d+\b/g)].map((m) => m[0]);
  assert.deepEqual(anchoredProse, [], `these prose references still carry line anchors: ${anchoredProse.join(', ')}`);
});

test('every relative link in the README resolves to a real file', async () => {
  const text = await readme();

  const targets = [...text.matchAll(/\]\((?!https?:|#)([^)\s]+)\)/g)]
    .map((m) => m[1].split('#')[0])
    .filter(Boolean);

  assert.ok(targets.length > 0, 'the README must link into the repo');

  const missing = [];
  for (const target of new Set(targets)) {
    try {
      await stat(new URL(target, repoRoot));
    } catch {
      missing.push(target);
    }
  }
  assert.deepEqual(missing, [], `the README links to files that do not exist: ${missing.join(', ')}`);
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
