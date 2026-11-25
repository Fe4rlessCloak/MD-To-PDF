/**
 * @file The Mermaid styling module: one shared block, parameterised per theme.
 *
 * A theme supplies a palette; this module supplies every selector that targets
 * Mermaid's generated DOM. Four themes used to carry near-identical copies of
 * that selector list and the fifth had drifted into its own dialect with more
 * than double the selectors and `!important` declarations. The list now lives
 * here once.
 *
 * Two parts of the interface:
 *
 * - {@link mermaidStylesheetSource} reads the block from disk; HTML assembly
 *   inlines it, and tests assert against the real file.
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
 *
 * **Two owners, one prefix.** `--mermaid-theme` is the second property the
 * browser program reads from the root, and it is likewise not a palette entry:
 * it selects Mermaid's own theme rather than a colour this block uses. The
 * `--mermaid-gantt-*` bar fills are the third kind: they reach Mermaid through
 * `initialize({ themeVariables })`, not through a selector, so they are equally
 * outside this block. All of these names are published by the program as
 * `BOOTSTRAP_VARIABLES`, so the contract check that every declared
 * `--mermaid-*` name is accounted for can recognise them without a list of its
 * own — and without exempting the prefix, which would let a typo through. A
 * theme declares them or omits them; the block never mentions any of them.
 */

import { readFileSync } from 'node:fs';

import { declarations, stripComments } from '../css-declarations.js';

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
  {
    name: '--mermaid-badge-ink',
    purpose:
      'Opt-in ink for the sequence-diagram autonumber badge (.sequenceNumber), '
      + 'for themes that need explicit numeral contrast against the badge disc.',
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
 * Remove CSS comments.
 *
 * Re-exported from `css-declarations.js`, where the reader that needs it lives,
 * so the many callers that already import it from here keep working and there
 * is one implementation rather than two. The block's own header mentions
 * selectors, and a theme's comment explaining what it no longer does must not
 * read as a declaration.
 */
export { stripComments };

/**
 * Every rule a stylesheet declares, as the selector list of each and its
 * declaration body.
 *
 * This is the owner of the "split a comment-stripped stylesheet into prelude
 * and body" step: {@link selectorList} answers which selectors appear by
 * flattening this, and a caller that needs to know *which* declaration sits
 * under a selector reads the same walk instead of writing a second one. A rule
 * that paints a shape and a rule that inks a label can name the same element
 * family, and telling them apart is exactly what the sequence-diagram checks
 * depend on.
 *
 * At-rule preludes are dropped and their inner rules kept: the pattern walks
 * the whole text, so a `@container` or `@media` wrapper contributes its inner
 * rules without appearing as one of them.
 *
 * @param {string} css
 * @returns {Array<{selectors: Array<string>, body: string}>} In source order.
 */
export function ruleList(css) {
  const withoutComments = stripComments(css);
  const rules = [];

  const preludePattern = /([^{}]+)\{([^{}]*)\}/g;
  let match;
  while ((match = preludePattern.exec(withoutComments)) !== null) {
    const prelude = match[1].trim();
    if (!prelude || prelude.startsWith('@')) continue;

    const selectors = prelude
      .split(',')
      .map((selector) => selector.trim().replace(/\s+/g, ' '))
      .filter(Boolean);
    if (selectors.length === 0) continue;

    rules.push({ selectors, body: match[2].trim() });
  }

  return rules;
}

/**
 * Selectors a stylesheet declares, with any `@container`/`@media` wrapper
 * stripped and grouping split apart.
 *
 * Comment text is removed first, for the reason given on {@link stripComments}.
 *
 * @param {string} css
 * @returns {Array<string>} Trimmed selector strings, in source order.
 */
export function selectorList(css) {
  return ruleList(css).flatMap((rule) => rule.selectors);
}

/**
 * Required variables a theme fails to define.
 *
 * Returned rather than thrown so a caller can report every missing name at
 * once; the test turns a non-empty result into a failure. Order follows
 * {@link MERMAID_VARIABLES}, so failures read in the same order as the
 * contract they violate.
 *
 * `--x: ;` is not a palette entry: the block's `var()` would resolve to the
 * empty string and the declaration would be dropped, which is exactly the
 * half-styled theme this check exists to catch. `declarations()` reports a
 * hollow property as empty, and an empty one counts as missing here.
 *
 * @param {string} css  A theme's CSS text.
 * @returns {Array<string>} Missing variable names, in contract order.
 */
export function missingVariables(css) {
  const { declared, empty } = declarations(css, '--mermaid-');

  return requiredVariableNames().filter((name) => !declared.has(name) || empty.has(name));
}

/**
 * Canonical form of one selector, for comparison.
 *
 * Comparison has to survive formatting drift, not just whitespace *inside* a
 * compound selector: a theme that restates a block rule as
 * `.mermaid svg .node .label>rect` is redeclaring the same rule the block
 * writes as `.mermaid svg .node .label > rect`, and a naive string compare
 * calls that clean. Collapsing whitespace and putting one space either side of
 * a combinator makes the two identical without changing what they select.
 *
 * @param {string} selector
 * @returns {string}
 */
export function canonicalSelector(selector) {
  return selector
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\s*([>+~])\s*/g, ' $1 ')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .trim();
}

/**
 * Selectors from the shared block that a theme redeclares.
 *
 * A theme may still use `.mermaid` for containment-adjacent concerns of its
 * own, but it may not restate a rule the block owns. Both sides are split on
 * commas, trimmed and put through {@link canonicalSelector}, so a selector
 * list written in a different order, or with different spacing around a
 * combinator, is still recognised as the block's own.
 *
 * @param {string} css  A theme's CSS text.
 * @param {Array<string>} [shared]  The block's selectors; defaults to the file.
 * @returns {Array<string>} Redeclared selectors, deduplicated, in block order.
 */
export function redeclaredSelectors(css, shared = selectorList(mermaidStylesheetSource())) {
  const declared = new Set(selectorList(css).map(canonicalSelector));

  const seen = new Set();
  const redeclared = [];
  for (const selector of shared.map(canonicalSelector)) {
    if (!seen.has(selector) && declared.has(selector)) redeclared.push(selector);
    seen.add(selector);
  }
  return redeclared;
}
