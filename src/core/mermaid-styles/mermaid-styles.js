/**
 * @file The Mermaid styling module: one shared block, parameterised per theme.
 *
 * A theme supplies a palette; this module supplies every selector that targets
 * Mermaid's generated DOM. Four themes used to carry near-identical copies of
 * that selector list and the fifth had drifted into its own dialect with more
 * than double the selectors and `!important` declarations. The list now lives
 * here once.
 *
 * Two seams:
 *
 * - {@link mermaidStylesheetSource} reads the block from disk. This is the read
 *   adapter; HTML assembly inlines it, and tests assert against the real file.
 * - {@link MERMAID_VARIABLES} is the interface a theme must satisfy: the names
 *   the block reads, each with the purpose it serves. {@link missingVariables}
 *   and {@link redeclaredSelectors} turn that interface into the checks that
 *   make a half-styled theme or a re-grown selector list fail the suite.
 *
 * **How divergence is expressed.** A theme that paints shape fills — the dark
 * theme does, because Mermaid's default light node fill is invisible on black —
 * does not get its own rules. It defines `--mermaid-shape-fill`, and the shared
 * block gates the fill override behind `@container style(--mermaid-shape-fill)`.
 * A style query fails closed: when the variable is absent the container does
 * not match, the rule is inert, and Mermaid's own per-diagram-type fills
 * survive. So the divergence costs a variable, not a selector copy, and the
 * light themes keep the author's fills and Mermaid's variety.
 *
 * **The opt-in is not a palette entry.** `--mermaid-normalize` is read by the
 * browser program at render time, not by CSS, so it is deliberately not part of
 * {@link MERMAID_VARIABLES}: making it required would force the light default
 * to opt in, which would change its colours. It stays in the four themes that
 * define it today.
 */

import { readFileSync } from 'node:fs';

/** Name of the stylesheet, as `print-styles` names its layers. @type {string} */
export const MERMAID_STYLESHEET_NAME = 'mermaid';

/** Where the block is read from. */
const STYLESHEET_URL = new URL('./mermaid.css', import.meta.url);

/** Cached file text; the block is read once per process. @type {string|null} */
let cache = null;

/**
 * Read the shared Mermaid styling block from disk.
 *
 * The file's leading comment is part of it and is kept: that comment is where
 * the variable contract and the style-query mechanism are written down.
 *
 * @returns {string} The block's CSS text, trimmed of surrounding blank lines.
 */
export function mermaidStylesheetSource() {
  if (cache === null) {
    cache = readFileSync(STYLESHEET_URL, 'utf8').trim();
  }
  return cache;
}

/**
 * The variables the block reads, and whether a theme must define each one.
 *
 * `required` is the honest minimum: without these a diagram is unreadable
 * (ink, strokes, shape outlines). The optional entries exist because one theme
 * needs a behaviour the others do not, and expressing it as a variable is
 * cheaper than letting that theme fork the selectors. `required: false` also
 * means "absent is a meaningful state", not "may be forgotten".
 *
 * @type {ReadonlyArray<{name: string, purpose: string, required: boolean}>}
 */
export const MERMAID_VARIABLES = Object.freeze([
  {
    name: '--mermaid-ink',
    purpose: 'Text on bare canvas: sequence messages, loop and edge labels, titles.',
    required: true,
  },
  {
    name: '--mermaid-ink-on-shape',
    purpose: 'Text inside a filled node, actor, note or cluster: the shape’s own ink.',
    required: true,
  },
  {
    name: '--mermaid-label-font',
    purpose: 'Typeface for every label; themes pass their body stack.',
    required: true,
  },
  {
    name: '--mermaid-label-weight',
    purpose: 'Label weight inside shapes; the high-contrast theme emboldens labels.',
    required: true,
  },
  {
    name: '--mermaid-shape-stroke',
    purpose:
      'Opt-in outline colour for node, actor, note, label and cluster shapes. '
      + 'Supplying it gates the shared outline rule; the light default keeps Mermaid’s own.',
    required: false,
  },
  {
    name: '--mermaid-shape-stroke-width',
    purpose: 'Outline weight used with --mermaid-shape-stroke.',
    required: false,
  },
  {
    name: '--mermaid-line',
    purpose:
      'Opt-in colour for edges, arrows, lifelines and loop frames. Gates the '
      + 'shared line rules, so a theme that leaves Mermaid’s own edges alone can say so.',
    required: false,
  },
  {
    name: '--mermaid-shape-fill',
    purpose:
      'Opt-in fill for node-shaped elements. Supplying it gates a fill override, '
      + 'for themes whose canvas would otherwise swallow Mermaid’s light default.',
    required: false,
  },
  {
    name: '--mermaid-edge-label-bg',
    purpose:
      'Opt-in background behind edge labels, so a label crossing an edge stays '
      + 'readable on a dark canvas.',
    required: false,
  },
]);

