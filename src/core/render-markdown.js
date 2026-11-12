/**
 * @file Parse Markdown into HTML, converting Mermaid fenced blocks
 * into <div class="mermaid"> containers for client-side rendering,
 * and converting LaTeX math expressions into identifiable wrappers.
 *
 * Inline math:  $...$  (and mid-line $$...$$)
 * Block math:   $$...$$   (must start and end on its own line)
 *
 * Mermaid and math are implemented as native `marked` extensions so
 * CommonMark code fences, indented code blocks, inline code spans,
 * link destinations, blockquotes, lists, and HTML blocks/comments are
 * respected without regex pre-pass desynchronisation.
 */

import { Marked } from 'marked';

/**
 * Escape HTML-significant characters for math wrappers.
 * KaTeX reads the content back via `textContent`, which decodes these
 * entities intact while preventing `<` from opening bogus HTML tags.
 *
 * @param {string} str
 * @returns {string}
 */
function escapeMath(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Minimal HTML-entity escape for Mermaid containers.
 * Escaping `&` and `<` prevents tags such as `</div>` from breaking
 * the container while preserving `-->` arrows for readability.
 *
 * @param {string} str
 * @returns {string}
 */
function escapeMermaid(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;');
}

// ---------------------------------------------------------------------------
// Mermaid extension
// ---------------------------------------------------------------------------

/**
 * Custom block extension that captures ```mermaid … ``` (and ~~~mermaid … ~~~)
 * fenced blocks and emits them as <div class="mermaid">…</div> instead of
 * <pre><code>.  Supports 0–3 spaces of indentation on both opening and closing
 * fences, 3+ fence characters, empty blocks, closing fences at EOF without a
 * trailing newline, and case-insensitive language matching.  Closing fences must
 * use the same fence character and be at least as long as the opening fence.
 */
const mermaidExtension = {
  name: 'mermaid',
  level: 'block',
  start(src) {
    return src.match(/^ {0,3}(`{3,}|~{3,})[ \t]*mermaid[ \t]*(?:\n|$)/im)?.index;
  },
  tokenizer(src) {
    const open = src.match(/^ {0,3}(`{3,}|~{3,})[ \t]*mermaid[ \t]*\n/i);
    if (!open) return undefined;

    const fence = open[1];
    const rest = src.slice(open[0].length);
    const closeRe = new RegExp(
      `^ {0,3}${fence[0]}{${fence.length},}[ \\t]*(?:\\n|$)`,
      'm',
    );
    const close = rest.match(closeRe);
    if (!close) return undefined;

    const body = rest.slice(0, close.index).trim();
    const raw = open[0] + rest.slice(0, close.index + close[0].length);
    return {
      type: 'mermaid',
      raw,
      text: body,
    };
  },
  renderer(token) {
    return `<div class="mermaid">\n${escapeMermaid(token.text)}\n</div>\n`;
  },
};

// ---------------------------------------------------------------------------
// Math extensions
// ---------------------------------------------------------------------------

/**
 * Block math extension:
 *  1. Multi-line `$$` opening on its own line and `$$` closing on its own line
 *     (0–3 spaces indent allowed on each fence line).
 *  2. Single-line standalone `$$...$$` occupying its own line with no other
 *     unprotected `$$` delimiters on that line.
 */
const blockMathExtension = {
  name: 'blockMath',
  level: 'block',
  start(src) {
    return src.match(/^ {0,3}\$\$/m)?.index;
  },
  tokenizer(src) {
    // 1. Multi-line $$...$$ with opening and closing $$ on their own lines.
    const open = src.match(/^ {0,3}\$\$[ \t]*\n/);
    if (open) {
      const rest = src.slice(open[0].length);
      const close = rest.match(/^ {0,3}\$\$[ \t]*(?:\n|$)/m);
      if (close) {
        const body = rest.slice(0, close.index).trim();
        const raw = open[0] + rest.slice(0, close.index + close[0].length);
        return {
          type: 'blockMath',
          raw,
          text: body,
        };
      }
    }

    // 2. Single-line standalone $$...$$ on its own line.
    const single = src.match(
      /^ {0,3}\$\$(?!\s)((?:\\\\|\\\$|[^\n$])*?(?:\\\\|\\\$|[^\s$\\]))\$\$[ \t]*(?:\n|$)/,
    );
    if (single) {
      return {
        type: 'blockMath',
        raw: single[0],
        text: single[1].trim(),
      };
    }

    return undefined;
  },
  renderer(token) {
    return `<div class="math-display">\n${escapeMath(token.text)}\n</div>\n`;
  },
};

/**
 * Inline math extension:
 *  - Mid-line `$$...$$` (degrades to inline span rather than injecting a <div>)
 *  - Conservative `$...$`: requires non-space after opening `$` and before
 *    closing `$`, allows escaped `\$` and `\\` inside the body, may not span
 *    lines, and rejects a digit immediately following the closing `$` to avoid
 *    false positives on currency ranges like `$5-$10`.
 */
const inlineMathExtension = {
  name: 'inlineMath',
  level: 'inline',
  start(src) {
    return src.indexOf('$');
  },
  tokenizer(src) {
    const dbl = src.match(
      /^\$\$(?!\s)((?:\\\\|\\\$|[^\n$])*?(?:\\\\|\\\$|[^\s$\\]))\$\$(?!\$|\d)/,
    );
    if (dbl) {
      return {
        type: 'inlineMath',
        raw: dbl[0],
        text: dbl[1],
      };
    }

    const sgl = src.match(
      /^\$(?!\$|\s)((?:\\\\|\\\$|[^\n$])*?(?:\\\\|\\\$|[^\s$\\]))\$(?!\$|\d)/,
    );
    if (sgl) {
      return {
        type: 'inlineMath',
        raw: sgl[0],
        text: sgl[1],
      };
    }

    return undefined;
  },
  renderer(token) {
    return `<span class="math-inline">${escapeMath(token.text)}</span>`;
  },
};

const mdParser = new Marked();
mdParser.use({
  extensions: [mermaidExtension, blockMathExtension, inlineMathExtension],
});

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Convert a Markdown string into an HTML string.
 * Mermaid blocks are rendered as <div class="mermaid"> containers.
 * LaTeX math expressions are wrapped in .math-display / .math-inline spans.
 *
 * @param {string} markdown
 * @returns {Promise<string>}
 */
export async function renderMarkdown(markdown) {
  return mdParser.parse(markdown);
}
