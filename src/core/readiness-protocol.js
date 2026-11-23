/**
 * @file Single source of truth for the browser-side readiness protocol.
 *
 * The PDF pipeline is split across two languages: a program injected into the
 * page publishes flags on `window`, and the renderer in Node polls for them.
 * Both halves must agree on the same spellings. Defining the names here — once
 * — means a rename breaks a test rather than silently timing out every PDF.
 *
 * This module owns the *names*. Polling and error classification are the
 * renderer's business (see `render-pdf.js`); publishing is the injected
 * program's business (see `build-html.js`).
 */

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
 * Emit the protocol as JavaScript source, for inclusion in the injected
 * browser program.
 *
 * The injected scripts are module scripts, so each one declares its own
 * `RF` binding from this source rather than reaching across a shared global.
 * Callers inline the returned text into a `<script>` element; it must
 * therefore never contain a closing script sequence.
 *
 * @returns {string} JavaScript declaring `const RF` bound to the flag names.
 */
export function readinessFlagsSource() {
  const entries = Object.entries(READINESS_FLAGS)
    .map(([key, name]) => `  ${key}: ${JSON.stringify(name)},`)
    .join('\n');

  return `const RF = Object.freeze({\n${entries}\n});`;
}
