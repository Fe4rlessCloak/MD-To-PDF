/**
 * @file The Mermaid browser program.
 *
 * This file is executed in two places, and it has to be a real module in both:
 *
 * - **In the browser**, its source text is inlined into a module script by
 *   `build-html.js`, followed by a call to {@link runMermaidBootstrap}. That
 *   is what lets the document stay a single self-contained file and keeps
 *   top-level await legal.
 * - **In tests**, it is imported by Node so the colour maths and the contrast
 *   decision can be exercised directly instead of through a substring match on
 *   an assembly template.
 *
 * Importing it therefore publishes nothing and touches no DOM: every side
 * effect lives behind {@link runMermaidBootstrap}, and every DOM collaborator
 * arrives as an injected parameter. The module deliberately imports no Node
 * built-ins and no siblings, because its source text is also browser code and
 * an `import` in the inlined text would be a fetch the document cannot make.
 * That is why the colour maths below lives here rather than in a sibling
 * module: it is the one place a browser-side module may keep its own
 * implementation.
 *
 * **The contrast normaliser.** A label is readable when its ink contrasts with
 * what is actually painted behind it, and nothing about a diagram's markup says
 * which shape that is. Mermaid draws a Gantt task's name inside its bar, a
 * second task's name outside it on the bare page, a state's name on an `inner`
 * rect that is itself drawn on an `outer` one, and a class label inside a
 * `<g>` that paints nothing at all. So this program measures instead of
 * assuming: it collects the painted geometry, composites what is behind each
 * label's centre point, and asks the WCAG contrast rule which of two inks is
 * legible there.
 *
 * The measurement half is pure and tested without a browser; the adapter that
 * reads geometry and computed styles is covered by the rendered PDFs instead,
 * because a fake DOM that agreed with it would only prove the fake agrees with
 * itself.
 *
 * **One file, and why.** `build-html.js` inlines this program by reading this
 * file's text with `readFileSync` and putting it in a module script element;
 * there is no bundler in the pipeline. So the text of any `import` here would
 * arrive in the document as a fetch the page cannot make, and the pure halves
 * cannot live in a sibling module that this one re-exports. That is the
 * constraint behind the five banner sections below, not an oversight: a
 * sibling would buy nothing that a section boundary does not.
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
 * CSS custom property that carries the page sheet colour.
 *
 * Read, not owned: `src/core/page-geometry.js` owns this name and writes it
 * into the `@page` rule, which is what actually paints the sheet. This program
 * reads it because the surface under a label is the sheet composited with the
 * element backgrounds, and the sheet is the property that owns the paint — a
 * `html`/`body` background is a second, optional thing (`style.css` sets
 * neither). The name cannot be imported here because this file's source text is
 * inlined as browser code, so the agreement is pinned by a test instead of by
 * the language.
 *
 * @type {string}
 */
export const PAGE_BACKGROUND_VARIABLE = '--page-background';

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
 * Root properties a theme may declare to repaint Mermaid's Gantt task bars.
 *
 * Mermaid's `dark` theme does not darken these three. `doneTaskBkgColor` stays
 * `lightgrey` and `activeTaskBkgColor` stays a light blue whatever name a
 * theme selects, because Mermaid treats them as a status pair rather than as
 * surfaces: a completed bar and an in-progress bar are *meant* to read as pale
 * chips. On a black sheet that is a glare patch, and it is the one surface the
 * shared block cannot reach — a Gantt bar is not a node, an actor or a cluster,
 * it is a `<rect class="task done1">` painted from a theme variable Mermaid
 * resolves before any stylesheet is consulted.
 *
 * `mermaid.initialize` accepts the same names as `themeVariables`, so a theme
 * that declares one of these gets Mermaid's own generated rule painted with
 * that value. The mapping is data rather than three branches, so a fourth bar
 * family is one entry, and the declaration order here is the order a theme
 * writes them in.
 *
 * @type {ReadonlyArray<{name: string, key: string, purpose: string}>}
 */
