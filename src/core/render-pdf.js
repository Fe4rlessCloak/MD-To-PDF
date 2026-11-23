/**
 * @file Launch Puppeteer, render the HTML document, wait for Mermaid
 * diagrams and KaTeX math to finish rendering, and export the PDF.
 */

import puppeteer from 'puppeteer';
import { RenderError } from './errors.js';
import { READINESS_FLAGS } from './readiness-protocol.js';

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

/**
 * Wait for a browser-side rendering flag to become true.
 *
 * @param {import('puppeteer').Page} page
 * @param {string} flagName  Global variable name to poll for.
 * @param {string} label     Human-readable label for error messages.
 * @param {number} [timeoutMs=30_000]
 * @returns {Promise<boolean>}  Whether the flag was set before timeout.
 */
async function waitForFlag(page, flagName, label, timeoutMs = 30_000) {
  return page.evaluate(({ flag, label, timeout }) => {
    if (window[flag]) return true;

    return new Promise((resolve) => {
      const check = setInterval(() => {
        if (window[flag]) {
          clearInterval(check);
          resolve(true);
        }
      }, 100);
      setTimeout(() => {
        clearInterval(check);
        resolve(false);
      }, timeout);
    });
  }, { flag: flagName, label, timeout: timeoutMs });
}

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

    // Wait for Mermaid to finish rendering.
    const mermaidDone = await waitForFlag(page, READINESS_FLAGS.mermaidRenderDone, 'Mermaid');
    if (!mermaidDone) {
      throw new RenderError(
        'Mermaid diagrams did not finish rendering within 30 seconds.'
      );
    }

    // Fail fast on Mermaid bootstrap/CDN failure; warn on per-diagram syntax errors.
    const mermaidErrors = await page.evaluate((flags) => window[flags.mermaidErrors] || [], READINESS_FLAGS);
    const mermaidFatal = mermaidErrors.find((e) => e.index === -1);
    if (mermaidFatal) {
      throw new RenderError(
        `Failed to load Mermaid runtime: ${mermaidFatal.error}`
      );
    }
    if (mermaidErrors.length > 0) {
      process.stderr.write(
        `[renderPdf()] Warning: ${mermaidErrors.length} Mermaid diagram(s) failed to render:\n`
      );
      for (const entry of mermaidErrors) {
        process.stderr.write(`  - diagram ${entry.index}: ${entry.error}\n`);
      }
    }

    // Wait for KaTeX to finish rendering.
    const mathDone = await waitForFlag(page, READINESS_FLAGS.mathRenderDone, 'KaTeX');
    if (!mathDone) {
      throw new RenderError(
        'KaTeX math did not finish rendering within 30 seconds.'
      );
    }

    // Fail fast on KaTeX bootstrap/CDN failure; warn on per-expression errors.
    const mathErrors = await page.evaluate((flags) => window[flags.mathErrors] || [], READINESS_FLAGS);
    const mathFatal = mathErrors.find((e) => e.index === -1);
    if (mathFatal) {
      throw new RenderError(
        `Failed to load KaTeX runtime: ${mathFatal.error}`
      );
    }
    if (mathErrors.length > 0) {
      process.stderr.write(
        `[renderPdf()] Warning: ${mathErrors.length} math expression(s) failed to render:\n`
      );
      for (const entry of mathErrors) {
        process.stderr.write(`  - ${entry.kind} ${entry.index}: ${entry.error}\n`);
      }
    }

    if (process.env.MD_TO_PDF_DEBUG) {
      const mermaidDebug = await page.evaluate((flags) => window[flags.mermaidDebug] || [], READINESS_FLAGS);
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
