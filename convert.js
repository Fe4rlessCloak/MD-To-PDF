#!/usr/bin/env node

/**
 * @file CLI entrypoint for md-to-pdf.
 *
 * Usage:
 *   node convert.js <input.md> <output.pdf> [--style <path>] [--title <string>]
 *
 * Examples:
 *   node convert.js notes.md notes.pdf
 *   node convert.js notes.md notes.pdf --style ./styles/style.css --title 'Q3 Notes'
 */

import { parseArgs } from './src/cli/parse-args.js';
import { readMarkdown, readStylesheet } from './src/core/load-input.js';
import { renderMarkdown } from './src/core/render-markdown.js';
import { buildHtml } from './src/core/build-html.js';
import { renderPdf } from './src/core/render-pdf.js';
import { writePdfOutput } from './src/core/write-output.js';
import { fatal } from './src/core/errors.js';

async function main() {
  const options = parseArgs(process.argv.slice(2));

  // 1. Read inputs
  const markdown = await readMarkdown(options.input);
  const userCss  = await readStylesheet(options.style);

  // 2. Parse Markdown → HTML (Mermaid blocks become .mermaid divs)
  const bodyHtml = await renderMarkdown(markdown);

  // 3. Assemble full HTML document from the options object whole
  const html = buildHtml({ bodyHtml, userCss, options });

  // 4. Render HTML → PDF via Puppeteer
  const pdfBuffer = await renderPdf(html);

  // 5. Write output — failures here are input errors, not render errors
  await writePdfOutput(options.output, pdfBuffer);

  process.stdout.write(`\n  ✓ PDF generated: ${options.output}\n\n`);
}

main().catch(fatal);
