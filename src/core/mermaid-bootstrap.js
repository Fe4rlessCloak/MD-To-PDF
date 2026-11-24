/**
 * @file The Mermaid browser program.
 *
 * This file is executed in two places, and it has to be a real module in both:
 *
 * - **In the browser**, its source text is inlined into a module script by
 *   `build-html.js`, followed by a call to {@link runMermaidBootstrap}. That
 *   is what lets the document stay a single self-contained file and keeps
 *   top-level await legal.
 * - **In tests**, it is imported by Node so the luminance rule and the
 *   dark-fill decision can be exercised directly instead of through a
 *   substring match on an assembly template.
 *
 * Importing it therefore publishes nothing and touches no DOM: every side
 * effect lives behind {@link runMermaidBootstrap}, and every DOM collaborator
 * arrives as an injected parameter. The module deliberately imports no Node
 * built-ins, because its source text is also browser code.
 */

/**
 * Where the runtime comes from. The only place this URL is written, so the
 * version cannot drift between the program that loads it and a test.
 *
 * @type {string}
 */
export const MERMAID_CDN_URL =
  'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';

/**
 * CSS custom property a theme defines to opt in to label-colour normalisation.
 *
 * The read is a cross-language contract: the theme is a stylesheet, the reader
 * is this program, and they meet at `getComputedStyle` on the root element at
 * render time. A theme that does not define it keeps its author colours.
 *
 * @type {string}
 */
export const NORMALIZE_VARIABLE = '--mermaid-normalize';

/**
 * CSS custom property a theme defines to select Mermaid's built-in theme.
 *
 * Same cross-language contract as {@link NORMALIZE_VARIABLE}, and the same
 * shape of answer: a theme that omits it says "leave Mermaid's own theme
 * alone", and this program then initialises with `base`, the theme Mermaid
 * parameterises from CSS variables. A theme that names a runtime theme — the
 * OLED theme names `dark` — gets that theme for every diagram family at once,
 * including the Gantt bars and state clusters the shared block never paints,
 * because Mermaid itself reads the name before it emits a single colour.
 *
 * **Why a variable and not a document option.** The theme is the thing that
 * knows its own surface: a black sheet needs dark diagram surfaces and a white
 * one does not, and the stylesheet already carries that knowledge as a palette.
 * Threading a theme name from the CLI through assembly to the browser program
 * would give the same fact a second owner that could disagree with the CSS
 * variables sitting beside it.
 *
 * **Read before {@link mermaidInitOptions}, not after render.** Mermaid bakes
 * its theme into the CSS it generates per diagram, so the name has to be known
 * while `mermaid.initialize` runs; a read afterwards would repaint nothing.
 *
 * @type {string}
 */
export const THEME_VARIABLE = '--mermaid-theme';

/**
 * Every root custom property this browser program reads at render time.
 *
 * Published as one list so a theme contract check can tell a property the
 * program owns from one the shared styling block owns, without a second copy
 * of the names: a `--mermaid-*` declaration in a theme that appears here is
 * read by the program, and anything else has to be in `MERMAID_VARIABLES`.
 * Adding a read means adding its name here, and the contract test then knows
 * about it without being edited.
 *
 * A frozen array rather than a `Set`, for the same reason
 * `MERMAID_VARIABLES` is one: `Object.freeze` does not stop `Set.add`, so a
 * frozen `Set` would promise an immutability it cannot deliver.
 *
 * @type {ReadonlyArray<string>}
 */
export const BOOTSTRAP_VARIABLES = Object.freeze([NORMALIZE_VARIABLE, THEME_VARIABLE]);

/**
 * Theme Mermaid initialises with when no theme selects one.
 *
 * `base` is Mermaid's variable-driven theme rather than one of its fixed
 * palettes: it is what lets a diagram inherit a theme's fonts and colours
 * through the shared block. Naming it here keeps the default in one place
 * instead of a literal at the call site and another in the options factory.
 *
 * @type {string}
 */
export const DEFAULT_MERMAID_THEME = 'base';

/**
 * Read a root custom property and normalise its value.
 *
 * The two properties this program reads from the root are both strings, and
 * both mean "nothing declared" when the computed value is empty or whitespace
 * — a stylesheet declaring `--x: ;` is read back as empty by
 * `getPropertyValue`. Trimming first is what makes an empty declaration and an
 * absent one the same answer here, rather than one of them becoming a theme
 * named `''`. A caller that needs a different fallback applies it to the
 * returned string.
 *
 * @param {CSSStyleDeclaration} rootStyle  Computed style of the root element.
 * @param {string} name  Custom property name, e.g. `--mermaid-theme`.
 * @param {string} [fallback]  Value to use when the property is unset or empty.
 * @returns {string}
 */
export function rootVariableValue(rootStyle, name, fallback = '') {
  const value = rootStyle.getPropertyValue(name).trim();
  return value === '' ? fallback : value;
}

/**
 * Ink forced onto labels sitting on a dark author-supplied fill.
 *
 * @type {string}
 */
export const LABEL_LIGHT_COLOR = '#ffffff';

