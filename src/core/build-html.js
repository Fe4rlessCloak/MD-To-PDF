/**
 * @file Assemble the final HTML document from rendered Markdown content.
 *
 * Assembly's remaining responsibilities are layout and inlining. Every payload
 * it used to hold as a string now lives in a file:
 *
 * - the Mermaid and KaTeX browser programs are modules
 *   (`mermaid-bootstrap.js`, `katex-bootstrap.js`), inlined as source text and
 *   invoked at the call site;
 * - the three print stylesheets are files (`print-styles/`), read and emitted
 *   in the order `print-styles.js` returns them;
 * - page geometry is a module (`page-geometry.js`) that emits the `@page`
 *   rule from a geometry value. Assembly emits it last, after every print
 *   layer, so the module's rule is the one that decides the page.
 *
 * The document is a single HTML file, but not a self-contained one: it makes
 * three fetches at runtime. Two are the CDN imports inside the bootstraps,
 * and each is guarded by a node-count check, so a document with no diagrams
 * and no expressions fetches neither. The third is the KaTeX stylesheet
 * `<link>` in the head, which is emitted for every document because the glyph
 * fonts it references are needed the moment any math appears; it is not
 * gated, so a math-free document still requests it.
 */

import { readFileSync } from 'node:fs';
import { readinessFlagsSource, FATAL_REPORT_INDEX } from './readiness-protocol.js';
import {
  BASE_STYLESHEET_NAME,
  stylesheetPayload,
} from './print-styles/print-styles.js';
import {
  MERMAID_STYLESHEET_NAME,
  mermaidStylesheetSource,
} from './mermaid-styles/mermaid-styles.js';
import {
  pageGeometry,
  PAGE_GEOMETRY_STYLESHEET_NAME,
  PAGE_GEOMETRY_VARIABLES,
} from './page-geometry.js';
import { KATEX_STYLESHEET_URL } from './katex-bootstrap.js';

/**
 * Injected declaration of the readiness protocol. Each bootstrap script is a
 * module, so it carries its own copy of the flag names rather than sharing a
 * global; the names themselves come from the protocol module.
 */
const READINESS_SOURCE = readinessFlagsSource();

/** Location of the Mermaid browser program that assembly inlines. */
const MERMAID_PROGRAM_URL = new URL('./mermaid-bootstrap.js', import.meta.url);

/** Location of the KaTeX browser program that assembly inlines. */
const KATEX_PROGRAM_URL = new URL('./katex-bootstrap.js', import.meta.url);

/** Cached program texts; read once, since every document inlines the same code. */
const programCache = new Map();

/**
 * Source text of the Mermaid browser program.
 *
 * Exported so tests can assert against the real program rather than a copy of
 * it, and so a caller can see exactly what assembly will inline.
 *
 * @returns {string} The program's ESM source.
 */
export function mermaidBootstrapSource() {
  return programSource(MERMAID_PROGRAM_URL);
}

/**
 * Source text of the KaTeX browser program.
 *
 * The counterpart of {@link mermaidBootstrapSource}; exported for the same
 * reason.
 *
 * @returns {string} The program's ESM source.
 */
export function katexBootstrapSource() {
  return programSource(KATEX_PROGRAM_URL);
}

/**
 * Read and cache a program's source text.
 * @param {URL} url
 * @returns {string}
 */
function programSource(url) {
  if (!programCache.has(url.href)) {
    programCache.set(url.href, readFileSync(url, 'utf8'));
  }
  return programCache.get(url.href);
}

/**
 * Neutralise a closing-tag sequence so inlined text cannot end its element.
 *
 * Escaping the slash keeps the sequence inert to the HTML parser while
 * leaving it syntactically valid to the language doing the parsing: `<\\/style`
 * is still a legal CSS comment terminator and `<\\/script` is still a legal
 * string in JavaScript, so neither the stylesheet nor the program is damaged.
 *
 * Matching is case-insensitive and the replacement preserves the matched
 * casing, because the HTML parser accepts `</STYLE>` and `</Script>` as
 * closers: normalising the case would leave a differently-cased closer intact
 * in the output.
 *
 * @param {string} source  Text to inline.
 * @param {'style'|'script'} tagName  Element the text is going into.
 * @returns {string}
 */
export function neutralizeClosingTag(source, tagName) {
  return source.replace(new RegExp(`</(${tagName})`, 'gi'), (_, matched) => `<\\/${matched}`);
}

