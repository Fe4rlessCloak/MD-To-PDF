/**
 * @file Own the complete set of document options and their defaults.
 *
 * This is the seam between the CLI and document assembly. The argument
 * parser fills an options object through this module, and HTML assembly
 * consumes it whole, so adding an option is one edit here rather than
 * edits at every call site.
 */

import { InputError } from './errors.js';

/**
 * @typedef {Object} DocumentOptions
 * @property {string|null} input   Path to the input Markdown file.
 * @property {string|null} output  Path for the generated PDF.
 * @property {string|null} style   Path to an optional CSS stylesheet.
 * @property {string|null} title   Document title for `<title>` and PDF metadata.
 */

/**
 * Every option a document can carry, with its default value.
 *
 * A new option is added here; the parser and assembly pick it up by key.
 *
 * @type {Readonly<{
 *   input: string|null,
 *   output: string|null,
 *   style: string|null,
 *   title: string|null,
 * }>}
 */
export const DOCUMENT_OPTION_DEFAULTS = Object.freeze({
  /** Path to the input Markdown file. */
  input: null,
  /** Path for the generated PDF. */
  output: null,
  /** Path to an optional CSS stylesheet. */
  style: null,
  /** Document title, used for the HTML `<title>` and the PDF metadata. */
  title: null,
});

/**
 * CLI flag spelling for each option, so the parser is a lookup rather
 * than a branch per option.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const DOCUMENT_OPTION_FLAGS = Object.freeze({
  '--style': 'style',
  '--title': 'title',
});

/**
 * Options that are documented as forthcoming but not built yet.
 *
 * They are rejected loudly instead of accepted and ignored, so that the set
 * of documented options and the set of implemented options cannot drift.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const UNIMPLEMENTED_OPTIONS = Object.freeze({
  '--format': 'page size',
  '--margin': 'page margin',
});

/**
 * Build a complete document options object from a partial set of values.
 *
 * Missing values fall back to {@link DOCUMENT_OPTION_DEFAULTS}. A key the
 * module does not own is a programming error at the seam, and is rejected
 * rather than silently carried along.
 *
 * @param {Partial<typeof DOCUMENT_OPTION_DEFAULTS>} [values]
 * @returns {typeof DOCUMENT_OPTION_DEFAULTS}
 */
export function createDocumentOptions(values = {}) {
  for (const key of Object.keys(values)) {
    if (!Object.hasOwn(DOCUMENT_OPTION_DEFAULTS, key)) {
      throw new InputError(
        `Unknown document option "${key}". ` +
          `Known options: ${Object.keys(DOCUMENT_OPTION_DEFAULTS).join(', ')}.`
      );
    }
  }

  return { ...DOCUMENT_OPTION_DEFAULTS, ...values };
}

/**
 * Build the error used when a documented-but-unimplemented option is passed.
 *
 * @param {string} flag  The offending flag, including its leading dashes.
 * @returns {InputError}
 */
export function unimplementedOptionError(flag) {
  const subject = UNIMPLEMENTED_OPTIONS[flag];
  const label = subject ? ` (${subject})` : '';
  return new InputError(
    `The ${flag} option${label} is not yet implemented. ` +
      `Remove ${flag} from the command line; it will be supported in a future release.`
  );
}