/**
 * Luminance below which a fill counts as dark, on the 0–255 scale of the
 * YIQ weighting below.
 *
 * @type {number}
 */
export const DARK_LUMINANCE_THRESHOLD = 128;

/**
 * Mermaid initialisation options.
 *
 * Returned rather than hoisted into a constant so a caller cannot mutate the
 * shared object. `theme` is a parameter because it is the one option a theme
 * decides: `base` is what makes diagrams inherit fonts and CSS variables from
 * the document, and a theme that names a built-in theme — OLED picks `dark` —
 * gets that theme's own palette for every diagram family. The default is
 * {@link DEFAULT_MERMAID_THEME} rather than a literal here, so the fallback is
 * stated once.
 *
 * @param {string} [theme=DEFAULT_MERMAID_THEME]  Resolved Mermaid theme name.
 * @returns {Object} A fresh options object for `mermaid.initialize`.
 */
export function mermaidInitOptions(theme = DEFAULT_MERMAID_THEME) {
  return {
    startOnLoad: false,
    theme,
    securityLevel: 'loose',
    suppressErrorRendering: true,
    flowchart: {
      htmlLabels: false,
    },
    sequence: {
      useMaxWidth: true,
      htmlLabels: false,
    },
    gantt: {
      useMaxWidth: true,
    },
  };
}

/**
 * YIQ luminance test for a computed `fill` value.
 *
 * Browsers always hand back `rgb(...)` or `rgba(...)` from
 * `getComputedStyle`, so anything else — `none`, a keyword, an empty string,
 * a non-string — is not a measurable colour and is reported as light. That
 * keeps the caller's rule total without a second branch.
 *
 * @param {string} color  Computed colour, e.g. `rgb(20, 24, 40)`.
 * @returns {boolean} True when the colour is dark enough to need light ink.
 */
export function isDarkColor(color) {
  const m = typeof color === 'string'
    ? color.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i)
    : null;
  if (!m) return false;
  const luminance = 0.299 * Number(m[1]) + 0.587 * Number(m[2]) + 0.114 * Number(m[3]);
  return luminance < DARK_LUMINANCE_THRESHOLD;
}

/**
 * The labelling decision for one node shape: does its author fill require
 * light ink, and if so, which.
 *
 * Separated from the DOM loop so the rule can be stated once and tested
 * without a browser. Returning `null` rather than the existing colour is what
 * makes "leave it alone" an explicit outcome instead of a no-op.
 *
 * @param {string} fill  Computed `fill` of the node's shape.
 * @returns {string|null} The ink to force, or null to keep the author's.
 */
export function labelColorFor(fill) {
  return isDarkColor(fill) ? LABEL_LIGHT_COLOR : null;
}

/**
 * Normalise the message of a thrown value.
 * @param {unknown} err
 * @returns {string}
 */
function messageOf(err) {
  return err && err.message ? err.message : String(err);
}

/**
 * Strip Mermaid's inline text colours and force light ink onto labels whose
 * author fill is dark.
 *
 * Mermaid compiles `style ... color:` directives into inline `!important`
 * declarations, which outrank every stylesheet rule — including `!important`
 * ones. Removing them is the only way a theme can govern label text. Author
 * *fills* are left intact, which is why the dark ones are compensated instead
 * of being stripped too.
 *
 * @param {Document} doc
 * @param {(el: Element) => CSSStyleDeclaration} computedStyle
 * @returns {void}
 */
export function normalizeLabelColors(doc, computedStyle) {
  doc.querySelectorAll('.mermaid svg [style]').forEach((el) => {
    el.style.removeProperty('color');
  });

  doc.querySelectorAll('.mermaid svg .node').forEach((node) => {
    const shape = node.querySelector('.label-container, rect, circle, ellipse, polygon, path');
    if (!shape) return;

    const ink = labelColorFor(computedStyle(shape).fill);
    if (!ink) return;

    node.querySelectorAll('text, tspan, .label, .nodeLabel').forEach((label) => {
      label.style.setProperty('fill', ink, 'important');
      label.style.setProperty('color', ink, 'important');
    });
  });
}

/**
 * Collect print-layout measurements for each diagram container.
 *
 * Published on the debug flag and never polled; the data exists so a layout
 * regression can be diagnosed from a real render.
 *
 * These are diagnostics, not failure reports: they carry measurements rather
 * than an error message, so they are not {@link
 * import('./readiness-protocol.js').ReadinessReport}s.
 *
 * @param {Document} doc
 * @returns {Array<Object>}
 */
export function collectDebugReports(doc) {
  return Array.from(doc.querySelectorAll('.mermaid')).map((node, index) => {
    const svg = node.querySelector('svg');
    const foreignObjects = svg ? svg.querySelectorAll('foreignObject').length : 0;
    const nodeRect = node.getBoundingClientRect();
    const svgRect = svg ? svg.getBoundingClientRect() : null;

    return {
      index,
      foreignObjects,
      container: { width: nodeRect.width, height: nodeRect.height },
      svg: svgRect ? { width: svgRect.width, height: svgRect.height } : null,
    };
  });
}

