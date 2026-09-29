#!/usr/bin/env node

/**
 * @file CLI entrypoint for md-to-pdf.
 *
 * Usage:
 *   node convert.js <input.md> <output.pdf> [--style <path>]
 *
 * Examples:
 *   node convert.js notes.md notes.pdf
 *   node convert.js notes.md notes.pdf --style ./styles/style.css
 */

import { writeFile } from 'node:fs/promises';
import { parseArgs } from './src/cli/parse-args.js';
import { readMarkdown, readStylesheet } from './src/core/load-input.js';
import { renderMarkdown } from './src/core/render-markdown.js';
import { buildHtml } from './src/core/build-html.js';
import { renderPdf } from './src/core/render-pdf.js';
import { fatal } from './src/core/errors.js';

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  // 1. Read inputs
  const markdown = await readMarkdown(opts.input);
  const userCss  = await readStylesheet(opts.style);

  // 2. Parse Markdown → HTML (Mermaid blocks become .mermaid divs)
  const bodyHtml = await renderMarkdown(markdown);

  // 3. Assemble full HTML document
  const html = buildHtml({ bodyHtml, userCss });

  // 4. Render HTML → PDF via Puppeteer
  const pdfBuffer = await renderPdf(html);

  // 5. Write output
  await writeFile(opts.output, pdfBuffer);

  process.stdout.write(`\n  ✓ PDF generated: ${opts.output}\n\n`);
}

main().catch(fatal);
