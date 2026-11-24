/**
 * @file Single source of truth for the browser-side readiness protocol.
 *
 * The PDF pipeline is split across two languages: a program injected into the
 * page publishes flags on `window`, and the renderer in Node polls for them.
 * Both halves must agree on the same spellings. Defining the names here — once
 * — means a rename breaks a test rather than silently timing out every PDF.
 *
 * It owns the names, the publish helper used by the injected programs, the
 * waiting step, and the classification of an error report into a fatal outcome
 * versus warnings. Both waiting and classification take their collaborator by
 * injection — a page evaluator for waiting, a report array for classification
 * — so the renderer can be a thin adapter over a real page and tests can be a
 * scripted fake.
 */

import { RenderError } from './errors.js';

/**
 * The six readiness globals the pipeline depends on.
 *
 * Keys are the protocol's vocabulary — consumers reference flags by key, never
 * by literal — and values are the actual `window` properties.
 *
 * `mermaidDebug` is published but never polled; it carries print-layout
 * diagnostics read on demand, so the asymmetry is intentional.
 *
 * @type {Readonly<{
 *   mermaidReady:      string,
 *   mermaidErrors:     string,
 *   mermaidDebug:      string,
 *   mermaidRenderDone: string,
 *   mathErrors:        string,
 *   mathRenderDone:    string,
 * }>}
 */
export const READINESS_FLAGS = Object.freeze({
  /** Promise resolved once the Mermaid bootstrap has finished, successfully or not. */
  mermaidReady: '__MERMAID_READY__',
  /** Array of `{ index, error }` entries; `index === -1` means the runtime failed to load. */
  mermaidErrors: '__MERMAID_ERRORS__',
  /** Array of per-diagram layout measurements, for print diagnosis only. */
  mermaidDebug: '__MERMAID_DEBUG__',
  /** True once the Mermaid bootstrap is finished. */
  mermaidRenderDone: '__MERMAID_RENDER_DONE__',
  /** Array of `{ index, kind, error }` entries; `index === -1` means a failed runtime load. */
  mathErrors: '__MATH_ERRORS__',
  /** True once the KaTeX bootstrap is finished. */
  mathRenderDone: '__MATH_RENDER_DONE__',
});

/**
 * How often the renderer re-checks a readiness flag, in milliseconds.
 *
 * Owned here rather than at the call site so that the poll cadence is a
 * property of the protocol, not of one renderer.
 *
 * @type {number}
 */
export const READINESS_POLL_INTERVAL_MS = 100;

/**
 * How long the renderer waits for a readiness flag before failing, in
 * milliseconds.
 *
 * @type {number}
 */
export const READINESS_TIMEOUT_MS = 30_000;

/**
 * The `index` a report carries when the failure is not one diagram or
 * expression but the runtime itself: a CDN load that never happened.
 *
 * Reports with this index are fatal; every other report is a warning about a
 * single bad diagram or expression. Naming it here means call sites compare
 * against a meaning rather than re-deriving what minus one stands for.
 *
 * @type {number}
 */
export const FATAL_REPORT_INDEX = -1;

/** @param {number} ms @returns {Promise<void>} */
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Wait until a readiness flag is truthy, or fail with a `RenderError`.
 *
 * The page is injected as an evaluator — `(flagName) => Promise<unknown>` — so
 * this function has no browser of its own. The real adapter is
 * `(flag) => page.evaluate(...)`; the test adapter is a scripted fake.
 *
 * @param {(flagName: string) => Promise<unknown>} evaluate
 * @param {string} flagName  Global name from {@link READINESS_FLAGS}.
 * @param {Object} [options]
 * @param {string} [options.label=flagName]   What is being waited for, used in the timeout message.
 * @param {number} [options.pollIntervalMs=READINESS_POLL_INTERVAL_MS]
 * @param {number} [options.timeoutMs=READINESS_TIMEOUT_MS]
 * @returns {Promise<true>}
 * @throws {RenderError} If the flag is still falsy when the timeout elapses.
 */
export async function waitForReadiness(evaluate, flagName, options = {}) {
  const {
    label = flagName,
    pollIntervalMs = READINESS_POLL_INTERVAL_MS,
    timeoutMs = READINESS_TIMEOUT_MS,
  } = options;

  const deadline = Date.now() + timeoutMs;

  for (;;) {
    if (await evaluate(flagName)) return true;
    if (Date.now() >= deadline) break;
    await delay(pollIntervalMs);
  }

  throw new RenderError(
    `${label} did not finish rendering within ${timeoutMs / 1000} seconds.`
  );
}

