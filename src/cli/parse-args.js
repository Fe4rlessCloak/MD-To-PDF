/**
 * @file Parse CLI arguments into a structured options object.
 *
 * Expected usage:
 *   node convert.js <input.md> <output.pdf> [--style <path>]
 *
 * Extensible for future flags:
 *   --format <A4|letter|...>
 *   --margin <css-margin>
 *   --mermaid-config <json>
 *   --title <string>
 */

import { InputError } from '../core/errors.js';

/**
 * @typedef {Object} CliOptions
 * @property {string}  input      Path to the input Markdown file.
 * @property {string}  output     Path for the generated PDF.
 * @property {string|null} style  Path to an optional CSS stylesheet.
 */

/**
 * Parse `process.argv` into a validated options object.
 * @param {string[]} argv  Typically `process.argv.slice(2)`.
 * @returns {CliOptions}
 */
export function parseArgs(argv) {
  if (argv.length < 2) {
    throw new InputError(
      'Usage: node convert.js <input.md> <output.pdf> [--style <path>]'
    );
  }

  const input = argv[0];
  const output = argv[1];

  if (!input || !output) {
    throw new InputError(
      'Both input and output file paths are required.\n' +
      '  Usage: node convert.js <input.md> <output.pdf> [--style <path>]'
    );
  }

  let style = null;

  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case '--style':
        style = argv[++i];
        if (!style) {
          throw new InputError('The --style flag requires a file path argument.');
        }
        break;
      default:
        // Silently skip unknown flags for forward compatibility.
        break;
    }
  }

  return { input, output, style };
}