export const GANTT_VARIABLES = Object.freeze([
  {
    name: '--mermaid-gantt-task-fill',
    key: 'taskBkgColor',
    purpose: 'Opt-in fill for a plain Gantt task bar; a dark page needs a dark bar.',
  },
  {
    name: '--mermaid-gantt-done-fill',
    key: 'doneTaskBkgColor',
    purpose: 'Opt-in fill for a completed Gantt task bar, which Mermaid leaves lightgrey.',
  },
  {
    name: '--mermaid-gantt-active-fill',
    key: 'activeTaskBkgColor',
    purpose: 'Opt-in fill for an in-progress Gantt task bar, which Mermaid leaves light blue.',
  },
]);

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
 * Only `--mermaid-*` names belong here: this list is what tells a
 * program-owned property from a shared-block one inside that prefix.
 * {@link PAGE_BACKGROUND_VARIABLE} is read too, but it is a page-geometry
 * property rather than a Mermaid one, so it stays out and its agreement is
 * pinned separately.
 *
 * A frozen array rather than a `Set`, for the same reason
 * `MERMAID_VARIABLES` is one: `Object.freeze` does not stop `Set.add`, so a
 * frozen `Set` would promise an immutability it cannot deliver.
 *
 * @type {ReadonlyArray<string>}
 */
export const BOOTSTRAP_VARIABLES = Object.freeze([
  NORMALIZE_VARIABLE,
  THEME_VARIABLE,
  ...GANTT_VARIABLES.map((variable) => variable.name),
]);

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
 * The properties this program reads from the root are all strings, and all
 * mean "nothing declared" when the computed value is empty or whitespace — a
 * stylesheet declaring `--x: ;` is read back as empty by `getPropertyValue`.
 * Trimming first is what makes an empty declaration and an absent one the same
 * answer here, rather than one of them becoming a theme named `''`. A caller
 * that needs a different fallback applies it to the returned string.
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

// ---------------------------------------------------------------------------
// Colour maths: everything below takes plain data, never a DOM node
// ---------------------------------------------------------------------------

/**
 * Ink forced onto labels sitting on a dark surface.
 * @type {string}
 */
export const LABEL_LIGHT_COLOR = '#ffffff';

/**
 * Ink forced onto labels sitting on a light surface.
 * @type {string}
 */
export const LABEL_DARK_COLOR = '#000000';

/**
 * The two inks a label may be given.
 *
 * Two, not a palette: the decision is "which of these is legible here", and a
 * third candidate would make the answer depend on an ordering the contrast
 * ratio does not provide. Order breaks the exact tie only.
 *
 * @type {ReadonlyArray<string>}
 */
export const LABEL_INK_CANDIDATES = Object.freeze([LABEL_DARK_COLOR, LABEL_LIGHT_COLOR]);

/**
 * Relative luminance below which a colour counts as dark.
 *
 * The WCAG mid-grey: `#808080` on the 0–1 linear scale the contrast formula
 * uses.
 *
 * **This split is deliberately not the old one.** The previous rule thresholded
 * 0–255 "YIQ" brightness, which is not a perceptual luminance at all — it
 * weights the gamma-encoded channels linearly, so it calls `rgb(60,160,60)`
 * dark and mid grey light, and its split corresponds to no contrast boundary.
 * This threshold is stated on the scale the WCAG ratio is actually computed
 * from, so a colour just below it is one where the ratio to paper is roughly
 * where the ratio to black overtakes it. Moving to it therefore reclassifies
 * colours near the boundary — by design, because the old boundary was the
 * thing that was wrong. It is a palette predicate, not the normaliser's
 * decision: the normaliser compares contrast ratios directly and never asks
 * this question.
 *
 * @type {number}
 */
export const DARK_LUMINANCE_THRESHOLD = 0.2159;

/**
 * WCAG AA contrast ratio for normal-size text.
 *
 * The normaliser repairs a label that fails this and leaves one that passes:
 * the point is legibility, not uniformity, so a theme's own ink survives
 * wherever it was already readable.
 *
 * @type {number}
 */
export const MIN_CONTRAST_RATIO = 4.5;

/**
 * Element names that paint. Everything else in an SVG draws lines, groups or
 * nothing at all, and a wrapper is not a surface.
 *
 * `rect`, `path`, `polygon`, `circle` and `ellipse` are the primitives Mermaid
 * fills for a node, a bar, a note, a state, a slice and a cluster. A `<g>`
 * carries a `fill` through inheritance — which is exactly how a class-diagram
 * label container came to be mistaken for a dark shape — but it paints no
 * geometry of its own, so it must never be sampled.
 *
 * @type {ReadonlyArray<string>}
 */
export const PAINTED_SHAPE_TAGS = Object.freeze(['rect', 'path', 'polygon', 'circle', 'ellipse']);

/**
 * Selector form of {@link PAINTED_SHAPE_TAGS}, for the DOM adapter.
 * @type {string}
 */
export const PAINTED_SHAPE_SELECTOR = PAINTED_SHAPE_TAGS.join(',');