/**
 * One failure report published by a bootstrap.
 *
 * The shape both browser programs push onto an error-report array, and what
 * the classification and description steps below consume. Declared once
 * because it crosses the language seam: the programs are browser code, the
 * readers are Node, and a field renamed on one side must be renamed on both.
 *
 * @typedef {Object} ReadinessReport
 * @property {number} index        Position of the diagram or expression in its document;
 *                                 {@link FATAL_REPORT_INDEX} when the runtime itself failed.
 * @property {string} [kind]       What failed, when the producing program distinguishes
 *                                 kinds (e.g. `display`, `inline`, `bootstrap`).
 * @property {string} error        Human-readable failure message.
 */

/**
 * Split a set of error reports into the fatal one, if any, and the warnings.
 *
 * Pure: same reports in, same classification out, no printing and no throwing.
 *
 * @param {ReadinessReport[]} [reports]
 * @returns {{ fatal: ReadinessReport|null, warnings: ReadinessReport[] }}
 */
export function classifyErrorReports(reports) {
  const all = Array.isArray(reports) ? reports : [];
  const fatal = all.find((entry) => entry.index === FATAL_REPORT_INDEX) ?? null;
  const warnings = all.filter((entry) => entry.index !== FATAL_REPORT_INDEX);
  return { fatal, warnings };
}

/**
 * One report as a line of text, e.g. `diagram 2: bad` or `inline 4: bad`.
 *
 * The noun used when a report carries no `kind` is a parameter, not a default
 * baked in here: this module is shared by two bootstraps with different
 * vocabularies, and naming one consumer's noun would put its words in the
 * other's output.
 *
 * @param {ReadinessReport} entry
 * @param {string} [fallbackKind='report']  Noun for a report with no `kind`.
 * @returns {string}
 */
export function describeReport(entry, fallbackKind = 'report') {
  return `${entry.kind ?? fallbackKind} ${entry.index}: ${entry.error}`;
}

/**
 * Apply a classification: throw on a fatal report, otherwise report each
 * warning through the injected sink.
 *
 * This is the renderer-facing adapter over {@link classifyErrorReports}; it
 * exists so the renderer has no fatal-versus-warning branch of its own. The
 * sink takes one complete line, so tests can collect lines instead of
 * intercepting stderr. It returns nothing: the outcome is the throw or the
 * lines written, and a caller that wants the classification itself asks
 * {@link classifyErrorReports}.
 *
 * @param {ReadinessReport[]} [reports]
 * @param {Object} options
 * @param {string} options.runtime     Runtime name for the fatal message, e.g. `Mermaid`.
 * @param {string} options.noun        What one warning concerns, e.g. `math expression`.
 * @param {string} [options.reportKind='report']  Noun for a warning line with no `kind`.
 * @param {string} [options.prefix='Warning']     Leading label for the warning header line.
 * @param {(line: string) => void} options.sink
 * @returns {void}
 * @throws {RenderError} When a report carries {@link FATAL_REPORT_INDEX}.
 */
export function checkErrorReports(
  reports,
  { runtime, noun, reportKind = 'report', prefix = 'Warning', sink },
) {
  const { fatal, warnings } = classifyErrorReports(reports);

  if (fatal) {
    throw new RenderError(`Failed to load ${runtime} runtime: ${fatal.error}`);
  }

  if (warnings.length > 0) {
    sink(`${prefix}: ${warnings.length} ${noun}(s) failed to render:`);
    for (const entry of warnings) sink(`  - ${describeReport(entry, reportKind)}`);
  }
}

/**
 * Publish a readiness flag value on a target object through the protocol.
 *
 * Rejects unknown flag keys loudly instead of writing `undefined` properties.
 *
 * @template T
 * @param {Object} target
 * @param {string} key     Key in `flags`.
 * @param {T} value
 * @param {{[key: string]: string}} [flags=READINESS_FLAGS]
 * @returns {T}
 */
export function publishFlag(target, key, value, flags = READINESS_FLAGS) {
  if (!Object.hasOwn(flags, key)) {
    throw new Error(`Unknown readiness flag "${String(key)}".`);
  }
  target[flags[key]] = value;
  return value;
}

/**
 * Emit the protocol as JavaScript source, for inclusion in the injected
 * browser program.
 *
 * The injected scripts are module scripts, so each one declares its own
 * `RF` and `publishFlag` bindings from this source rather than reaching across
 * a shared global. Callers inline the returned text into a `<script>` element;
 * it must therefore never contain a closing script sequence.
 *
 * @returns {string} JavaScript declaring `const RF` and `publishFlag`.
 */
export function readinessFlagsSource() {
  const entries = Object.entries(READINESS_FLAGS)
    .map(([key, name]) => `  ${key}: ${JSON.stringify(name)},`)
    .join('\n');

  return [
    `const RF = Object.freeze({\n${entries}\n});`,
    `function publishFlag(target, key, value) {`,
    `  if (!Object.hasOwn(RF, key)) {`,
    `    throw new Error(\`Unknown readiness flag "\${String(key)}".\`);`,
    `  }`,
    `  target[RF[key]] = value;`,
    `  return value;`,
    `}`,
  ].join('\n');
}
