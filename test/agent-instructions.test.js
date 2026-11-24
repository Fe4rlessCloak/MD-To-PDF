/**
 * @file Documentation guard: root agent instructions and visual verification guide.
 *
 * `AGENTS.md` is loaded into every agent's context before it touches the code,
 * and `docs/agents/visual-verification.md` holds the visual-verification
 * procedure it delegates to, so a stale line anchor or a link into a file that
 * has since moved does not just mislead one reader — it misleads every agent
 * that starts work here, and it does so with the authority of an instruction.
 * The README guard in `readme.test.js` exists for the same reason, and both run
 * the checks in `helpers/documentation.js` so a fix to one cannot leave the
 * other wrong.
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
const workflowDocs = ['AGENTS.md', 'docs/agents/visual-verification.md'];
const readDoc = (relPath) => readFile(new URL(relPath, repoRoot), 'utf8');

test('the agent instructions cite symbols, never line numbers', async () => {
  for (const doc of workflowDocs) {
    const { linked, prose } = lineAnchors(await readDoc(doc));

    assert.deepEqual(linked, [], `${doc}: these references still carry line anchors: ${linked.join(', ')}`);
    assert.deepEqual(prose, [], `${doc}: these prose references still carry line anchors: ${prose.join(', ')}`);
  }
});

test('every relative link and heading fragment in the agent instructions resolves', async () => {
  // A `README.md#manual-render-check` link survives a path-only check while the
  // heading it points at is renamed, which is exactly the rot that matters: the
  // file still exists, the section does not.
  for (const doc of workflowDocs) {
    const docUrl = new URL(doc, repoRoot);
    const targets = localTargets(await readDoc(doc));
    assert.ok(targets.length > 0, `${doc}: must link into the repo rather than restate it`);

    const { missingFiles, missingFragments } = await brokenTargets(targets, docUrl);

    assert.deepEqual(missingFiles, [], `${doc}: links to files that do not exist: ${missingFiles.join(', ')}`);
    assert.deepEqual(
      missingFragments,
      [],
      `${doc}: these links name headings that do not exist: ${missingFragments.join(', ')}`,
    );
  }
});

test('the agent instructions point at the README and the glossary', async () => {
  // The section is a pointer, not a copy: the module inventory belongs to the
  // README and the vocabulary to the glossary, and a second copy of either drifts.
  const targets = localTargets(await readDoc('AGENTS.md'));

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
  for (const doc of workflowDocs) {
    const absolute = hostPaths(await readDoc(doc));

    assert.deepEqual(absolute, [], `${doc}: these paths belong to one machine, not the repo: ${absolute.join(', ')}`);
  }
});

test('hostPaths catches backticked inline-code host paths while allowing system browser paths', () => {
  const sample = [
    'Use `/usr/local/bin/chromium` when set.',
    'Do not commit `/home/user/scratch/chrome`, `/Users/me/bin/chrome`, or `C:\\Users\\me\\chrome.exe`.',
  ].join('\n');

  assert.deepEqual(
    hostPaths(sample),
    ['/home/user/scratch/chrome', '/Users/me/bin/chrome', 'C:\\Users\\me\\chrome.exe'],
  );
});