/**
 * Class names whose text is drawn on a surface the normaliser must not touch.
 *
 * One entry, named and documented so a second exclusion is a line rather than
 * a condition buried in the loop. `sequenceNumber` is the sequence diagram's
 * autonumber badge: Mermaid draws a light numeral inside a filled disc it
 * paints itself, and ticket #17 pinned that pairing. The contrast measurement
 * cannot see the disc — it is a bare `<circle>` Mermaid fills from its own
 * generated rule — so a normaliser that re-inked the numeral would be guessing
 * about a surface it never measured.
 *
 * @type {ReadonlyArray<string>}
 */
export const LABEL_EXCLUSIONS = Object.freeze(['sequenceNumber']);

/**
 * Should this label be left exactly as Mermaid drew it?
 *
 * @param {string|null|undefined} className  The element's `class` attribute.
 * @returns {boolean}
 */
export function isExcludedLabel(className) {
  if (typeof className !== 'string' || className === '') return false;
  const tokens = className.split(/\s+/);
  return LABEL_EXCLUSIONS.some((excluded) => tokens.includes(excluded));
}

/**
 * Parse the colour forms a document can carry into channels plus alpha.
 *
 * Hex is accepted in all four lengths CSS defines — 3 and 4 are the shorthand
 * forms, 6 and 8 the full ones, and the extra digit is alpha. `rgb()` and
 * `rgba()` are accepted in both the comma form Chrome writes and the
 * space/slash form an author `style` directive may produce.
 *
 * **Named colours are refused, on purpose.** `getComputedStyle` resolves every
 * keyword to `rgb()`, so a keyword reaching this function means the value did
 * not come from a computed style — and guessing it would hide that. The
 * exceptions are `transparent`, which is not a colour at all but the absence of
 * paint and is reported as alpha 0 so the compositor can treat it uniformly,
 * and the two primaries, which a fixture or a test states as `black`/`white`
 * for legibility and which have exactly one possible value each.
 *
 * @param {string} color
 * @returns {{r: number, g: number, b: number, a: number}|null} Null when unmeasurable.
 */
export function parseColor(color) {
  if (typeof color !== 'string') return null;
  const value = color.trim().toLowerCase();
  if (value === '') return null;
  if (value === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  if (value === 'black') return { r: 0, g: 0, b: 0, a: 1 };
  if (value === 'white') return { r: 255, g: 255, b: 255, a: 1 };

  const hex = /^#([0-9a-f]{3,8})$/.exec(value);
  if (hex) {
    const digits = hex[1];
    const pair = (index) => Number.parseInt(digits.slice(index, index + 2), 16);
    const single = (index) => Number.parseInt(digits[index], 16) * 17;
    if (digits.length === 3 || digits.length === 4) {
      return {
        r: single(0),
        g: single(1),
        b: single(2),
        a: digits.length === 4 ? single(3) / 255 : 1,
      };
    }
    if (digits.length === 6 || digits.length === 8) {
      return {
        r: pair(0),
        g: pair(2),
        b: pair(4),
        a: digits.length === 8 ? pair(6) / 255 : 1,
      };
    }
    return null;
  }

  const functional = /^rgba?\(([^)]+)\)$/.exec(value);
  if (!functional) return null;

  const parts = functional[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  if (parts.length < 3 || parts.length > 4) return null;
  if (parts.some((part) => Number.isNaN(part) || part < 0)) return null;

  return { r: parts[0], g: parts[1], b: parts[2], a: parts.length === 4 ? parts[3] : 1 };
}

/**
 * Composite a colour over a backdrop with source-over alpha.
 *
 * The Gantt section band is the case this exists for: Mermaid paints it at
 * `opacity: 0.2`, so the colour a label sits on is the band mixed with the page
 * behind it, not the band's own pale value. Treating the band as opaque would
 * report a light surface under a label that is really on near-black.
 *
 * @param {{r: number, g: number, b: number, a: number}} top
 * @param {{r: number, g: number, b: number, a: number}} bottom
 * @returns {{r: number, g: number, b: number, a: number}}
 */
export function compositeOver(top, bottom) {
  const alpha = top.a + bottom.a * (1 - top.a);
  if (alpha === 0) return { r: 0, g: 0, b: 0, a: 0 };
  const channel = (t, b) => (t * top.a + b * bottom.a * (1 - top.a)) / alpha;
  return {
    r: channel(top.r, bottom.r),
    g: channel(top.g, bottom.g),
    b: channel(top.b, bottom.b),
    a: alpha,
  };
}

/**
 * A parsed colour, accepting either already-parsed channels or CSS text.
 *
 * Two callers need this — {@link relativeLuminance} and {@link isDarkColor} —
 * because one is documented to take either and the other takes whatever a
 * palette check hands it. Stated once so the `typeof` test and the null-when-
 * unmeasurable rule cannot drift between them.
 *
 * @param {{r: number, g: number, b: number, a?: number}|string} color
 * @returns {{r: number, g: number, b: number, a: number}|null}
 */
function asParsedColor(color) {
  return typeof color === 'string' ? parseColor(color) : color;
}

/**
 * WCAG relative luminance of a colour.
 *
 * Each channel is undoing the sRGB transfer function first, then weighted as
 * the standard specifies. This is the quantity the contrast ratio is defined
 * on, and the reason a mid-tone is not simply "half bright": the curve is
 * steepest at the dark end.
 *
 * @param {{r: number, g: number, b: number}|string} color  A parsed colour or its CSS text.
 * @returns {number|null} A value in 0–1, or null when the colour is unmeasurable.
 */
export function relativeLuminance(color) {
  const parsed = asParsedColor(color);
  if (!parsed || typeof parsed.r !== 'number') return null;

  const linear = (value) => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  };

  return 0.2126 * linear(parsed.r) + 0.7152 * linear(parsed.g) + 0.0722 * linear(parsed.b);
}

