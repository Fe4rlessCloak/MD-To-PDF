/**
 * @file Own page geometry: the page rule, the named cover page and the
 * browser's print preference.
 *
 * Page margins used to be declared in seven places — the base print
 * stylesheet, five bundled themes, and the PDF renderer's own options — so a
 * single first-page margin correction had to be repeated in every theme, and
 * the renderer could hand the browser a page size that contradicted the
 * stylesheet the document carried.
 *
 * Both faults are structural, so the fix is structural: the rule is written
 * once, here, and every other party supplies a *value* rather than a rule.
 *
 * Two directions of flow, deliberately kept separate:
 *
 * - Defaults flow **in** from a geometry object. Changing a default margin is
 *   an edit to {@link DEFAULT_PAGE_GEOMETRY} and nothing else.
 * - Theme values flow in **through CSS** via {@link PAGE_GEOMETRY_VARIABLES}.
 *   A theme sets `--page-margin` and stops there; it never writes `@page`, so
 *   it cannot redeclare the rule inconsistently.
 *
 * The emitted rule reads each variable with the geometry default as its
 * fallback, which is what lets an unthemed document stay printable while a
 * theme still wins.
 *
 * Verified against Chromium 148 on the build host: `var()` resolves inside
 * `@page` margins *and* inside `@bottom-center` margin boxes, `@page`
 * `background` paints the sheet, and `@bottom-center` really does print a page
 * number — so the footer is emitted, not deleted as a WeasyPrint leftover.
 */

/**
 * Name under which the `@page` rule is emitted as its own stylesheet layer.
 *
 * Assembly appends it after every print layer; naming it here keeps the
 * document's layer vocabulary in one place, next to the rule it labels.
 *
 * @type {string}
 */
export const PAGE_GEOMETRY_STYLESHEET_NAME = 'page-geometry';

/**
 * CSS custom property names a theme uses to supply geometry.
 *
 * These names are a cross-file contract: the module writes them into the page
 * rule and every bundled theme sets them. Tests assert both halves.
 *
 * @type {Readonly<{size: string, margin: string, background: string, footerContent: string, footerFontFamily: string, footerFontSize: string, footerFontWeight: string, footerColor: string}>}
 */
export const PAGE_GEOMETRY_VARIABLES = Object.freeze({
  size: '--page-size',
  margin: '--page-margin',
  background: '--page-background',
  footerContent: '--page-footer-content',
  footerFontFamily: '--page-footer-font-family',
  footerFontSize: '--page-footer-font-size',
  footerFontWeight: '--page-footer-font-weight',
  footerColor: '--page-footer-color',
});

/**
 * @typedef {Object} PageFooter
 * @property {string} content     The `content` value, e.g. `"Page " counter(page)`.
 * @property {string} fontFamily
 * @property {string} fontSize
 * @property {string} fontWeight
 * @property {string} color
 */

/**
 * @typedef {Object} PageGeometry
 * @property {string} size           Page size, e.g. `A4`.
 * @property {string} margin         Page margin shorthand, e.g. `2cm 2.2cm`.
 * @property {string} background     Colour painted across the whole sheet.
 * @property {PageFooter|null} footer  Printed page number, or `null` for none.
 * @property {{margin: string}|null} cover  Named cover page, or `null` for none.
 */

/**
 * The geometry every document gets before a theme supplies one.
 *
 * This is the single place a margin default is corrected. The values here are
 * the ones the themes previously repeated: `2cm 2.2cm` was both the base
 * stylesheet's fallback and the light theme's margin, so it stays the default.
 *
 * @type {Readonly<PageGeometry>}
 */
export const DEFAULT_PAGE_GEOMETRY = Object.freeze({
  size: 'A4',
  margin: '2cm 2.2cm',
  background: 'transparent',
  footer: Object.freeze({
    content: '"Page " counter(page)',
    fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
    fontSize: '9pt',
    fontWeight: '400',
    color: '#888888',
  }),
  cover: null,
});

/**
 * Characters that would let a value escape the declaration it is written into.
 *
 * A margin is a CSS length shorthand; nothing legitimate in one contains a
 * brace or a newline. Refusing them keeps a typo loud instead of letting it
 * silently disable page setup for the whole document.
 */
const FORBIDDEN_IN_VALUE = /[{}]|[\r\n]/;

/**
 * Validate one CSS value received from a caller.
 *
 * @param {unknown} value
 * @param {string} name   Field name, for the error message.
 * @returns {string}
 * @throws {Error} When the value is not a usable, non-empty CSS value.
 */
