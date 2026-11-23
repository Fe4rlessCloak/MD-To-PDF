/**
 * @file Assemble the final HTML document from rendered Markdown content,
 * injected user CSS, Mermaid runtime bootstrap, and KaTeX math rendering.
 *
 * The Mermaid browser program is a real module (`mermaid-bootstrap.js`).
 * Assembly inlines that module's source text into a `<script type="module">`
 * and calls its entry point, so the document stays a single self-contained
 * file with no second fetch while tests can import the same code.
 */

import { readFileSync } from 'node:fs';
import { readinessFlagsSource, FATAL_REPORT_INDEX } from './readiness-protocol.js';

/**
 * Injected declaration of the readiness protocol. Each bootstrap script is a
 * module, so it carries its own copy of the flag names rather than sharing a
 * global; the names themselves come from the protocol module.
 */
const READINESS_SOURCE = readinessFlagsSource();

/** Location of the Mermaid browser program that assembly inlines. */
const MERMAID_PROGRAM_URL = new URL('./mermaid-bootstrap.js', import.meta.url);

/** Cached program text; read once, since every document inlines the same code. */
let mermaidProgramSource = null;

/**
 * Source text of the Mermaid browser program.
 *
 * Exported so tests can assert against the real program rather than a copy of
 * it, and so a caller can see exactly what assembly will inline.
 *
 * @returns {string} The program's ESM source.
 */
export function mermaidBootstrapSource() {
  if (mermaidProgramSource === null) {
    mermaidProgramSource = readFileSync(MERMAID_PROGRAM_URL, 'utf8');
  }
  return mermaidProgramSource;
}

/**
 * Neutralise a closing-tag sequence so inlined text cannot end its element.
 *
 * Escaping the slash keeps the sequence inert to the HTML parser while
 * leaving it syntactically valid to the language doing the parsing: `<\/style`
 * is still a legal CSS comment terminator and `<\/script` is still a legal
 * string in JavaScript, so neither the stylesheet nor the program is damaged.
 *
 * @param {string} source  Text to inline.
 * @param {'style'|'script'} tagName  Element the text is going into.
 * @returns {string}
 */
export function neutralizeClosingTag(source, tagName) {
  return source.replace(new RegExp(`</(${tagName})`, 'gi'), (_, matched) => `<\\/${matched}`);
}

/**
 * Default base stylesheet — provides safe print defaults.
 * User CSS is appended after this so it takes precedence for typography.
 */
const BASE_CSS = `
* {
  box-sizing: border-box;
}
body {
  font-family: Georgia, 'Times New Roman', Times, serif;
  font-size: 11pt;
  line-height: 1.6;
  color: #222;
  margin: 0;
  padding: 0;
}
@page {
  margin: 2cm 2.2cm;
}
`;

/**
 * Mermaid containment stylesheet — enforces dynamic scaling rules.
 * These are placed *after* user CSS so they cannot be overridden.
 */
const MERMAID_CSS = `
.mermaid {
  display: block;
  overflow: visible;
  width: 100%;
  max-height: 45vh;
  margin: 1.5rem auto;
  break-inside: avoid;
  page-break-inside: avoid;
  text-align: center;
}
.mermaid svg {
  display: block;
  max-width: 100% !important;
  max-height: 45vh !important;
  width: auto !important;
  height: auto !important;
  margin: 0 auto !important;
}
`;

/**
 * KaTeX print-safe stylesheet — ensures math blocks integrate cleanly
 * into the document flow without breaking page layout.
 */
const KATEX_CSS = `
.math-display {
  display: block;
  text-align: center;
  margin: 1em 0;
  overflow-x: auto;
  overflow-y: hidden;
  break-inside: avoid;
  page-break-inside: avoid;
}
.math-inline {
  display: inline;
  white-space: nowrap;
}
`;

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
 * KaTeX client-side bootstrap script.
 * Loads KaTeX from CDN only when math nodes are present and renders all
 * .math-display and .math-inline elements after Mermaid completes.
 */
const KATEX_BOOTSTRAP = `
<script type="module">
${READINESS_SOURCE}
window[RF.mathErrors] = [];
try {
  // Wait deterministically for Mermaid to finish before mutating the DOM.
  if (window[RF.mermaidReady]) {
    await window[RF.mermaidReady];
  }

  const displayNodes = document.querySelectorAll('.math-display');
  const inlineNodes = document.querySelectorAll('.math-inline');

  if (displayNodes.length > 0 || inlineNodes.length > 0) {
    const { default: katex } = await import('https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.mjs');

    let idx = 0;
    for (const el of displayNodes) {
      const raw = el.textContent;
      try {
        katex.render(raw, el, { displayMode: true, throwOnError: true });
      } catch (err) {
        el.textContent = raw;
        const message = err && err.message ? err.message : String(err);
        window[RF.mathErrors].push({ index: idx, kind: 'display', error: message });
      }
      idx++;
    }

    for (const el of inlineNodes) {
      const raw = el.textContent;
      try {
        katex.render(raw, el, { displayMode: false, throwOnError: true });
      } catch (err) {
        el.textContent = raw;
        const message = err && err.message ? err.message : String(err);
        window[RF.mathErrors].push({ index: idx, kind: 'inline', error: message });
      }
      idx++;
    }
  }
} catch (err) {
  const message = err && err.message ? err.message : String(err);
  window[RF.mathErrors].push({ index: -1, kind: 'bootstrap', error: message });
} finally {
  // Signal that math rendering is complete.
  window[RF.mathRenderDone] = true;
}
</script>
`;

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
 * @returns {string}
 */
export function buildHtml({ bodyHtml, userCss, options = {} }) {
  const title = options.title ?? null;

  const stylesheets = [BASE_CSS];
  if (userCss) stylesheets.push(userCss);
  stylesheets.push(MERMAID_CSS);
  stylesheets.push(KATEX_CSS);

  // Load KaTeX CSS from CDN for proper glyph rendering
  const katexCssLink =
    '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css" crossorigin="anonymous">';

  const styleTag = stylesheets
    .map((css) => `<style>\n${neutralizeClosingTag(css.trim(), 'style')}\n</style>`)
    .join('\n');

  const mermaidScript = mermaidBootstrapScript();

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
${mermaidScript}
${KATEX_BOOTSTRAP}
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