/**
 * Default runtime loader: a dynamic CDN import.
 *
 * The specifier is computed from {@link MERMAID_CDN_URL}, so the import is
 * only attempted when a document actually contains diagrams. Tests replace
 * this with a stub via the `loadRuntime` parameter.
 *
 * @returns {Promise<{initialize: Function, render: Function}>}
 */
export async function loadMermaidFromCdn() {
  const { default: mermaid } = await import(MERMAID_CDN_URL);
  return mermaid;
}

/**
 * Entry point of the browser program: render every `.mermaid` block and
 * publish readiness through the protocol.
 *
 * This is the function that used to be the body of an injected module script.
 * It is `async` because it awaits the runtime and each diagram, and the
 * inlined call site uses top-level await so the enclosing module script
 * finishes only when rendering has.
 *
 * Failure modes are deliberate and separate:
 *
 * - A single diagram that will not parse becomes a visible placeholder and an
 *   entry in the error array; the remaining diagrams still render.
 * - The runtime failing to load is one entry carrying `fatalReportIndex`,
 *   which the renderer classifies as fatal rather than a warning.
 * - Either way the render-done flag is published and the ready promise
 *   resolves in `finally`, so the renderer reports the error it has instead
 *   of timing out on a promise that never settles.
 *
 * @param {Object} params
 * @param {{[key: string]: string}} params.flags  The readiness protocol's flag names.
 * @param {(target: Object, key: string, value: unknown) => unknown} [params.publish]
 *   Readiness protocol publisher; defaults to validated assignment against `flags`.
 * @param {number} params.fatalReportIndex  Index marking a runtime-load failure.
 * @param {Object} [params.win=globalThis]   Global object the flags are published on.
 * @param {Document} [params.doc]            Document to render into; defaults to `win.document`.
 * @param {() => Promise<Object>} [params.loadRuntime]  Runtime loader; defaults to the CDN import.
 * @returns {Promise<void>}
 * @throws {Error} When the protocol handle or the fatal index is missing — both
 *   are interface requirements, not optional behaviour, so they fail loudly
 *   before any DOM mutation instead of publishing flags nobody reads.
 */
export async function runMermaidBootstrap({
  flags,
  publish,
  fatalReportIndex,
  win,
  doc,
  loadRuntime = loadMermaidFromCdn,
} = {}) {
  if (!flags || typeof flags !== 'object') {
    throw new Error('runMermaidBootstrap requires the readiness protocol flags.');
  }
  if (typeof fatalReportIndex !== 'number') {
    throw new Error('runMermaidBootstrap requires the protocol fatal-report index.');
  }

  const view = win ?? globalThis;
  const document_ = doc ?? view.document;
  const computedStyle = (el) => view.getComputedStyle(el);
  const setFlag =
    publish ??
    ((target, key, value) => {
      if (!Object.hasOwn(flags, key)) {
        throw new Error(`Unknown readiness flag "${String(key)}".`);
      }
      target[flags[key]] = value;
      return value;
    });

  let resolveReady;
  setFlag(
    view,
    'mermaidReady',
    new Promise((resolve) => {
      resolveReady = resolve;
    }),
  );
  const errors = setFlag(view, 'mermaidErrors', []);
  setFlag(view, 'mermaidDebug', []);

  try {
    const nodes = document_.querySelectorAll('.mermaid');
    if (nodes.length > 0) {
      // The theme is resolved before the runtime is loaded and before any
      // diagram is initialised: Mermaid writes its theme into the CSS it
      // generates per diagram, so a name learned later would paint nothing.
      // Both properties come off the same root computed style; only this one
      // has to be read this early.
      const rootStyle = computedStyle(document_.documentElement);
      const theme = rootVariableValue(rootStyle, THEME_VARIABLE, DEFAULT_MERMAID_THEME);

      const mermaid = await loadRuntime();
      mermaid.initialize(mermaidInitOptions(theme));

      // Render each diagram independently so one broken diagram cannot take
      // down the whole document.
      for (const [index, node] of nodes.entries()) {
        try {
          const { svg } = await mermaid.render('mermaid-' + index, node.textContent);
          node.innerHTML = svg;
        } catch (err) {
          const message = messageOf(err);
          errors.push({ index, error: message });
          document_.getElementById('dmermaid-' + index)?.remove();
          node.textContent = 'Mermaid diagram failed to render: ' + message;
        }
      }

      // Opt-in, read back from the theme at render time.
      const normalize = rootVariableValue(computedStyle(document_.documentElement), NORMALIZE_VARIABLE);
      if (normalize) {
        normalizeLabelColors(document_, computedStyle);
      }

      setFlag(view, 'mermaidDebug', collectDebugReports(document_));
    }
  } catch (err) {
    errors.push({ index: fatalReportIndex, error: messageOf(err) });
  } finally {
    // Signal completion so KaTeX and Puppeteer can proceed, even on failure.
    setFlag(view, 'mermaidRenderDone', true);
    resolveReady();
  }
}
