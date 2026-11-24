/**
 * @file Documentation guard: root agent instructions.
 *
 * `AGENTS.md` is loaded into every agent's context before it touches the code,
 * so a stale line anchor or a link into a file that has since moved does not
 * just mislead one reader — it misleads every agent that starts work here, and
 * it does so with the authority of an instruction. The README guard in
 * `readme.test.js` had to be written for the same reason.
 *
 * This test enforces the mechanical half only: cite a path and a symbol never a
 * line number, keep every relative link and heading fragment resolving, point at
 * the README and the glossary instead of restating them, and keep machine-
 * specific absolute paths out of a document that ships to every host.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';

const repoRoot = new URL('../', import.meta.url);
const agents = () => readFile(new URL('AGENTS.md', repoRoot), 'utf8');

/** Every markdown link target in `text` that points inside the repo. */
const localTargets = (text) =>
  [...text.matchAll(/\]\((?!https?:)([^)\s]+)\)/g)].map((m) => m[1]);

/**
 * GitHub's heading slug, near enough: lower-case, drop punctuation, spaces to
 * hyphens. A fragment that survives this is one a reader's browser will find.
 */
const slug = (heading) =>
  heading
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-');

/** The heading slugs of a markdown file, ignoring fenced code blocks. */
const headingSlugs = (markdown) => {
  const slugs = new Set();
  let fenced = false;
  for (const line of markdown.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    const heading = !fenced && /^#{1,6}\s+(.+?)\s*$/.exec(line);
    if (heading) slugs.add(slug(heading[1]));
  }
  return slugs;
};

test('the agent instructions cite symbols, never line numbers', async () => {
  const text = await agents();

  // `path.js:42` inside a link, and a bare `path.js:42` in prose, are both
  // anchors: the number is wrong the moment anything above it is edited, and an
  // agent reading it will look in the wrong place with full confidence.
  const anchoredLinks = [...text.matchAll(/\]\(([^)\s]+):\d+\)/g)].map((m) => m[1]);
  assert.deepEqual(anchoredLinks, [], `these references still carry line anchors: ${anchoredLinks.join(', ')}`);

  const anchoredProse = [...text.matchAll(/[\w./-]+\.(?:js|css|md|json):\d+\b/g)].map((m) => m[0]);
  assert.deepEqual(anchoredProse, [], `these prose references still carry line anchors: ${anchoredProse.join(', ')}`);
});

test('every relative link in the agent instructions resolves to a real file', async () => {
  const text = await agents();

  const targets = localTargets(text).map((target) => target.split('#')[0]).filter(Boolean);
  assert.ok(targets.length > 0, 'the agent instructions must link into the repo rather than restate it');

  const missing = [];
  for (const target of new Set(targets)) {
    try {
      await stat(new URL(target, repoRoot));
    } catch {
      missing.push(target);
    }
  }
  assert.deepEqual(missing, [], `the agent instructions link to files that do not exist: ${missing.join(', ')}`);
});

test('every heading fragment in the agent instructions names a real heading', async () => {
  // A `README.md#manual-render-check` link survives the test above while the
  // heading it points at is renamed, which is exactly the rot that matters:
  // the file still exists, the section does not.
  const text = await agents();

  const broken = [];
  for (const target of new Set(localTargets(text))) {
    const [path, fragment] = target.split('#');
    if (!fragment) continue;
    assert.ok(path.endsWith('.md'), `only markdown links can carry a heading fragment: ${target}`);

    const markdown = await readFile(new URL(path, repoRoot), 'utf8');
    if (!headingSlugs(markdown).has(fragment)) broken.push(target);
  }
  assert.deepEqual(broken, [], `these fragments name headings that do not exist: ${broken.join(', ')}`);
});

test('the agent instructions point at the README and the glossary', async () => {
  // The section is a pointer, not a copy: the module inventory belongs to the
  // README and the vocabulary to the glossary, and a second copy of either drifts.
  const text = await agents();
  const targets = localTargets(text);

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
  const text = await agents();

  const absolute = [
    ...text.matchAll(/(?:^|[\s"'(=])(\/(?:home|srv|Users|usr\/local|opt)\/[\w./-]*|[A-Za-z]:\\\\[\w.\\-]+)/g),
  ].map((m) => m[1]);

  assert.deepEqual(absolute, [], `these paths belong to one machine, not the repo: ${absolute.join(', ')}`);
});
