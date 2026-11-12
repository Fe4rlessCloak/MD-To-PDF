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
  const positional = [];
  let style = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--style') {
      const next = argv[++i];
      if (!next || next.startsWith('-')) {
        throw new InputError('The --style flag requires a file path argument.');
      }
      style = next;
    } else if (arg.startsWith('--style=')) {
      const value = arg.slice('--style='.length);
      if (!value) {
        throw new InputError('The --style flag requires a file path argument.');
      }
      style = value;
    } else if (arg.startsWith('-')) {
      // Silently skip unknown flags for forward compatibility.
    } else {
      positional.push(arg);
    }
  }

  if (positional.length < 2) {
    throw new InputError(
      'Usage: node convert.js <input.md> <output.pdf> [--style <path>]'
    );
  }

  const [input, output] = positional;

  if (!input || !output) {
    throw new InputError(
      'Both input and output file paths are required.\n' +
      '  Usage: node convert.js <input.md> <output.pdf> [--style <path>]'
    );
  }

  return { input, output, style };
}
