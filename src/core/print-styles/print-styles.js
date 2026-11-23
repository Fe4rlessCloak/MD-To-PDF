/**
 * @file The print stylesheets, as files with an interface.
 *
 * Three stylesheets used to live as template literals inside HTML assembly:
 * the base print defaults, the Mermaid containment rules, and the math flow
 * rules. They are print fixtures rather than themes — a theme is a palette a
 * document opts into, whereas these are the rules every document needs for the
 * page to come out printable — so they live here, next to the bootstraps they
 * belong with, and not in `styles/`.
 *
 * Two seams:
 *
 * - {@link printStylesheetSource} reads one stylesheet from disk. This is the
 *   read adapter; tests use it to assert against the real file.
 * - {@link stylesheetPayload} returns the layers this module owns, in their
 *   order relative to each other. That order is an acceptance criterion of its
 *   own, so it is a value a test can inspect instead of the accidental order of
 *   three `push` calls.
 *
 * The returned order is not the document's emission order. Assembly inserts
 * its own layers around these: the shared Mermaid block after `base`, and the
 * `@page` geometry last, after every print layer. What this module guarantees
 * is the relative order of `base`, `user`, `mermaid-containment` and `math`.
 *
 * Assembly keeps no CSS text of its own after this: it inlines what this module
 * hands it and nothing else.
 */

import { readFileSync } from 'node:fs';

/**
 * The stylesheets, in the order they must be emitted relative to each other.
 *
 * `user` is not in this list: user CSS is inserted between `base` and
 * `mermaid-containment`, which is exactly what {@link stylesheetPayload}
 * does, and keeping it out of the list makes that insertion the only way it
 * can appear.
 *
 * @type {ReadonlyArray<string>}
 */
export const PRINT_STYLESHEET_NAMES = Object.freeze(['base', 'mermaid-containment', 'math']);

/**
 * Name of the first layer, the one assembly splices the Mermaid block after.
 * @type {string}
 */
export const BASE_STYLESHEET_NAME = PRINT_STYLESHEET_NAMES[0];

/** Name under which user-supplied CSS is emitted. @type {string} */
export const USER_STYLESHEET_NAME = 'user';

/** Directory the stylesheets are read from. */
const STYLESHEET_DIR = new URL('./', import.meta.url);

/** Cached file text, keyed by name; each file is read once per process. */
const cache = new Map();

/**
 * Resolve a stylesheet name to the file that backs it, refusing anything else.
 *
 * The name is checked against {@link PRINT_STYLESHEET_NAMES} rather than
 * interpolated straight into a path, so a caller cannot reach outside this
 * directory.
 *
 * @param {string} name
 * @returns {URL}
 * @throws {Error} When the name is not one of the known stylesheets.
 */
function fileFor(name) {
  if (!PRINT_STYLESHEET_NAMES.includes(name)) {
    throw new Error(
      `Unknown print stylesheet: ${String(name)}. Known: ${PRINT_STYLESHEET_NAMES.join(', ')}.`,
    );
  }
  return new URL(`${name}.css`, STYLESHEET_DIR);
}

/**
 * Read one print stylesheet from disk.
 *
 * Returned trimmed of the blank lines a file picker leaves at either end; the
 * comments at the top of each file are part of it and are kept, because they
 * are where the ordering rules are written down.
 *
 * @param {string} name  One of {@link PRINT_STYLESHEET_NAMES}.
 * @returns {string} The stylesheet's CSS text.
 * @throws {Error} When the name is unknown or the file cannot be read.
 */
export function printStylesheetSource(name) {
  if (!cache.has(name)) {
    cache.set(name, readFileSync(fileFor(name), 'utf8').trim());
  }
  return cache.get(name);
}

/**
 * The stylesheets assembly must inline, in emission order.
 *
 * User CSS lands after `base` and before `mermaid-containment` and `math`. The
 * order is load-bearing rather than conventional: base rules are defaults that
 * a theme is meant to win against, while the containment and math rules are
 * print guarantees that nothing — including user CSS — may override. Emitting
 * user CSS last would silently hand a theme the ability to overflow the page.
 *
 * @param {Object} params
 * @param {string|null|undefined} params.userCss  User CSS text, if any.
 * @returns {Array<{name: string, css: string}>} Fresh array, one entry per layer.
 */
export function stylesheetPayload({ userCss } = {}) {
  const layers = [];

  for (const name of PRINT_STYLESHEET_NAMES) {
    layers.push({ name, css: printStylesheetSource(name) });

    // User CSS goes between the defaults and the rules that must outrank it.
    if (name === 'base' && userCss) {
      layers.push({ name: USER_STYLESHEET_NAME, css: String(userCss).trim() });
    }
  }

  return layers;
}
