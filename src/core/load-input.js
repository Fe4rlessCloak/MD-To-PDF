/**
 * @file Read Markdown input and optional CSS file from disk.
 */

import { readFile } from 'node:fs/promises';
import { InputError } from './errors.js';

/**
 * Read the Markdown source file.
 * @param {string} path
 * @returns {Promise<string>}
 */
export async function readMarkdown(path) {
  try {
    return await readFile(path, 'utf-8');
  } catch (err) {
    throw new InputError(
      `Cannot read Markdown file "${path}": ${err.message}`
    );
  }
}

/**
 * Read an optional CSS stylesheet from disk.
 * Returns `null` when no path is provided.
 * @param {string|null} path
 * @returns {Promise<string|null>}
 */
export async function readStylesheet(path) {
  if (!path) return null;
  try {
    return await readFile(path, 'utf-8');
  } catch (err) {
    throw new InputError(
      `Cannot read stylesheet "${path}": ${err.message}`
    );
  }
}
