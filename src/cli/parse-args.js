/**
 * @file Parse CLI arguments into a document options object.
 *
 * This is an adapter over the document options module: it translates argv
 * into the option keys that module owns, so a new option is declared once
 * in `document-options.js` and wired here by the flag table, never by a new
 * branch in this loop.
 *
 * Usage:
 *   node convert.js <input.md> <output.pdf> [--style <path>] [--title <string>]
 *
 * Options that are documented but not yet built are rejected loudly rather
 * than accepted and ignored.
 */

import { InputError } from '../core/errors.js';
import {
  DOCUMENT_OPTION_FLAGS,
  UNIMPLEMENTED_OPTIONS,
  createDocumentOptions,
  unimplementedOptionError,
} from '../core/document-options.js';

const USAGE =
  'Usage: node convert.js <input.md> <output.pdf> [--style <path>] [--title <string>]';

/**
 * Split a flag argument into its name and inline value, if any.
 * `--style=theme.css` becomes `{ flag: '--style', inlineValue: 'theme.css' }`.
 *
 * @param {string} arg
 * @returns {{ flag: string, inlineValue: string|undefined }}
 */
function splitFlag(arg) {
  const eq = arg.indexOf('=');
  if (eq === -1) return { flag: arg, inlineValue: undefined };
  return { flag: arg.slice(0, eq), inlineValue: arg.slice(eq + 1) };
}

/**
 * Parse `process.argv` into a validated document options object.
 *
 * @param {string[]} argv  Typically `process.argv.slice(2)`.
 * @returns {import('../core/document-options.js').DocumentOptions}
 * @throws {InputError}  On a missing value, an unknown flag, an
 *   unimplemented option, or missing positional arguments.
 */
export function parseArgs(argv) {
  const positional = [];
  const values = {};
  let endOfOptions = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (endOfOptions || !arg.startsWith('-') || arg === '-') {
      positional.push(arg);
      continue;
    }

    if (arg === '--') {
      endOfOptions = true;
      continue;
    }

    const { flag, inlineValue } = splitFlag(arg);

    if (Object.hasOwn(UNIMPLEMENTED_OPTIONS, flag)) {
      throw unimplementedOptionError(flag);
    }

    const key = DOCUMENT_OPTION_FLAGS[flag];
    if (!key) {
      throw new InputError(`Unknown option "${flag}".\n  ${USAGE}`);
    }

    let value = inlineValue;
    if (value === undefined) {
      const next = argv[++i];
      if (!next || next.startsWith('-')) {
        throw new InputError(`The ${flag} flag requires a value.`);
      }
      value = next;
    }

    if (value === '') {
      throw new InputError(`The ${flag} flag requires a value.`);
    }

    values[key] = value;
  }

  if (positional.length < 2) {
    throw new InputError(USAGE);
  }

  const [input, output] = positional;
  values.input = input;
  values.output = output;

  return createDocumentOptions(values);
}
