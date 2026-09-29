/**
 * @file Parse Markdown into HTML, converting Mermaid fenced blocks
 * into <div class="mermaid"> containers for client-side rendering,
 * and converting LaTeX math expressions into identifiable wrappers.
 *
 * Inline math:  $...$
 * Block math:   $$...$$
 *
 * Math parsing is conservative to avoid false positives in currency
 * or punctuation.  Code fences, inline code, and Mermaid fences are
 * protected from math substitution.
 */

import { marked } from 'marked';

// ---------------------------------------------------------------------------
// Mermaid extension
// ---------------------------------------------------------------------------

/**
 * Custom extension that captures ```mermaid … ``` fenced blocks and
 * emits them as <div class="mermaid">…</div> instead of <pre><code>.
 */
const mermaidExtension = {
  name: 'mermaid',
  level: 'block',
  start(src) { return src.match(/^```mermaid\s*\n/i)?.index; },
  tokenizer(src) {
    const match = src.match(/^```mermaid\s*\n([\s\S]*?)```\s*\n/);
    if (match) {
      return {
        type: 'mermaid',
        raw: match[0],
        text: match[1].trim(),
      };
    }
    return undefined;
  },
  renderer(token) {
    return `<div class="mermaid">\n${token.text}\n</div>\n`;
  },
};

marked.use({ extensions: [mermaidExtension] });

// ---------------------------------------------------------------------------
// Math pre-processing
// ---------------------------------------------------------------------------

/**
 * Replace LaTeX math expressions in raw Markdown with HTML wrappers
 * that KaTeX can target client-side.
 *
 * Strategy:
 *  1. Protect code fences (``` … ```) and inline code (`…`) so math
 *     inside them is never touched.
 *  2. Replace block math  $$...$$  with <div class="math-display">…</div>
 *  3. Replace inline math  $...$   with <span class="math-inline">…</span>
 *  4. Restore protected code blocks.
 *
 * @param {string} markdown
 * @returns {string}
 */
function preprocessMath(markdown) {
  /** @type {string[]} */
  const protectedBlocks = [];

  // 1. Protect fenced code blocks (including mermaid).
  let processed = markdown.replace(
    /(```[\s\S]*?```)/g,
    (match) => {
      protectedBlocks.push(match);
      return `\x00MATH_PROTECT_${protectedBlocks.length - 1}\x00`;
    },
  );

  // 2. Protect inline code spans.
  processed = processed.replace(
    /(`[^`]+`)/g,
    (match) => {
      protectedBlocks.push(match);
      return `\x00MATH_PROTECT_${protectedBlocks.length - 1}\x00`;
    },
  );

  // 3. Block math: $$...$$  (non-greedy, multiline).
  processed = processed.replace(
    /\$\$([\s\S]*?)\$\$/g,
    (_, inner) => `<div class="math-display">\n${inner.trim()}\n</div>`,
  );

  // 4. Inline math: $...$
  //    Conservative: requires non-space after opening $ and before closing $,
  //    and must not be preceded by a backslash or another $.
  processed = processed.replace(
    /(?<!\$|\\)\$(\S[^$]*?\S)\$(?!\$)/g,
    (_, inner) => `<span class="math-inline">${inner}</span>`,
  );

  // 5. Restore protected blocks.
  processed = processed.replace(
    /\x00MATH_PROTECT_(\d+)\x00/g,
    (_, idx) => protectedBlocks[Number(idx)] ?? '',
  );

  return processed;
}

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
  const withMath = preprocessMath(markdown);
  return marked.parse(withMath);
}
