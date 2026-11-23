/**
 * @file Launch Puppeteer, render the HTML document, wait for Mermaid
 * diagrams and KaTeX math to finish rendering, and export the PDF.
 *
 * This module is the browser adapter for the readiness protocol: it launches
 * the page, hands the protocol two closures over that page, and exports. All
 * polling and all fatal-versus-warning decisions live in
 * `readiness-protocol.js`.
 */

import puppeteer from 'puppeteer';
import { RenderError } from './errors.js';
import {
  READINESS_FLAGS,
  waitForReadiness,
  checkErrorReports,
} from './readiness-protocol.js';

/**
 * Default Puppeteer launch options.
 * Can be overridden via the `launchOptions` parameter for custom Chromium paths.
 *
 * @type {import('puppeteer').LaunchOptions}
 */
const DEFAULT_LAUNCH_OPTIONS = {
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
  ],
};

/**
 * Default PDF options.
 * Extensible for future flags like --format, --margin.
 *
 * @type {import('puppeteer').PDFOptions}
 */
const DEFAULT_PDF_OPTIONS = {
  format: 'A4',
  printBackground: true,
  preferCSSPageSize: true,
};

/** @param {string} line */
const toStderr = (line) => process.stderr.write(`${line}\n`);

/**
 * Render an HTML string to a PDF buffer.
 *
 * @param {string} html  The complete HTML document.
 * @param {Object} [options]
 * @param {import('puppeteer').LaunchOptions} [options.launchOptions]
 * @param {import('puppeteer').PDFOptions}     [options.pdfOptions]
 * @returns {Promise<Buffer>}
 */
export async function renderPdf(html, options = {}) {
  const launchOpts = { ...DEFAULT_LAUNCH_OPTIONS, ...options.launchOptions };
  const pdfOpts    = { ...DEFAULT_PDF_OPTIONS,    ...options.pdfOptions };

  let browser;
  try {
    browser = await puppeteer.launch(launchOpts);
    const page = await browser.newPage();

    // Set content and wait for initial document load; Mermaid and KaTeX
    // readiness are awaited explicitly via their completion flags below.
    await page.setContent(html, { waitUntil: 'load' });

    /** The readiness seam: one flag in, its value out. */
    const readFlag = (flag) => page.evaluate((name) => window[name], flag);
    /** Read an error-report array, defaulting to empty. */
    const readReports = (flag) => page.evaluate((name) => window[name] || [], flag);

    await waitForReadiness(readFlag, READINESS_FLAGS.mermaidRenderDone, {
      label: 'Mermaid diagrams',
    });
    checkErrorReports(await readReports(READINESS_FLAGS.mermaidErrors), {
      runtime: 'Mermaid',
      noun: 'Mermaid diagram',
      sink: toStderr,
    });

    await waitForReadiness(readFlag, READINESS_FLAGS.mathRenderDone, {
      label: 'KaTeX math',
    });
    checkErrorReports(await readReports(READINESS_FLAGS.mathErrors), {
      runtime: 'KaTeX',
      noun: 'math expression',
      sink: toStderr,
    });

    if (process.env.MD_TO_PDF_DEBUG) {
      const mermaidDebug = await readReports(READINESS_FLAGS.mermaidDebug);
      process.stderr.write(`[renderPdf()] Mermaid debug: ${JSON.stringify(mermaidDebug)}\n`);
    }

    // Generate the PDF.
    const pdfBuffer = await page.pdf(pdfOpts);
    return Buffer.from(pdfBuffer);
  } catch (err) {
    if (err instanceof RenderError) throw err;
    throw new RenderError(
      `Failed to render PDF: ${err.message}`
    );
  } finally {
    if (browser) await browser.close();
  }
}
