/**
 * @file The checks the documentation guard runs, over any markdown file.
 *
 * Two documents get guarded — `README.md` and `AGENTS.md` — and they need the
 * same mechanical checks: no line-number anchors, every relative link resolves,
 * every heading fragment names a real heading. Those checks were written twice,
 * character for character, which meant a fix to one would have left the other
 * wrong. They live here once and both guards call them.
 *
 * **What this cannot do.** None of it reads prose for truth. A guard can prove
 * that `README.md#manual-render-check` points at a heading that exists; it
 * cannot prove the paragraph under that heading is still accurate. That half
 * stays a human problem, and the point of automating this half is to keep a
 * human from spending their attention on it.
 */

import { readFile, stat } from 'node:fs/promises';

/** File extensions a line-number anchor can appear after. */
const ANCHORED_FILE = /[\w./-]+\.(?:js|css|md|json|ya?ml):\d+\b/g;

/**
 * Line-number anchors in a markdown document.
 *
 * Two spellings count: `[label](path.js:42)`, where the number is inside the
 * link target, and a bare `path.js:42` in prose. Both go stale the moment
 * anything above the cited line is edited, and both mislead a reader with full
 * confidence, so the project cites the path and the symbol instead.
 *
 * @param {string} text  Markdown source.
 * @returns {{linked: Array<string>, prose: Array<string>}} Anchors found, by spelling.
 */
export function lineAnchors(text) {
  const linked = [...text.matchAll(/\]\(([^)\s]+):\d+\)/g)].map((match) => match[1]);
  const prose = [...text.matchAll(ANCHORED_FILE)].map((match) => match[0]);

  return { linked, prose };
}

/**
 * Every markdown link target that points inside the repository.
 *
 * Absolute URLs and bare `#fragment` links are excluded: the first is not the
 * repo's to keep alive, and the second is handled by the caller against the
 * document's own headings.
 *
 * @param {string} text  Markdown source.
 * @returns {Array<string>} Targets, with any `#fragment` intact.
 */
export function localTargets(text) {
  return [...text.matchAll(/\]\((?!https?:|#)([^)\s]+)\)/g)].map((match) => match[1]);
}

/**
 * GitHub's heading slug, near enough: lower-case, punctuation dropped, spaces
 * to hyphens, and a `-1` suffix on a repeated heading.
 *
 * A fragment that survives this is one a reader's browser will actually find.
 *
 * @param {string} heading  Heading text, without the leading `#`s.
 * @param {number} [repeats=0]  How many earlier headings produced the same slug.
 * @returns {string}
 */
export function slug(heading, repeats = 0) {
  const base = heading
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-');

  return repeats === 0 ? base : `${base}-${repeats}`;
}

/**
 * The heading slugs of a markdown document, ignoring fenced code blocks.
 *
 * Fenced blocks are skipped because a bash comment starting with `#` is not a
 * heading, and a document that documents shell commands will contain several.
 * Repeated headings get GitHub's `-1`, `-2` suffixes, so a fragment pointing at
 * the second occurrence resolves rather than looking broken.
 *
 * @param {string} markdown
 * @returns {Set<string>}
 */
export function headingSlugs(markdown) {
  const slugs = new Set();
  const seen = new Map();
  let fenced = false;

  for (const line of markdown.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }

    const heading = !fenced && /^#{1,6}\s+(.+?)\s*$/.exec(line);
    if (!heading) continue;

    const base = slug(heading[1]);
    const repeats = seen.get(base) ?? 0;
    seen.set(base, repeats + 1);
    slugs.add(slug(heading[1], repeats));
  }

  return slugs;
}

/**
 * Targets that do not resolve to anything in the repository.
 *
 * A link whose file moved is dead; a link whose file still exists but whose
 * `#fragment` names no heading is dead in the same way, and harder to notice,
 * because the path check alone passes. Both are reported here.
 *
 * @param {Array<string>} targets  From {@link localTargets}.
 * @param {URL} base  Document or directory URL that relative targets resolve against.
 * @param {Function} [read]  Optional async reader, `(URL) => Promise<string>`.
 * @returns {Promise<{missingFiles: Array<string>, missingFragments: Array<string>}>}
 */
export async function brokenTargets(targets, base, read = (url) => readFile(url, 'utf8')) {
  const missingFiles = [];
  const missingFragments = [];

  for (const target of new Set(targets)) {
    const [path, fragment] = target.split('#');

    try {
      await stat(new URL(path, base));
    } catch {
      missingFiles.push(target);
      continue;
    }

    if (!fragment) continue;
    if (!path.endsWith('.md')) {
      missingFragments.push(target);
      continue;
    }

    const markdown = await read(new URL(path, base));
    if (!headingSlugs(markdown).has(fragment)) missingFragments.push(target);
  }

  return { missingFiles, missingFragments };
}

/**
 * Absolute paths that belong to one machine rather than to the repository.
 *
 * A document that names `/home/someone/...` is a document that only works on
 * that host, which is the failure mode a committed workflow exists to avoid.
 * Windows drive paths are included because the same mistake is made there.
 *
 * `/usr/local` and `/opt` are deliberately absent: a browser installed at
 * `/usr/local/bin/chromium` is a legitimate thing for a document about
 * `PUPPETEER_EXECUTABLE_PATH` to mention. What a guard can usefully forbid is
 * a *user's* home or a site directory, which is never anyone else's.
 *
 * @param {string} text  Markdown source.
 * @returns {Array<string>} The offending paths.
 */
export function hostPaths(text) {
  const pattern = /(?:^|[\s"'(=`])(\/(?:home|srv|Users)\/[\w./-]*|[A-Za-z]:\\[\w.\\-]+)/g;
  return [...text.matchAll(pattern)].map((match) => match[1]);
}
