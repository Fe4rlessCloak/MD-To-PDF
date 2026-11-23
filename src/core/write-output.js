/**
 * @file Write the rendered PDF to disk, classifying failures as input errors.
 *
 * A failure to create the output file is a problem with what the user asked
 * for — a bad path, an unwritable directory — not a rendering failure. It is
 * reported as an `InputError` so the process exits with the input-error code
 * instead of the generic one.
 */

import { writeFile } from 'node:fs/promises';
import { InputError } from './errors.js';

/**
 * Write the PDF buffer to `path`, wrapping filesystem failures as
 * {@link InputError}.
 *
 * @param {string} path    Destination file path.
 * @param {Buffer|Uint8Array} pdfBuffer  Rendered PDF bytes.
 * @returns {Promise<void>}
 * @throws {InputError}  When the file cannot be written.
 */
export async function writePdfOutput(path, pdfBuffer) {
  try {
    await writeFile(path, pdfBuffer);
  } catch (err) {
    const reason = err?.message ?? String(err);
    throw new InputError(
      `Cannot write PDF to "${path}": ${reason}`
    );
  }
}
