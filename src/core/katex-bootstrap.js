/**
 * @file The KaTeX browser program.
 *
 * This file is executed in two places, and it has to be a real module in both:
 *
 * - **In the browser**, its source text is inlined into a module script by
 *   `build-html.js`, followed by a call to {@link runKatexBootstrap}. That is
 *   what lets the document stay a single self-contained file and keeps
 *   top-level await legal.
 * - **In tests**, it is imported by Node so the per-expression error
 *   isolation and the Mermaid-sequencing rule can be exercised directly
 *   instead of through a substring match on an assembly template.
 *
 * Importing it therefore publishes nothing and touches no DOM: every side
 * effect lives behind {@link runKatexBootstrap}, and every DOM collaborator
 * arrives as an injected parameter. The module deliberately imports no Node
 * built-ins, because its source text is also browser code.
 *
 * It also owns the only two places the KaTeX CDN version is written. Both URLs
 * are derived from {@link KATEX_VERSION}, so the stylesheet the document links
 * and the runtime it imports can never disagree about which version they mean.
 */

/**
 * The KaTeX release the document targets.
 *
 * Written once, here, and consumed by both URL builders below. The `katex`
 * entry in `package.json` is kept as the declared pin for the same version so
 * that the dependency audit and the CDN URL stay in step; nothing imports the
 * npm package at runtime, because the browser loads this version from the CDN.
 *
 * @type {string}
 */
export const KATEX_VERSION = '0.16.11';

/**
 * Where the runtime comes from — the ESM build, so the document can `import()`
 * it without a bundler.
 *
 * @type {string}
 */
export const KATEX_SCRIPT_URL =
  `https://cdn.jsdelivr.net/npm/katex@${KATEX_VERSION}/dist/katex.mjs`;

/**
 * Where the glyph stylesheet comes from. KaTeX ships its fonts as separate
 * files and the stylesheet is what references them, so it has to be linked
 * even though the runtime is imported.
 *
 * @type {string}
 */
export const KATEX_STYLESHEET_URL =
  `https://cdn.jsdelivr.net/npm/katex@${KATEX_VERSION}/dist/katex.min.css`;

/**
 * Report kind for a failure that is not one expression: the runtime itself.
 *
 * @type {string}
 */
export const BOOTSTRAP_REPORT_KIND = 'bootstrap';

/**
 * Normalise the message of a thrown value.
 * @param {unknown} err
 * @returns {string}
 */
function messageOf(err) {
  return err && err.message ? err.message : String(err);
}

/**
 * Typeset one math node, isolating its failure.
 *
 * Extracted from the loop so the isolation rule is stated once and can be
 * called directly: a node that will not parse keeps its raw LaTeX — so the
 * reader sees the source that failed instead of a blank gap — and its failure
 * becomes a report rather than an exception. Returning the report instead of
 * pushing it keeps the function total and side-effect-free apart from the node
 * it was given.
 *
 * @param {{render: Function}} katex  The KaTeX runtime.
 * @param {{textContent: string, innerHTML: string}} el  The math node.
 * @param {Object} params
 * @param {boolean} params.displayMode  True for block math.
 * @param {number}  params.index        Position in the whole expression sequence.
 * @returns {{index: number, kind: string, error: string}|null} A report on
 *   failure, or `null` when the expression typeset.
 */
export function renderExpression(katex, el, { displayMode, index }) {
  const raw = el.textContent;
  try {
    katex.render(raw, el, { displayMode, throwOnError: true });
    return null;
  } catch (err) {
    el.textContent = raw;
    return {
      index,
      kind: displayMode ? 'display' : 'inline',
      error: messageOf(err),
    };
  }
}

/**
 * Default runtime loader: a dynamic CDN import.
 *
 * The specifier comes from {@link KATEX_SCRIPT_URL}, so the import is only
 * attempted when a document actually contains math. Tests replace this with a
 * stub via the `loadRuntime` parameter.
 *
 * @returns {Promise<{render: Function}>}
 */
export async function loadKatexFromCdn() {
  const { default: katex } = await import(KATEX_SCRIPT_URL);
  return katex;
}

/**
 * Entry point of the browser program: typeset every math node and publish
 * readiness through the protocol.
 *
 * This is the function that used to be the body of an injected module script.
 *
 * Sequencing is the load-bearing part. KaTeX and Mermaid both mutate the DOM of
 * the same document, and mutating it while Mermaid is still measuring its
 * diagrams corrupts the layout that follows them. So the program waits on the
 * Mermaid readiness promise — a promise, not a poll, so there is no interval to
 * tune — before it queries a single math node. When no Mermaid bootstrap ran
 * there is nothing on the flag and the program proceeds immediately.
 *
 * Failure modes are deliberate and separate, and mirror the Mermaid program's:
 *
 * - A single unparseable expression keeps its raw LaTeX and becomes an entry in
 *   the error array; the remaining expressions still typeset.
 * - Anything else — the runtime failing to load, the readiness promise
 *   rejecting — is one entry carrying `fatalReportIndex`, which the renderer
 *   classifies as fatal rather than a warning.
 * - Either way the render-done flag is published in `finally`, so the renderer
 *   reports the error it has instead of timing out.
 *
 * @param {Object} params
 * @param {{[key: string]: string}} params.flags  The readiness protocol's flag names.
 * @param {number} params.fatalReportIndex  Index marking a runtime-load failure.
 * @param {Object} [params.win=globalThis]   Global object the flags are published on.
 * @param {Document} [params.doc]            Document to render into; defaults to `win.document`.
 * @param {() => Promise<Object>} [params.loadRuntime]  Runtime loader; defaults to the CDN import.
 * @returns {Promise<void>}
 * @throws {Error} When the protocol handle or the fatal index is missing — both
 *   are interface requirements, not optional behaviour, so they fail loudly
 *   before any DOM mutation instead of publishing flags nobody reads.
 */
export async function runKatexBootstrap({
  flags,
  fatalReportIndex,
  win,
  doc,
  loadRuntime = loadKatexFromCdn,
} = {}) {
  if (!flags || typeof flags !== 'object') {
    throw new Error('runKatexBootstrap requires the readiness protocol flags.');
  }
  if (typeof fatalReportIndex !== 'number') {
    throw new Error('runKatexBootstrap requires the protocol fatal-report index.');
  }

  const view = win ?? globalThis;
  const document_ = doc ?? view.document;

  view[flags.mathErrors] = [];

  try {
    // Wait deterministically for Mermaid to finish before mutating the DOM.
    if (view[flags.mermaidReady]) {
      await view[flags.mermaidReady];
    }

    const displayNodes = document_.querySelectorAll('.math-display');
    const inlineNodes = document_.querySelectorAll('.math-inline');

    if (displayNodes.length > 0 || inlineNodes.length > 0) {
      const katex = await loadRuntime();

      // One index across both sequences, so a report's index is the position
      // of the expression in the document rather than in its own kind.
      let index = 0;
      for (const el of displayNodes) {
        const report = renderExpression(katex, el, { displayMode: true, index });
        if (report) view[flags.mathErrors].push(report);
        index++;
      }
      for (const el of inlineNodes) {
        const report = renderExpression(katex, el, { displayMode: false, index });
        if (report) view[flags.mathErrors].push(report);
        index++;
      }
    }
  } catch (err) {
    view[flags.mathErrors].push({
      index: fatalReportIndex,
      kind: BOOTSTRAP_REPORT_KIND,
      error: messageOf(err),
    });
  } finally {
    // Signal that math rendering is complete, even on failure.
    view[flags.mathRenderDone] = true;
  }
}
