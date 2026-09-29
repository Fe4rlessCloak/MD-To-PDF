/**
 * @file Custom error classes and exit-code helpers for the CLI.
 */

export class CliError extends Error {
  /**
   * @param {string} message  Human-readable error description.
   * @param {number} [exitCode=1]  Process exit code.
   */
  constructor(message, exitCode = 1) {
    super(message);
    this.name = 'CliError';
    this.exitCode = exitCode;
  }
}

export class InputError extends CliError {
  constructor(message) {
    super(message, 2);
    this.name = 'InputError';
  }
}

export class RenderError extends CliError {
  constructor(message) {
    super(message, 3);
    this.name = 'RenderError';
  }
}

/**
 * Print an error message to stderr and exit the process.
 * @param {CliError} err
 */
export function fatal(err) {
  process.stderr.write(`\n  ✘ ${err.message}\n\n`);
  process.exit(err.exitCode);
}
