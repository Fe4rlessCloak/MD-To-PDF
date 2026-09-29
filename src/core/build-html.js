/**
 * @file Assemble the final HTML document from rendered Markdown content,
 * injected user CSS, Mermaid runtime bootstrap, and KaTeX math rendering.
 */

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
 * Mermaid client-side bootstrap script.
 * Uses `theme: 'base'` so diagrams inherit fonts and CSS variables.
 * Sets `startOnLoad: false` so we can manually trigger rendering and
 * signal completion via a global flag.
 */
const MERMAID_BOOTSTRAP = `
<script type="module">
import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';

mermaid.initialize({
  startOnLoad: false,
  theme: 'base',
  securityLevel: 'loose',
  flowchart: {
    htmlLabels: false,
  },
  sequence: {
    useMaxWidth: true,
    htmlLabels: false,
  },
  gantt: {
    useMaxWidth: true,
  },
});

// Wait for DOM, then render all .mermaid blocks
await mermaid.run({
  querySelector: '.mermaid',
});

// Emit basic render diagnostics for print-layout debugging.
window.__MERMAID_DEBUG__ = Array.from(document.querySelectorAll('.mermaid')).map((node, index) => {
  const svg = node.querySelector('svg');
  const foreignObjects = svg ? svg.querySelectorAll('foreignObject').length : 0;
  const nodeRect = node.getBoundingClientRect();
  const svgRect = svg ? svg.getBoundingClientRect() : null;

  return {
    index,
    foreignObjects,
    container: {
      width: nodeRect.width,
      height: nodeRect.height,
    },
    svg: svgRect
      ? {
          width: svgRect.width,
          height: svgRect.height,
        }
      : null,
  };
});

// Signal that rendering is complete so Puppeteer knows to export
window.__MERMAID_RENDER_DONE__ = true;
</script>
`;

/**
 * KaTeX client-side bootstrap script.
 * Loads KaTeX from CDN and renders all .math-display and .math-inline
 * elements.  Sets a completion flag so Puppeteer can wait for math
 * before exporting the PDF.
 */
const KATEX_BOOTSTRAP = `
<script type="module">
import katex from 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.mjs';

// Render display math blocks
document.querySelectorAll('.math-display').forEach((el) => {
  try {
    katex.render(el.textContent, el, { displayMode: true, throwOnError: false });
  } catch (_) {
    // Leave the raw LaTeX visible if rendering fails.
  }
});

// Render inline math spans
document.querySelectorAll('.math-inline').forEach((el) => {
  try {
    katex.render(el.textContent, el, { displayMode: false, throwOnError: false });
  } catch (_) {
    // Leave the raw LaTeX visible if rendering fails.
  }
});

// Signal that math rendering is complete
window.__MATH_RENDER_DONE__ = true;
</script>
`;

/**
 * Build a complete HTML document string.
 *
 * @param {Object} options
 * @param {string}  options.bodyHtml     Rendered Markdown HTML.
 * @param {string|null} options.userCss  Optional user-provided CSS text.
 * @param {string}  [options.title]      Optional document title.
 * @returns {string}
 */
export function buildHtml({ bodyHtml, userCss, title }) {
  const stylesheets = [BASE_CSS];
  if (userCss) stylesheets.push(userCss);
  stylesheets.push(MERMAID_CSS);
  stylesheets.push(KATEX_CSS);

  // Load KaTeX CSS from CDN for proper glyph rendering
  const katexCssLink =
    '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css" crossorigin="anonymous">';

  const styleTag = stylesheets
    .map((css) => `<style>\n${css.trim()}\n</style>`)
    .join('\n');

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
${MERMAID_BOOTSTRAP}
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
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"');
}
