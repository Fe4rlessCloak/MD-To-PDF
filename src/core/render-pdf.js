/**
 * @file Launch Puppeteer, render the HTML document, wait for Mermaid
 * diagrams and KaTeX math to finish rendering, and export the PDF.
 */

import puppeteer from 'puppeteer';
import { RenderError } from './errors.js';

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

    // Set content and wait for network to settle (CDN assets load).
    await page.setContent(html, { waitUntil: 'networkidle0' });

    // Wait for Mermaid to finish rendering.
    const mermaidDone = await waitForFlag(page, '__MERMAID_RENDER_DONE__', 'Mermaid');
    if (!mermaidDone) {
      throw new RenderError(
        'Mermaid diagrams did not finish rendering within 30 seconds.'
      );
    }

    // Wait for KaTeX to finish rendering.
    const mathDone = await waitForFlag(page, '__MATH_RENDER_DONE__', 'KaTeX');
    if (!mathDone) {
      throw new RenderError(
        'KaTeX math did not finish rendering within 30 seconds.'
      );
    }

    const mermaidDebug = await page.evaluate(() => window.__MERMAID_DEBUG__ || []);
    process.stdout.write(`[renderPdf()] Mermaid debug: ${JSON.stringify(mermaidDebug)}\n`);

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
