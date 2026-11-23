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
 * Mermaid client-side bootstrap script.
 * Uses `theme: 'base'` so diagrams inherit fonts and CSS variables.
 * Sets `startOnLoad: false` so we can manually trigger rendering and
 * signal completion via a global flag.
 */
const MERMAID_BOOTSTRAP = `
<script type="module">
let resolveMermaidReady;
window.__MERMAID_READY__ = new Promise((resolve) => {
  resolveMermaidReady = resolve;
});
window.__MERMAID_ERRORS__ = [];
window.__MERMAID_DEBUG__ = [];

function isDarkColor(color) {
  const m = color && color.match(/^rgba?\\(\\s*(\\d+)\\s*,\\s*(\\d+)\\s*,\\s*(\\d+)/i);
  if (!m) return false;
  const luminance = 0.299 * Number(m[1]) + 0.587 * Number(m[2]) + 0.114 * Number(m[3]);
  return luminance < 128;
}

try {
  const nodes = document.querySelectorAll('.mermaid');
  if (nodes.length > 0) {
    const { default: mermaid } = await import('https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs');

    mermaid.initialize({
      startOnLoad: false,
      theme: 'base',
      securityLevel: 'loose',
      suppressErrorRendering: true,
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

    // Render each diagram independently so one broken diagram cannot take
    // down the whole document. Failures become a visible error placeholder
    // and are reported in window.__MERMAID_ERRORS__ for the PDF step.
    for (const [index, node] of nodes.entries()) {
      try {
        const { svg } = await mermaid.render('mermaid-' + index, node.textContent);
        node.innerHTML = svg;
      } catch (err) {
        const message = err && err.message ? err.message : String(err);
        window.__MERMAID_ERRORS__.push({ index, error: message });
        document.getElementById('dmermaid-' + index)?.remove();
        node.textContent = 'Mermaid diagram failed to render: ' + message;
      }
    }

    // Optionally strip Mermaid's inline text-colour overrides so the active
    // theme's stylesheet governs label text. Mermaid compiles style
    // directives (color) into inline !important declarations, which outrank
    // any stylesheet rule (even !important ones). Author fill colours are
    // left intact, and dark author fills receive light text for contrast.
    const normalize = getComputedStyle(document.documentElement)
      .getPropertyValue('--mermaid-normalize')
      .trim();
    if (normalize) {
      document.querySelectorAll('.mermaid svg [style]').forEach((el) => {
        el.style.removeProperty('color');
      });
      document.querySelectorAll('.mermaid svg .node').forEach((node) => {
        const shape = node.querySelector('.label-container, rect, circle, ellipse, polygon, path');
        if (shape && isDarkColor(getComputedStyle(shape).fill)) {
          node.querySelectorAll('text, tspan, .label, .nodeLabel').forEach((label) => {
            label.style.setProperty('fill', '#ffffff', 'important');
            label.style.setProperty('color', '#ffffff', 'important');
          });
        }
      });
    }

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
  }
} catch (err) {
  const message = err && err.message ? err.message : String(err);
  window.__MERMAID_ERRORS__.push({ index: -1, error: message });
} finally {
  // Signal that rendering is complete so KaTeX and Puppeteer can proceed.
  window.__MERMAID_RENDER_DONE__ = true;
  resolveMermaidReady();
}
</script>
`;

/**
 * KaTeX client-side bootstrap script.
 * Loads KaTeX from CDN only when math nodes are present and renders all
 * .math-display and .math-inline elements after Mermaid completes.
 */
const KATEX_BOOTSTRAP = `
<script type="module">
window.__MATH_ERRORS__ = [];
try {
  // Wait deterministically for Mermaid to finish before mutating the DOM.
  if (window.__MERMAID_READY__) {
    await window.__MERMAID_READY__;
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
        window.__MATH_ERRORS__.push({ index: idx, kind: 'display', error: message });
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
        window.__MATH_ERRORS__.push({ index: idx, kind: 'inline', error: message });
      }
      idx++;
    }
  }
} catch (err) {
  const message = err && err.message ? err.message : String(err);
  window.__MATH_ERRORS__.push({ index: -1, kind: 'bootstrap', error: message });
} finally {
  // Signal that math rendering is complete.
  window.__MATH_RENDER_DONE__ = true;
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
    .map((css) => `<style>\n${css.trim().replace(/<\/style/gi, '<\\/style')}\n</style>`)
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
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