/**
 * One bootstrap `<script>` element, for either browser program.
 *
 * This is the production adapter over a bootstrap module: the module's source
 * text is inlined, then its entry point is called with the protocol and the
 * fatal sentinel. Top-level await is what makes the inlined program's
 * asynchronous work complete before the enclosing module script does, exactly
 * as when each program was written inline in its own template literal.
 *
 * `RF` and the fatal index are passed in rather than read from a global, so a
 * program never depends on the spelling of a flag.
 *
 * @param {Object} params
 * @param {string} params.entry      Entry-point function name, e.g. `runMermaidBootstrap`.
 * @param {string} params.source     The program's ESM source text.
 * @param {string} [params.extraArgs] Optional extra properties merged into the entry call object.
 * @returns {string} A complete `<script type="module">` element.
 */
function bootstrapScript({ entry, source, extraArgs = '' }) {
  const program = neutralizeClosingTag(source, 'script');

  return `
<script type="module">
${READINESS_SOURCE}
${program}

await ${entry}({ flags: RF, publish: publishFlag, fatalReportIndex: ${FATAL_REPORT_INDEX}${extraArgs ? `, ${extraArgs}` : ''} });
</script>
`;
}

/**
 * The Mermaid bootstrap `<script>` element.
 * @returns {string} A complete `<script type="module">` element.
 */
function mermaidBootstrapScript() {
  return bootstrapScript({
    entry: 'runMermaidBootstrap',
    source: mermaidBootstrapSource(),
    extraArgs: `pageBackgroundVariable: ${JSON.stringify(PAGE_GEOMETRY_VARIABLES.background)}`,
  });
}

/**
 * The KaTeX bootstrap `<script>` element.
 *
 * Same adapter shape as the Mermaid one. It is emitted after the Mermaid
 * script, and the program itself awaits Mermaid readiness before it queries the
 * DOM — source order alone would not be enough, because the Mermaid script
 * hands its work to a promise.
 *
 * @returns {string} A complete `<script type="module">` element.
 */
function katexBootstrapScript() {
  return bootstrapScript({
    entry: 'runKatexBootstrap',
    source: katexBootstrapSource(),
  });
}

/**
 * Build a complete HTML document string.
 *
 * The options object is consumed whole, which means the call site does not
 * change when an option is added. Assembly is a different matter: it reads the
 * options it emits, so a new option that reaches the document needs a line
 * here. `title` is the current example — it is read below and nowhere else.
 *
 * @param {Object} params
 * @param {string}  params.bodyHtml     Rendered Markdown HTML.
 * @param {string|null} params.userCss  Optional user-provided CSS text.
 * @param {import('./document-options.js').DocumentOptions} [params.options]
 *   Document options; supplies the title.
 * @returns {string}
 */
export function buildHtml({ bodyHtml, userCss, options = {} }) {
  const title = options.title ?? null;

  // The shared Mermaid block is its own layer, spliced in directly after the
  // base stylesheet: it is a default a theme's palette adjusts, and the
  // containment and math rules must still outrank it. It is not part of
  // `PRINT_STYLESHEET_NAMES` because that list is the print stylesheets'
  // interface, and this block is Mermaid styling, not pagination.
  //
  // Emission order is the contract, not an implementation detail — see
  // `stylesheetPayload`. Layer order is therefore:
  //   base → mermaid-styles → user → containment → math → page-geometry
  const layers = [];
  for (const layer of stylesheetPayload({ userCss })) {
    layers.push(layer);
    if (layer.name === BASE_STYLESHEET_NAME) {
      layers.push({ name: MERMAID_STYLESHEET_NAME, css: mermaidStylesheetSource() });
    }
  }

  // Page geometry is appended after every print layer. It carries no other
  // rules, so the contract above is unaffected, and emitting it last means the
  // module's `@page` cannot be overridden by a stale copy in a theme.
  layers.push({ name: PAGE_GEOMETRY_STYLESHEET_NAME, css: pageGeometry().css });

  const styleTag = layers
    .map((layer) => `<style>\n${neutralizeClosingTag(layer.css.trim(), 'style')}\n</style>`)
    .join('\n');

  const katexCssLink =
    `<link rel="stylesheet" href="${KATEX_STYLESHEET_URL}" crossorigin="anonymous">`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
${title ? `<title>${escapeHtml(title)}</title>` : ''}
${katexCssLink}
${styleTag}
</head>
<body>
${bodyHtml}
${mermaidBootstrapScript()}
${katexBootstrapScript()}
</body>
</html>`;
}

/**
 * Minimal HTML-entity escape for title safety.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
