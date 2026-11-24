import { readFile, readdir } from 'node:fs/promises';
import { stripComments } from '../../src/core/mermaid-styles/mermaid-styles.js';

const STYLES_DIR = new URL('../../styles/', import.meta.url);

/**
 * Discover every bundled theme stylesheet in `styles/` dynamically.
 *
 * @returns {Promise<string[]>} Theme file names, sorted for stable messages.
 */
export async function bundledThemes() {
  const entries = await readdir(STYLES_DIR);
  return entries.filter((name) => name.endsWith('.css')).sort();
}

/**
 * Read a bundled theme stylesheet, optionally stripping CSS comments.
 *
 * @param {string} name
 * @param {Object} [options]
 * @param {boolean} [options.stripComments=false]
 * @returns {Promise<string>}
 */
export async function readTheme(name, { stripComments: shouldStrip = false } = {}) {
  const css = await readFile(new URL(name, STYLES_DIR), 'utf8');
  return shouldStrip ? stripComments(css) : css;
}