/**
 * Names a theme must define. @returns {Array<string>}
 */
export function requiredVariableNames() {
  return MERMAID_VARIABLES.filter((variable) => variable.required).map((variable) => variable.name);
}

/**
 * Names a theme may define, each of which activates a shared rule.
 * @returns {Array<string>}
 */
export function optionalVariableNames() {
  return MERMAID_VARIABLES.filter((variable) => !variable.required).map((variable) => variable.name);
}

/**
 * Selectors a stylesheet declares, with any `@container`/`@media` wrapper
 * stripped and grouping split apart.
 *
 * Comment text is removed first: the block's own header comment mentions
 * selectors, and a theme's comment explaining what it no longer does must not
 * read as a declaration.
 *
 * @param {string} css
 * @returns {Array<string>} Trimmed selector strings, in source order.
 */
export function selectorList(css) {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const selectors = [];

  // Every `{` starts a block; the text before it is a selector or an at-rule
  // prelude. At-rule preludes are dropped here and their inner rules picked up
  // by the same pass, because the regex walks the whole text.
  const preludePattern = /([^{}]+)\{/g;
  let match;
  while ((match = preludePattern.exec(withoutComments)) !== null) {
    const prelude = match[1].trim();
    if (!prelude || prelude.startsWith('@')) continue;

    for (const selector of prelude.split(',')) {
      const cleaned = selector.trim().replace(/\s+/g, ' ');
      if (cleaned) selectors.push(cleaned);
    }
  }

  return selectors;
}

/**
 * Variables a stylesheet declares but leaves empty.
 *
 * `--x: ;` is not a palette entry: the block's `var()` would resolve to the
 * empty string and the declaration would be dropped, which is exactly the
 * half-styled theme this check exists to catch. A custom property set to the
 * empty string is a missing one.
 *
 * @param {string} css
 * @returns {Set<string>} Names declared with no value.
 */
function emptyDeclarations(css) {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const empty = new Set();
  const pattern = /(--mermaid-[\w-]+)\s*:\s*(?:;|$)/gm;
  let match;
  while ((match = pattern.exec(withoutComments)) !== null) {
    empty.add(match[1]);
  }
  return empty;
}

/**
 * Required variables a theme fails to define.
 *
 * Returned rather than thrown so a caller can report every missing name at
 * once; the test turns a non-empty result into a failure. Order follows
 * {@link MERMAID_VARIABLES}, so failures read in the same order as the
 * contract they violate.
 *
 * @param {string} css  A theme's CSS text.
 * @returns {Array<string>} Missing variable names, in contract order.
 */
export function missingVariables(css) {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const declared = new Set();
  const pattern = /(--mermaid-[\w-]+)\s*:/g;
  let match;
  while ((match = pattern.exec(withoutComments)) !== null) {
    declared.add(match[1]);
  }
  const empty = emptyDeclarations(css);

  return requiredVariableNames().filter((name) => !declared.has(name) || empty.has(name));
}

/**
 * Selectors from the shared block that a theme redeclares.
 *
 * Exact selector matching, because that is what "redeclares the block's
 * selector" means: a theme may still use `.mermaid` for containment-adjacent
 * concerns of its own, but it may not restate a rule the block owns. The
 * comparison normalises whitespace only.
 *
 * @param {string} css  A theme's CSS text.
 * @param {Array<string>} [shared]  The block's selectors; defaults to the file.
 * @returns {Array<string>} Redeclared selectors, deduplicated, in block order.
 */
export function redeclaredSelectors(css, shared = selectorList(mermaidStylesheetSource())) {
  const declared = new Set(selectorList(css).map((selector) => selector.replace(/\s+/g, ' ')));
  return [...new Set(shared)].filter((selector) => declared.has(selector.replace(/\s+/g, ' ')));
}