/**
 * WCAG contrast ratio between two colours.
 *
 * Symmetric, and 1:1 for a colour against itself. Ratios below
 * {@link MIN_CONTRAST_RATIO} are the ones the normaliser repairs; the ratio
 * itself is what decides between the two inks, which is the whole difference
 * from a brightness threshold — a threshold cannot tell you *how much* better
 * one ink is, so it cannot choose.
 *
 * @param {{r: number, g: number, b: number}|string} a
 * @param {{r: number, g: number, b: number}|string} b
 * @returns {number|null} Null when either side is unmeasurable.
 */
export function contrastRatio(a, b) {
  const first = relativeLuminance(a);
  const second = relativeLuminance(b);
  if (first === null || second === null) return null;
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

/**
 * The candidate ink with the most contrast against a surface.
 *
 * `null` when the surface cannot be measured or there are no candidates: the
 * caller then leaves the label alone, which is the honest outcome for a surface
 * this program failed to determine.
 *
 * @param {ReadonlyArray<string>} candidates  Ink colours, e.g. {@link LABEL_INK_CANDIDATES}.
 * @param {{r: number, g: number, b: number}|string|null} surface
 * @returns {string|null}
 */
export function chooseInk(candidates, surface) {
  if (!surface || !Array.isArray(candidates) || candidates.length === 0) return null;

  let best = null;
  let bestRatio = -1;
  for (const candidate of candidates) {
    const ratio = contrastRatio(candidate, surface);
    if (ratio === null) continue;
    if (ratio > bestRatio) {
      best = candidate;
      bestRatio = ratio;
    }
  }
  return best;
}

/**
 * The ink a label should carry, or null to keep the one it has.
 *
 * Three outcomes, stated separately because they mean different things:
 *
 * - the surface is unmeasurable → `null`, no decision;
 * - the existing ink already meets AA → `null`, no change;
 * - the existing ink fails, or is unmeasurable → the best candidate.
 *
 * The second case is what keeps this a repair rather than a repaint. A theme's
 * ink is typographic intent, and a label that is legible on the surface it
 * actually sits on should look the way the theme designed it.
 *
 * @param {Object} params
 * @param {{r: number, g: number, b: number}|string|null} params.surface
 * @param {{r: number, g: number, b: number}|string|null} params.ink
 * @param {ReadonlyArray<string>} [params.candidates=LABEL_INK_CANDIDATES]
 * @returns {string|null}
 */
export function normalizedInk({ surface, ink, candidates = LABEL_INK_CANDIDATES }) {
  if (!surface) return null;

  if (ink) {
    const existing = contrastRatio(ink, surface);
    if (existing !== null && existing >= MIN_CONTRAST_RATIO) return null;
  }

  return chooseInk(candidates, surface);
}

/**
 * The composited colour actually painted behind a point.
 *
 * `shapes` is a list of painted-geometry records in paint order — the order
 * the adapter read them off the document, which for SVG is document order.
 * Each is composited over the accumulated surface, so a semi-transparent fill
 * mixes with what is beneath it and an opaque one replaces it. Anything that
 * is not painted geometry is the caller's responsibility to leave out; this
 * function takes the list at its word, which is what keeps it testable.
 *
 * **Containment is the record's to answer.** A `<path>`, `<polygon>`, `<circle>`
 * or `<ellipse>` does not paint its bounding box: a diagonal edge or a pie
 * slice leaves whole corners of the box unpainted, and sampling those corners
 * invents a surface no pixel shows. So a record may carry a `contains(x, y)`
 * predicate, in the same coordinates as `x` and `y`, and this function asks it
 * instead of the box. The adapter supplies it from
 * `SVGGeometryElement.isPointInFill`; a record without one is assumed
 * rectangular, which is exact for `<rect>` and is what the plain-record tests
 * use. Keeping the predicate on the record rather than a second parameter is
 * what stops this function from needing to know which primitive is which.
 *
 * `tag` is required and is not defaulted: a record that does not say what
 * element it came from paints nothing, because a silent promotion to `rect`
 * would hide a caller that forgot to say.
 *
 * A point outside every shape is the canvas: that is the Gantt outside-bar
 * case, and it is why the canvas is a parameter rather than a fallback to
 * white.
 *
 * @param {number} x
 * @param {number} y
 * @param {Array<{tag: string, x: number, y: number, width: number, height: number,
 *   fill: string, opacity?: number, fillOpacity?: number,
 *   contains?: (x: number, y: number) => boolean}>} shapes
 * @param {{r: number, g: number, b: number, a: number}} canvas
 * @returns {{r: number, g: number, b: number, a: number}}
 */
export function paintedSurfaceAt(x, y, shapes, canvas) {
  let surface = canvas;

  for (const shape of shapes) {
    if (!PAINTED_SHAPE_TAGS.includes(shape.tag)) continue;
    if (!shapeContains(shape, x, y)) continue;

    const colour = parseColor(shape.fill);
    if (!colour || colour.a === 0) continue;

    const opacity = shape.opacity ?? 1;
    const fillOpacity = shape.fillOpacity ?? 1;
    const alpha = colour.a * opacity * fillOpacity;
    if (!(alpha > 0)) continue;

    surface = compositeOver({ ...colour, a: alpha }, surface);
  }

  return surface;
}

/**
 * Does this record paint the point?
 *
 * The record's own predicate when it has one, its box otherwise. Written as
 * `=== true` so a predicate that forgets to return a boolean is treated as a
 * miss rather than as a hit: a shape is only a surface here if it says so.
 *
 * @param {{x: number, y: number, width: number, height: number,
 *   contains?: (x: number, y: number) => boolean}} shape
 * @param {number} x
 * @param {number} y
 * @returns {boolean}
 */
function shapeContains(shape, x, y) {
  if (typeof shape.contains === 'function') return shape.contains(x, y) === true;

  const { x: left, y: top, width, height } = shape;
  return x >= left && x <= left + width && y >= top && y <= top + height;
}

/**
 * The page surface a diagram sits on, composited over white.
 *
 * White is the terminal backdrop because a PDF page is paper: the sheet, `html`
 * and `body` may all be transparent, and something has to be behind them.
 *
 * **The sheet colour belongs to `@page`.** A theme paints the page through
 * `--page-background`, which `page-geometry.js` writes into the `@page` rule;
 * `html` and `body` backgrounds are a second, narrower thing that a stylesheet
 * may leave unset entirely (`style.css` sets neither). So the resolved sheet
 * variable is the first thing composited and the only authoritative source;
 * the `html`/`body` chain is the fallback for a document that sets no page
 * background at all. Reading only the element chain would sample a property
 * that does not own the sheet and coincide with the truth by luck.
 *
 * @param {CSSStyleDeclaration} rootStyle
 * @param {CSSStyleDeclaration} [bodyStyle]
 * @param {string} [sheet]  Resolved `--page-background` value, or empty when unset.
 * @returns {{r: number, g: number, b: number, a: number}}
 */
export function canvasColor(rootStyle, bodyStyle, sheet = '') {
  const paper = { r: 255, g: 255, b: 255, a: 1 };
  const sheetColor = parseColor(sheet);
  const base = sheetColor ? compositeOver(sheetColor, paper) : paper;
  const root = parseColor(rootStyle?.backgroundColor) ?? { r: 0, g: 0, b: 0, a: 0 };
  const body = parseColor(bodyStyle?.backgroundColor) ?? { r: 0, g: 0, b: 0, a: 0 };
  return compositeOver(body, compositeOver(root, base));
}

// ---------------------------------------------------------------------------
// The Adapter from theme variables to Mermaid's own Gantt palette
// ---------------------------------------------------------------------------

/**
 * Read the declared Gantt variables as Mermaid `themeVariables`.
 *
 * Only declared properties appear in the result, which is what lets the
 * options factory omit the key entirely for a theme that declares none: an
 * absent `themeVariables` and an empty one are not the same document to a
 * reader comparing assembled output byte for byte.
 *
 * @param {(name: string) => string} readVariable  Root custom-property reader.
 * @returns {{[key: string]: string}} Mermaid theme keys to values.
 */
export function ganttThemeVariables(readVariable) {
  const variables = {};
  for (const variable of GANTT_VARIABLES) {
    const value = readVariable(variable.name).trim();
    if (value !== '') variables[variable.key] = value;
  }
  return variables;
}

// ---------------------------------------------------------------------------
// Mermaid initialisation
// ---------------------------------------------------------------------------

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
 * `themeVariables` is one already-merged set, because there is exactly one
 * source of them: {@link ganttThemeVariables}, which reads what the theme
 * declared. A caller with variables of its own merges before calling. When the
 * set is empty the `themeVariables` key is absent rather than empty, which is
 * what keeps a theme that paints nothing byte-identical in the assembled
 * document.
 *
 * @param {string} [theme=DEFAULT_MERMAID_THEME]  Resolved Mermaid theme name.
 * @param {{[key: string]: string}} [themeVariables]  Mermaid theme variables, already merged.
 * @returns {Object} A fresh options object for `mermaid.initialize`.
 */
export function mermaidInitOptions(theme = DEFAULT_MERMAID_THEME, themeVariables = {}) {
  const options = {
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

  if (themeVariables && Object.keys(themeVariables).length > 0) {
    options.themeVariables = { ...themeVariables };
  }

  return options;
}

/**
 * Luminance test for a colour, used by the palette checks that read a theme.
 *
 * Kept as a small named predicate because two callers outside the normaliser
 * ask the question — the OLED palette test asserts its ink is light, and a
 * theme author reasons in these terms — and answering it through the same
 * {@link relativeLuminance} the contrast decision uses keeps one definition of
 * "dark". Anything unmeasurable is reported as light, which keeps the
 * predicate total without a second branch.
 *
 * @param {string} color  Computed colour, e.g. `rgb(20, 24, 40)`.
 * @returns {boolean} True when the colour is dark enough to need light ink.
 */
export function isDarkColor(color) {
  const parsed = asParsedColor(color);
  // A colour with no alpha paints nothing, so it cannot be dark: the sheet is
  // what shows through, and this predicate answers about paint.
  if (!parsed || parsed.a === 0) return false;
  const luminance = relativeLuminance(parsed);
  return luminance !== null && luminance < DARK_LUMINANCE_THRESHOLD;
}

// ---------------------------------------------------------------------------
// The DOM adapter: thin by design, exercised by the rendered PDFs
// ---------------------------------------------------------------------------

/**
 * Point-in-fill predicate for one primitive, in SVG-relative coordinates.
 *
 * The records {@link paintedShapes} produces are measured in the SVG's own
 * frame (both shapes and label centres subtract the SVG's client-rect origin),
 * while `isPointInFill` wants a point in the element's user units. So the
 * predicate puts the sampled point back into viewport coordinates and pulls it
 * through the inverse of `getScreenCTM`, which is the transform the browser
 * itself would apply — a `viewBox` scale, a nested `<g transform>` and a CSS
 * transform on the container all get accounted for at once, which is why this
 * is not arithmetic on the box.
 *
 * `null` when the element cannot answer: an older engine with no
 * `isPointInFill`, or an element not yet laid out and so without a CTM. The
 * caller then leaves the record rectangular, which is the honest approximation
 * rather than a guess dressed as geometry.
 *
 * Fill, not stroke. A stroke is a thin outline along the geometry's edge, and a
 * label sits on the *fill* inside it; a stroke-only shape is not a surface at
 * all, and the caller's fill-alpha check already drops those records before
 * this predicate could be asked. So there is no second predicate for the
 * stroke case — adding one would describe a surface the sampler never uses.
 *
 * @param {Element} el
 * @param {DOMRect} origin  The SVG's client rect, the frame records are in.
 * @returns {((x: number, y: number) => boolean)|null}
 */
function pointInFill(el, origin) {
  if (typeof el.isPointInFill !== 'function' || typeof el.getScreenCTM !== 'function') return null;
  if (typeof DOMPoint !== 'function') return null;

  const matrix = el.getScreenCTM();
  if (!matrix) return null;
  const inverse = matrix.inverse();

  return (x, y) => el.isPointInFill(new DOMPoint(x + origin.x, y + origin.y).matrixTransform(inverse)) === true;
}

/**
 * Collect the painted geometry of one rendered diagram as plain records.
 *
 * Only {@link PAINTED_SHAPE_SELECTOR} elements are read, and only those with a
 * non-transparent fill and positive opacity. Coordinates are made relative to
 * the SVG's own box, which is the same frame {@link visibleLabels} reports a
 * label's centre in — that agreement is the contract the whole normaliser
 * rests on, and it is why both halves subtract the same origin rather than
 * working in viewport coordinates.
 *
 * Containment is decided per primitive: a `<rect>` keeps its box, which is
 * exact, and every other tag carries a `contains` predicate from
 * {@link pointInFill} so a diagonal path or a pie slice cannot claim the
 * unpainted corners of its bounding box.
 *
 * @param {Element} svg
 * @param {(el: Element) => CSSStyleDeclaration} computedStyle
 * @returns {Array<Object>} Records for {@link paintedSurfaceAt}.
 */
function paintedShapes(svg, computedStyle) {
  const origin = svg.getBoundingClientRect();
  const shapes = [];

  for (const el of svg.querySelectorAll(PAINTED_SHAPE_SELECTOR)) {
    const style = computedStyle(el);
    const box = el.getBoundingClientRect();
    if (!(box.width > 0) || !(box.height > 0)) continue;

    const tag = el.tagName.toLowerCase();
    const record = {
      tag,
      x: box.x - origin.x,
      y: box.y - origin.y,
      width: box.width,
      height: box.height,
      fill: style.fill,
      opacity: style.opacity === '' ? 1 : Number(style.opacity),
      fillOpacity: style.fillOpacity === '' ? 1 : Number(style.fillOpacity),
    };

    if (tag !== 'rect') {
      const contains = pointInFill(el, origin);
      if (contains) record.contains = contains;
    }

    shapes.push(record);
  }

  return shapes;
}

/**
 * Every visible text label in one rendered diagram.
 *
 * Two kinds, because Mermaid emits both: SVG `<text>` elements, whose ink is
 * the `fill` property, and leaf elements inside a `foreignObject`, whose ink
 * is `color` and which is where `htmlLabels` puts a node's words. A
 * `foreignObject` wrapper itself is skipped — it is a container, not a label —
 * and so is anything in {@link LABEL_EXCLUSIONS}.
 *
 * @param {Element} svg
 * @param {(el: Element) => CSSStyleDeclaration} computedStyle
 * @returns {Array<{el: Element, inkProperty: string, ink: *, box: DOMRect}>}
 */
function visibleLabels(svg, computedStyle) {
  const origin = svg.getBoundingClientRect();
  const labels = [];

  const collect = (el, inkProperty) => {
    if (isExcludedLabel(el.getAttribute?.('class'))) return;
    if ((el.textContent ?? '').trim() === '') return;

    const box = el.getBoundingClientRect();
    // A zero-size label paints nothing: Mermaid emits empty `<tspan>`s for the
    // line breaks in a multi-line label, and they would otherwise be sampled
    // at a meaningless point.
    if (!(box.width > 0) || !(box.height > 0)) return;

    labels.push({
      el,
      inkProperty,
      ink: parseColor(computedStyle(el)[inkProperty]),
      box: {
        x: box.x - origin.x,
        y: box.y - origin.y,
        width: box.width,
        height: box.height,
      },
    });
  };

  for (const el of svg.querySelectorAll('text')) collect(el, 'fill');

  for (const el of svg.querySelectorAll('foreignObject *')) {
    // Leaf only: a wrapper's `textContent` is its child's text, so sampling a
    // wrapper would report the same words twice and ink the container instead
    // of the glyphs.
    if (el.children.length > 0) continue;
    collect(el, 'color');
  }

  return labels;
}

/**
 * Force an ink onto a label and every `<tspan>` inside it.
 *
 * The nested spans matter for a multi-line label: Mermaid draws each line as
 * its own `tspan`, and a `fill` set only on the parent is inherited only where
 * a span does not carry its own. `color` is set beside `fill` because a
 * `foreignObject` label is HTML, where `color` is the property that paints
 * text — the same pair the previous normaliser wrote.
 *
 * The declaration is `!important` because Mermaid's own runtime rules are:
 * `#mermaid-N .activeText0 { fill:#2c2c2c !important }` is an ID selector with
 * an important declaration, and an inline important declaration is the only
 * thing that outranks it.
 *
 * @param {Element} el
 * @param {string} ink
 * @returns {void}
 */
function applyInk(el, ink) {
  el.style.setProperty('fill', ink, 'important');
  el.style.setProperty('color', ink, 'important');

  for (const span of el.querySelectorAll('tspan')) {
    span.style.setProperty('fill', ink, 'important');
    span.style.setProperty('color', ink, 'important');
  }
}

/**
 * Give every visible label in every rendered diagram a legible ink.
 *
 * The loop is the whole opt-in behaviour: measure the surface behind a label's
 * centre, ask {@link normalizedInk} whether the ink it already has is readable
 * there, and repaint only when it is not. Nothing about a diagram family is
 * special-cased — a Gantt inside-bar label samples its bar, an outside-bar
 * label samples the canvas, a state label samples the `inner` rect painted
 * over the `outer` one, and a class label falls through the non-painting `<g>`
 * to the canvas — because the same measurement answers all of them.
 *
 * @param {Document} doc
 * @param {(el: Element) => CSSStyleDeclaration} computedStyle
 * @param {string} [sheet]  Resolved `--page-background`; see {@link canvasColor}.
 * @returns {Array<{index: number, checked: number, adjusted: number}>} Per
 *   diagram, in document order: how many labels were examined and how many
 *   needed a different ink. The render loop merges these into the debug report,
 *   so a render check can see the normaliser ran and which diagram it changed
 *   most.
 */
export function normalizeLabelColors(doc, computedStyle, sheet = '') {
  const canvas = canvasColor(
    computedStyle(doc.documentElement),
    doc.body ? computedStyle(doc.body) : undefined,
    sheet,
  );

  const counts = [];
  let index = 0;

  for (const container of doc.querySelectorAll('.mermaid')) {
    const containerIndex = index;
    index += 1;

    const svg = container.querySelector('svg');
    if (!svg) continue;

    const shapes = paintedShapes(svg, computedStyle);
    let checked = 0;
    let adjusted = 0;

    for (const label of visibleLabels(svg, computedStyle)) {
      checked += 1;

      const surface = paintedSurfaceAt(
        label.box.x + label.box.width / 2,
        label.box.y + label.box.height / 2,
        shapes,
        canvas,
      );
      const ink = normalizedInk({ surface, ink: label.ink });
      if (!ink) continue;

      applyInk(label.el, ink);
      adjusted += 1;
    }

    counts.push({ index: containerIndex, checked, adjusted });
  }

  return counts;
}

// ---------------------------------------------------------------------------
// The render loop
// ---------------------------------------------------------------------------

/**
 * Normalise the message of a thrown value.
 * @param {unknown} err
 * @returns {string}
 */
function messageOf(err) {
  return err && err.message ? err.message : String(err);
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
      // The theme and the Gantt variables are resolved before the runtime is
      // loaded and before any diagram is initialised: Mermaid writes its theme
      // into the CSS it generates per diagram, so a value learned later would
      // paint nothing. Both come off the same root computed style.
      const rootStyle = computedStyle(document_.documentElement);
      const theme = rootVariableValue(rootStyle, THEME_VARIABLE, DEFAULT_MERMAID_THEME);
      const ganttVariables = ganttThemeVariables((name) =>
        rootVariableValue(rootStyle, name),
      );

      const mermaid = await loadRuntime();
      mermaid.initialize(mermaidInitOptions(theme, ganttVariables));

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

      // Opt-in, read back from the theme at render time. The sheet colour comes
      // from the same root style, because `--page-background` is what `@page`
      // paints the page with; see `canvasColor`.
      const rootStyleAtRender = computedStyle(document_.documentElement);
      const reports = collectDebugReports(document_);
      if (rootVariableValue(rootStyleAtRender, NORMALIZE_VARIABLE)) {
        const counts = normalizeLabelColors(
          document_,
          computedStyle,
          rootVariableValue(rootStyleAtRender, PAGE_BACKGROUND_VARIABLE),
        );
        // Merged by index so the count lands beside the diagram it describes.
        // The counts are per rendered SVG, and a container without one was
        // never counted, so a lookup is used rather than positional pairing.
        for (const report of reports) {
          const count = counts.find((entry) => entry.index === report.index);
          if (count) report.normalization = { checked: count.checked, adjusted: count.adjusted };
        }
      }
      setFlag(view, 'mermaidDebug', reports);
    }
  } catch (err) {
    errors.push({ index: fatalReportIndex, error: messageOf(err) });
  } finally {
    // Signal completion so KaTeX and Puppeteer can proceed, even on failure.
    setFlag(view, 'mermaidRenderDone', true);
    resolveReady();
  }
}
