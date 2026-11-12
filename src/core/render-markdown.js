/**
 * @file Parse Markdown into HTML, converting Mermaid fenced blocks
 * into <div class="mermaid"> containers for client-side rendering,
 * and converting LaTeX math expressions into identifiable wrappers.
 *
 * Inline math:  $...$
 * Block math:   $$...$$   (must start and end on its own line)
 *
 * Math parsing is conservative to avoid false positives in currency
 * or punctuation.  Fenced code blocks are protected from math
 * substitution; math that ends up inside code or HTML tags (inline
 * code spans, indented code, link URLs) is restored to its literal
 * source instead of being converted.
 */

import { marked } from 'marked';

// ---------------------------------------------------------------------------
// Mermaid extension
// ---------------------------------------------------------------------------

/**
 * Custom extension that captures ```mermaid … ``` (and ~~~mermaid … ~~~)
 * fenced blocks and emits them as <div class="mermaid">…</div> instead of
 * <pre><code>.  The closing fence may omit its trailing newline (EOF), and
 * may be longer than the opening fence.  Language matching is
 * case-insensitive.  The source is HTML-escaped; Mermaid reads it back via
 * textContent, so a label containing "</div>" cannot break the container.
 */
const mermaidExtension = {
  name: 'mermaid',
  level: 'block',
  start(src) { return src.match(/^ {0,3}(`{3,}|~{3,})[ \t]*mermaid[ \t]*\n/i)?.index; },
  tokenizer(src) {
    const match = src.match(/^ {0,3}(`{3,}|~{3,})[ \t]*mermaid[ \t]*\n([\s\S]*?)\n\1[`~]*[ \t]*(?:\n|$)/i);
    if (match) {
      return {
        type: 'mermaid',
        raw: match[0],
        text: match[2].trim(),
      };
    }
    return undefined;
  },
  renderer(token) {
    return `<div class="mermaid">\n${escapeHtml(token.text)}\n</div>\n`;
  },
};

marked.use({ extensions: [mermaidExtension] });

// ---------------------------------------------------------------------------
// Math pre-processing
// ---------------------------------------------------------------------------

/**
 * Escape characters that would otherwise be parsed as HTML inside the
 * math wrappers. KaTeX reads the content back via textContent, which
 * decodes these entities, so the LaTeX is recovered intact. Without
 * this, "<" in expressions such as "a<c^k" opens a bogus tag and
 * corrupts the surrounding document.
 *
 * @param {string} s
 * @returns {string}
 */
function escapeMath(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Minimal HTML-entity escape for mermaid sources and titles.
 *
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;');
}

/**
 * Replace fenced code blocks (``` and ~~~, three or more fence chars,
 * unterminated fences through EOF) with opaque placeholders so math
 * extraction can never touch their contents.
 *
 * @param {string} markdown
 * @returns {{ text: string, blocks: string[] }}
 */
function protectCode(markdown) {
  /** @type {string[]} */
  const blocks = [];
  const text = markdown.replace(
    /(?<=^|\n)(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n\1[`~]*[^\S\n]*(?:\n|$)|(?![\s\S]))/g,
    (match) => {
      blocks.push(match);
      return `\x00CODEX${blocks.length - 1}\x00`;
    },
  );
  return { text, blocks };
}

/**
 * Restore fenced code blocks verbatim. Must run BEFORE marked.parse so
 * the restored fences are parsed as code (restoring them afterwards
 * would inject raw fence markup into the HTML output).
 *
 * @param {string} text
 * @param {string[]} blocks
 * @returns {string}
 */
function restoreCode(text, blocks) {
  return text.replace(/\x00CODEX(\d+)\x00/g, (match, idx) => blocks[Number(idx)] ?? '');
}

/**
 * Replace LaTeX math expressions with placeholder tokens. The tokens
 * survive marked.parse untouched, and are turned into HTML afterwards
 * (see restoreMath) so marked can never re-parse the math contents —
 * otherwise "$x*y*z$" would gain <em> tags and lose its asterisks.
 *
 * Block math ($$…$$ occupying its own lines) and inline math ($…$)
 * are stored as { kind, html, originalSource } per token.
 *
 * @param {string} text
 * @returns {{ text: string, tokens: Array<{ kind: string, html: string, originalSource: string }> }}
 */
function extractMath(text) {
  /** @type {Array<{ kind: string, html: string, originalSource: string }>} */
  const tokens = [];

  const addToken = (match, body, kind) => {
    const html = kind === 'block'
      ? `<div class="math-display">\n${escapeMath(body.trim())}\n</div>`
      : `<span class="math-inline">${escapeMath(body)}</span>`;
    const index = tokens.push({ kind, html, originalSource: match }) - 1;
    return `\u27E8MATHX${index}\u27E9`;
  };

  // 1. Block math: $$...$$ must open and close on its own line (at most
  //    three spaces of indent). The placeholder is surrounded by blank
  //    lines so it forms its own paragraph.
  text = text.replace(
    /^[ \t]{0,3}\$\$[ \t]*\n?([\s\S]*?)\n?[ \t]*\$\$[ \t]*$/gm,
    (match, body) => `\n\n${addToken(match, body, 'block')}\n\n`,
  );

  // 2. Mid-line $$...$$ degrades to inline math rather than injecting a
  //    <div> into the middle of a paragraph.
  text = text.replace(
    /(?<!\$|\\)\$\$(?!\s)([^\n$]*?[^\s$])\$\$(?!\$)/g,
    (match, body) => addToken(match, body, 'inline'),
  );

  // 3. Inline math: $...$
  //    Conservative: requires non-space after the opening $ and before the
  //    closing $, must not be preceded by a backslash or another $, and may
  //    not span lines. Single-character math such as $n$ must be matched,
  //    so a "one or more characters" body is used rather than "two or more".
  text = text.replace(
    /(?<!\$|\\)\$(?!\s)([^\n$]*?[^\s$])\$(?!\$)/g,
    (match, body) => addToken(match, body, 'inline'),
  );

  return { text, tokens };
}

/** Matches a math token in both raw and percent-encoded form (marked's
 *  cleanUrl runs encodeURI over link destinations). The ⟨⟩ wrapper (U+27E8/9)
 *  is used rather than control characters so tokens survive link-destination
 *  parsing untouched. */
const MATH_TOKEN_RE = /\u27E8MATHX(\d+)\u27E9|%E2%9F%A8MATHX(\d+)%E2%9F%A9/g;

/**
 * Turn math placeholders into HTML after marked.parse.
 *
 * - A block token alone in a paragraph is unwrapped out of the <p>
 *   (a <div> inside a <p> splits the paragraph).
 * - A token inside an HTML tag (link URL, attribute) reverts to its
 *   literal $...$ source so the markup stays valid.
 * - A token inside <pre>/<code> reverts to its literal source so code
 *   blocks and code spans keep showing the original text.
 *
 * @param {string} html
 * @param {Array<{ kind: string, html: string, originalSource: string }>} tokens
 * @returns {string}
 */
function restoreMath(html, tokens) {
  const source = (idx) => tokens[Number(idx)]?.originalSource ?? '';
  const rendered = (idx) => tokens[Number(idx)]?.html ?? '';

  // Block tokens standing alone in a paragraph become block-level divs.
  let out = html.replace(
    /<p>\s*(?:\u27E8MATHX(\d+)\u27E9|%E2%9F%A8MATHX(\d+)%E2%9F%A9)\s*<\/p>/g,
    (match, a, b) => (tokens[Number(a ?? b)]?.kind === 'block' ? rendered(a ?? b) : match),
  );

  let inCode = 0;
  out = out.replace(/(<[^>]*>)|(\u27E8MATHX(\d+)\u27E9|%E2%9F%A8MATHX(\d+)%E2%9F%A9)/g,
    (match, tag, _tok, a, b) => {
      if (tag) {
        if (/^<(pre|code)\b/i.test(tag)) inCode += 1;
        else if (/^<\/(pre|code)>/i.test(tag)) inCode = Math.max(0, inCode - 1);
        return tag.replace(MATH_TOKEN_RE, (m, x, y) => source(x ?? y));
      }
      return inCode > 0 ? source(a ?? b) : rendered(a ?? b);
    });

  return out;
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
  const { text: protectedMd, blocks } = protectCode(markdown);
  const { text: withMath, tokens } = extractMath(protectedMd);
  const restoredMd = restoreCode(withMath, blocks);
  const html = marked.parse(restoredMd);
  return restoreMath(html, tokens);
}