function requireCssValue(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Page geometry ${name} must be a non-empty string, got ${JSON.stringify(value)}.`);
  }
  if (FORBIDDEN_IN_VALUE.test(value)) {
    throw new Error(
      `Page geometry ${name} must not contain braces or newlines, got ${JSON.stringify(value)}.`,
    );
  }
  return value.trim();
}

/**
 * Resolve a partial geometry against the defaults, validating as it goes.
 *
 * Unknown keys are refused rather than carried along: a misspelled geometry
 * field would otherwise be silently ignored, which is exactly the class of
 * quiet failure this module exists to remove.
 *
 * @param {Partial<PageGeometry>} [geometry]
 * @returns {PageGeometry}
 */
function resolveGeometry(geometry = {}) {
  const known = ['size', 'margin', 'background', 'footer', 'cover'];
  for (const key of Object.keys(geometry)) {
    if (!known.includes(key)) {
      throw new Error(`Unknown page geometry field "${key}". Known: ${known.join(', ')}.`);
    }
  }

  const merged = { ...DEFAULT_PAGE_GEOMETRY, ...geometry };

  const resolved = {
    size: requireCssValue(merged.size, 'size'),
    margin: requireCssValue(merged.margin, 'margin'),
    background: requireCssValue(merged.background, 'background'),
    footer: null,
    cover: null,
  };

  if (merged.footer) {
    const footer = { ...DEFAULT_PAGE_GEOMETRY.footer, ...merged.footer };
    resolved.footer = {
      content: requireCssValue(footer.content, 'footer content'),
      fontFamily: requireCssValue(footer.fontFamily, 'footer font family'),
      fontSize: requireCssValue(footer.fontSize, 'footer font size'),
      fontWeight: requireCssValue(footer.fontWeight, 'footer font weight'),
      color: requireCssValue(footer.color, 'footer colour'),
    };
  }

  if (merged.cover) {
    resolved.cover = { margin: requireCssValue(merged.cover.margin, 'cover margin') };
  }

  return resolved;
}

/**
 * One declaration reading a theme variable with the geometry value as fallback.
 *
 * Written on its own line so that correcting a default is a one-line diff.
 *
 * @param {string} property  CSS property name.
 * @param {string} variable  Custom property the theme may set.
 * @param {string} fallback  Value used when the theme sets nothing.
 * @returns {string}
 */
function declaration(property, variable, fallback) {
  return `  ${property}: var(${variable}, ${fallback});`;
}

/**
 * The `@page` rule, with its footer margin box inside it.
 *
 * @param {PageGeometry} geometry
 * @returns {string}
 */
function pageRule(geometry) {
  const lines = ['@page {', declaration('size', PAGE_GEOMETRY_VARIABLES.size, geometry.size)];

  lines.push(declaration('margin', PAGE_GEOMETRY_VARIABLES.margin, geometry.margin));
  lines.push(declaration('background', PAGE_GEOMETRY_VARIABLES.background, geometry.background));

  if (geometry.footer) {
    const f = geometry.footer;
    lines.push('  @bottom-center {');
    lines.push(declaration('content', PAGE_GEOMETRY_VARIABLES.footerContent, f.content));
    lines.push(declaration('font-family', PAGE_GEOMETRY_VARIABLES.footerFontFamily, f.fontFamily));
    lines.push(declaration('font-size', PAGE_GEOMETRY_VARIABLES.footerFontSize, f.fontSize));
    lines.push(declaration('font-weight', PAGE_GEOMETRY_VARIABLES.footerFontWeight, f.fontWeight));
    lines.push(declaration('color', PAGE_GEOMETRY_VARIABLES.footerColor, f.color));
    lines.push('  }');
  }

  lines.push('}');
  return lines.join('\n');
}

/**
 * The named cover page, emitted only when a geometry asks for one.
 *
 * No bundled document can produce a `.cover` element, so emitting this
 * unconditionally would recreate the dead rule the model used to carry. The
 * capability is real and tested; it is opt-in.
 *
 * @param {PageGeometry} geometry
 * @returns {string}
 */
function coverRule(geometry) {
  return [
    '@page cover {',
    `  margin: ${geometry.cover.margin};`,
    '  @bottom-center { content: none; }',
    '}',
  ].join('\n');
}

/**
 * The page rule, the cover page and the browser's print preference, from one
 * geometry value.
 *
 * Both halves of the page decision come out of a single call over a single
 * value, so a caller cannot obtain a stylesheet that says one thing and a
 * browser preference that says another.
 *
 * `pdfOptions` deliberately carries no `format`, `width`, `height` or
 * `margin`: naming a size there would let the browser override the page rule,
 * which is the contradiction this module removes. `preferCSSPageSize` makes
 * the rule authoritative.
 *
 * @param {Partial<PageGeometry>} [geometry]  Overrides for the defaults.
 * @returns {{css: string, pdfOptions: {preferCSSPageSize: boolean}}}
 * @throws {Error} When a geometry value is missing, malformed, or unknown.
 */
export function pageGeometry(geometry) {
  const resolved = resolveGeometry(geometry);

  const blocks = [pageRule(resolved)];
  if (resolved.cover) blocks.push(coverRule(resolved));

  return {
    css: blocks.join('\n'),
    pdfOptions: { preferCSSPageSize: true },
  };
}
