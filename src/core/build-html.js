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
 * The document stays a single self-contained file: the only fetches it makes at
 * runtime are the two CDN imports inside the bootstraps, and neither happens
 * unless the document actually contains a diagram or an expression.
 */

import { readFileSync } from 'node:fs';
import { readinessFlagsSource, FATAL_REPORT_INDEX } from './readiness-protocol.js';
import { stylesheetPayload } from './print-styles/print-styles.js';
import { pageGeometry, DEFAULT_PAGE_GEOMETRY } from './page-geometry.js';
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
 * The Mermaid bootstrap `<script>` element.
 *
 * This is the production adapter over `mermaid-bootstrap.js`: the module's
 * source text is inlined, then its entry point is called with the protocol and
 * the fatal sentinel. Top-level await is what makes the inlined program's
 * asynchronous work — the runtime load, then every diagram — complete before
 * the enclosing module script does, exactly as when the program was written
 * inline in a template literal.
 *
 * `RF` and the fatal index are passed in rather than read from a global, so
 * the program never depends on the spelling of a flag.
 *
 * @returns {string} A complete `<script type="module">` element.
 */
function mermaidBootstrapScript() {
  const program = neutralizeClosingTag(mermaidBootstrapSource(), 'script');

  return `
<script type="module">
${READINESS_SOURCE}
${program}

await runMermaidBootstrap({ flags: RF, fatalReportIndex: ${FATAL_REPORT_INDEX} });
</script>
`;
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
  const program = neutralizeClosingTag(katexBootstrapSource(), 'script');

  return `
<script type="module">
${READINESS_SOURCE}
${program}

await runKatexBootstrap({ flags: RF, fatalReportIndex: ${FATAL_REPORT_INDEX} });
</script>
`;
}

/**
 * Build a complete HTML document string.
 *
 * The document options are consumed whole, so an option added to
 * `document-options.js` reaches assembly without a change here or at the
 * call site.
 *
 * @param {Object} params
 * @param {string}  params.bodyHtml     Rendered Markdown HTML.
 * @param {string|null} params.userCss  Optional user-provided CSS text.
 * @param {import('./document-options.js').DocumentOptions} [params.options]
 *   Document options; supplies the title.
 * @param {Partial<import('./page-geometry.js').PageGeometry>} [params.page]
 *   Page geometry overrides. Defaults to {@link DEFAULT_PAGE_GEOMETRY}.
 * @returns {string}
 */
export function buildHtml({ bodyHtml, userCss, options = {}, page = DEFAULT_PAGE_GEOMETRY }) {
  const title = options.title ?? null;

  // Emitted in the order the print-styles module returns: base, user CSS,
  // containment, math. The order is the contract, not an implementation
  // detail — see `stylesheetPayload`.
  const layers = stylesheetPayload({ userCss });

  // Page geometry is appended after every print layer. It carries no other
  // rules, so the contract above is unaffected, and emitting it last means the
  // module's `@page` cannot be overridden by a stale copy in a theme.
  layers.push({ name: 'page-geometry', css: pageGeometry(page).css });

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
