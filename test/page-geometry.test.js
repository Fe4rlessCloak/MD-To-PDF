/**
 * @file Tests for the page-geometry module.
 *
 * Page geometry used to be declared in seven places — five theme stylesheets,
 * the base print stylesheet, and the PDF renderer's options — so a single
 * first-page margin correction needed a coordinated edit in all of them, and
 * the renderer's page-size preference could contradict the stylesheet the
 * document actually carried.
 *
 * Everything here is asserted as text: the module returns CSS text and a plain
 * options object, so no browser is needed to know what the page will look like.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  DEFAULT_PAGE_GEOMETRY,
  PAGE_GEOMETRY_INVARIANTS,
  PAGE_GEOMETRY_VARIABLES,
  pageGeometry,
  violatedInvariants,
} from '../src/core/page-geometry.js';
import { stripComments } from '../src/core/mermaid-styles/mermaid-styles.js';
import { bundledThemes, readTheme as readBundledTheme } from './helpers/themes.js';

/**
 * Read one bundled theme, with CSS comments removed.
 *
 * Stripping comments matters: the themes mention `@page` in prose to say the
 * module owns it, and a test that cannot tell a comment from a declaration
 * would forbid the explanation.
 *
 * @param {string} name  File name under `styles/`.
 * @returns {Promise<string>}
 */
function readTheme(name) {
  return readBundledTheme(name, { stripComments: true });
}

// ---------------------------------------------------------------------------
// The page rule
// ---------------------------------------------------------------------------

test('the page rule sets the page size and the default margin', () => {
  const { css } = pageGeometry();

  assert.match(css, /^@page\s*\{/m, 'the document must carry a page rule');
  assert.match(css, /size:\s*var\(--page-size, A4\)/, 'A4 is the default page size');
  assert.match(css, /margin:\s*var\(--page-margin, 2cm 2\.2cm\)/, 'the default margin is 2cm 2.2cm');
});

test('the rule reads geometry from theme variables, with the passed value as the fallback', () => {
  // The variable is the theme's only way in; the fallback is what an unthemed
  // document gets. Both come from the same declaration, so there is one place
  // to correct a default.
  const geometry = { ...DEFAULT_PAGE_GEOMETRY, margin: '1.4cm 1.5cm' };
  const { css } = pageGeometry(geometry);

  assert.match(css, new RegExp(`margin:\\s*var\\(${PAGE_GEOMETRY_VARIABLES.margin}, 1\\.4cm 1\\.5cm\\)`));
});

test('the footer margin box lives inside the page rule, fed by the same variables', () => {
  const { css } = pageGeometry();

  // Chromium renders @bottom-center; this is a printed page number, not a
  // WeasyPrint leftover.
  assert.match(css, /@bottom-center\s*\{/);
  assert.match(css, /content:\s*var\(--page-footer-content, "Page " counter\(page\)\)/);
  assert.match(css, /font-size:\s*var\(--page-footer-font-size, 9pt\)/);
  assert.match(css, /color:\s*var\(--page-footer-color, #888888\)/);
});

test('a theme can restyle the footer without redeclaring the page rule', () => {
  const geometry = {
    ...DEFAULT_PAGE_GEOMETRY,
    footer: { ...DEFAULT_PAGE_GEOMETRY.footer, fontSize: '10pt', color: '#000000', fontWeight: '600' },
  };
  const { css } = pageGeometry(geometry);

  assert.match(css, /font-size:\s*var\(--page-footer-font-size, 10pt\)/);
  assert.match(css, /color:\s*var\(--page-footer-color, #000000\)/);
  assert.match(css, /font-weight:\s*var\(--page-footer-font-weight, 600\)/);
  assert.equal((css.match(/@page\s*\{/g) ?? []).length, 1, 'still exactly one page rule');
});

test('a geometry that asks for no footer emits no footer box', () => {
  const { css } = pageGeometry({ ...DEFAULT_PAGE_GEOMETRY, footer: null });

  assert.ok(!css.includes('@bottom-center'), 'no footer box means no printed page number');
  assert.match(css, /margin:/, 'the page rule itself still exists');
});

// ---------------------------------------------------------------------------
// The named cover page
// ---------------------------------------------------------------------------

test('no cover page rule is emitted unless the geometry asks for one', () => {
  const { css } = pageGeometry();

  assert.ok(!css.includes('@page cover'), 'a rule nothing can trigger is dead weight');
});

test('the named cover page is emitted from the geometry when one is requested', () => {
  const { css } = pageGeometry({ ...DEFAULT_PAGE_GEOMETRY, cover: { margin: '0' } });

  assert.match(css, /@page cover\s*\{/);
  assert.match(css, /@page cover\s*\{[^}]*margin:\s*0/, 'a cover is full-bleed');
  assert.match(
    css,
    /@page cover\s*\{[^}]*@bottom-center\s*\{\s*content:\s*none/,
    'the body page number must not print on a cover',
  );
});

// ---------------------------------------------------------------------------
// The print preference — one call, so the two cannot disagree
// ---------------------------------------------------------------------------

test('the print preference says the stylesheet decides the page size', () => {
  const { pdfOptions } = pageGeometry();

  assert.equal(pdfOptions.preferCSSPageSize, true);
});

test('the preference names no page size or margin of its own', () => {
  // This is the contradiction that used to be possible: the browser was handed
  // a `format` and a `preferCSSPageSize`, and whichever won decided the sheet.
  // With the size named only in the page rule, there is nothing left to disagree.
  const { pdfOptions } = pageGeometry({ ...DEFAULT_PAGE_GEOMETRY, size: 'A5' });

  for (const key of ['format', 'width', 'height', 'margin']) {
    assert.ok(!Object.hasOwn(pdfOptions, key), `the browser must not own ${key}`);
  }
  assert.deepEqual(Object.keys(pdfOptions), ['preferCSSPageSize']);
});

test('the rule and the preference come from one call over one value', () => {
  const geometry = { ...DEFAULT_PAGE_GEOMETRY, margin: '3cm' };
  const { css, pdfOptions } = pageGeometry(geometry);

  // A caller cannot obtain one half from a geometry other than the other half's.
  assert.equal(pdfOptions.preferCSSPageSize, true);
  assert.match(css, /var\(--page-margin, 3cm\)/);
});

// ---------------------------------------------------------------------------
// One edit to correct a margin
// ---------------------------------------------------------------------------

test('correcting a page margin is one edit, because the rule exists once', () => {
  const before = pageGeometry().css.split('\n');
  const after = pageGeometry({ ...DEFAULT_PAGE_GEOMETRY, margin: '3.1cm 2.9cm' }).css.split('\n');

  const changed = before.filter((line, index) => line !== after[index]);

  assert.equal(before.length, after.length, 'a correction must not restructure the rule');
  assert.equal(changed.length, 1, `exactly one line changes, got: ${JSON.stringify(changed)}`);
});

test('no bundled theme declares a page rule of its own', async () => {
  for (const name of await bundledThemes()) {
    const css = await readTheme(name);
    assert.ok(!css.includes('@page'), `${name} must not declare @page; the module owns it`);
    assert.ok(!/@bottom-center/.test(css), `${name} must not declare a margin box of its own`);
  }
});

test('every bundled theme supplies geometry as variables', async () => {
  for (const name of await bundledThemes()) {
    const css = await readTheme(name);
    assert.match(
      css,
      new RegExp(`${PAGE_GEOMETRY_VARIABLES.margin}:\\s*[\\d.]`),
      `${name} must set ${PAGE_GEOMETRY_VARIABLES.margin}`,
    );
  }
});

test('no bundled theme styles a cover element nothing can emit', async () => {
  for (const name of await bundledThemes()) {
    const css = await readTheme(name);
    assert.ok(!/\.cover\b/.test(css), `${name} must not carry .cover rules`);
  }
});

test('no bundled theme styles a content wrapper nothing can emit', async () => {
  // The `.content` rules were the other half of the cover pair: cover first,
  // then a forced page break before the body. Nothing in `src/` or `documents/`
  // emits either class, and the cover capability that survives is the opt-in
  // `@page cover` rule in `page-geometry.js`, which needs no element rules.
  for (const name of await bundledThemes()) {
    const css = await readTheme(name);
    assert.ok(!/\.content\b/.test(css), `${name} must not carry .content rules`);
  }
});

// ---------------------------------------------------------------------------
// The invariant contract — one declarative entry per cross-variable rule
// ---------------------------------------------------------------------------

test('a synthetic theme that declares every required variable violates nothing', () => {
  const valid = ':root { --page-margin: 2cm 2.2cm; --page-background: #ffffff; '
    + '--page-footer-color: #333333; }';

  assert.deepEqual(
    violatedInvariants(valid),
    [],
    'a theme declaring the required geometry must pass every registered invariant',
  );
});

test('a theme that omits --page-margin is reported by the invariant it violates', () => {
  const withoutMargin = ':root { --page-background: #ffffff; --page-footer-color: #333333; }';

  const violated = violatedInvariants(withoutMargin);

  assert.deepEqual(
    violated.map((finding) => finding.invariant),
    ['page-margin'],
    'the missing margin must be reported by name, not silently accepted',
  );
  assert.match(
    violated[0].message,
    /--page-margin/,
    'the finding must name the variable a theme author has to add',
  );
});

// ---------------------------------------------------------------------------
// Discovery: the directory is the source of truth
// ---------------------------------------------------------------------------

test('the theme list is discovered from the directory, so a new theme is covered', async () => {
  const themes = await bundledThemes();

  // A literal list would let a sixth theme ship unguarded. Assert discovery
  // actually found the bundled themes, not an empty directory.
  assert.ok(themes.length >= 5, `expected the bundled themes, found: ${themes.join(', ')}`);
  assert.ok(themes.includes('style.css'), 'the default theme must be discovered');
  assert.ok(themes.every((name) => name.endsWith('.css')), 'only stylesheets are themes');
});

// ---------------------------------------------------------------------------
// The footer values this theme declared as its own @page margin box
// ---------------------------------------------------------------------------

test('compact keeps the small, soft footer its old page rule carried', async () => {
  // Regression: when theme @page rules were folded into page-geometry.js, this
  // theme's margin box was dropped and the footer fell back to the 9pt/#888888
  // defaults. Compact's page number is deliberately smaller and darker-neutral
  // so it stays quiet on a dense page. Measured against the page rule, not a
  // theme-local rule: the module owns the rule.
  const compact = await readTheme('compact-style.css');

  assert.match(compact, /--page-footer-font-size:\s*8pt;/, 'compact footer is 8pt, not the 9pt default');
  assert.match(compact, /--page-footer-color:\s*#4a4a4a;/, 'compact footer ink is #4a4a4a');
  assert.match(compact, /--page-background:\s*#ffffff;/, 'compact prints on a white sheet');
});

test('every footer variable a theme sets is one the page rule reads', async () => {
  // The cross-file contract: a theme supplies a variable, the module reads it.
  // A theme setting a name the module never reads would be silently ignored —
  // the same fault class as the compact regression, one step earlier.
  const read = Object.values(PAGE_GEOMETRY_VARIABLES);
  const css = pageGeometry().css;

  for (const name of await bundledThemes()) {
    const theme = await readTheme(name);
    for (const match of theme.matchAll(/(--page-[\w-]+)\s*:/g)) {
      assert.ok(read.includes(match[1]), `${name} sets ${match[1]}, which the page rule never reads`);
      assert.ok(css.includes(`var(${match[1]}`), `${name} sets ${match[1]}, which pageGeometry() does not emit`);
    }
  }
});

test('the page rule is declared in exactly one place across the whole repo', async () => {
  // The structural claim of the ticket: a margin correction is one edit because
  // the rule has one author. Anything else declaring `@page` reintroduces the
  // fault, whether it is a theme, a print stylesheet, or documentation that
  // grows a second copy.
  const sources = [
    ...(await bundledThemes()).map((name) => `../styles/${name}`),
    '../src/core/print-styles/base.css',
    '../src/core/print-styles/mermaid-containment.css',
    '../src/core/print-styles/math.css',
  ];

  const declaring = [];
  for (const relative of sources) {
    const css = await readFile(new URL(relative, import.meta.url), 'utf8');
    if (/@page\b/.test(stripComments(css))) {
      declaring.push(relative);
    }
  }

  assert.deepEqual(
    declaring,
    [],
    `only page-geometry.js may emit @page, but these also declare it: ${declaring.join(', ')}`,
  );
  assert.match(pageGeometry().css, /@page\s*\{/);
});

// ---------------------------------------------------------------------------
// Loud failure
// ---------------------------------------------------------------------------

test('malformed geometry fails loudly instead of emitting broken CSS', () => {
  assert.throws(() => pageGeometry({ ...DEFAULT_PAGE_GEOMETRY, margin: '' }), /margin/i);
  assert.throws(() => pageGeometry({ ...DEFAULT_PAGE_GEOMETRY, size: 42 }), /size/i);
  assert.throws(
    () => pageGeometry({ ...DEFAULT_PAGE_GEOMETRY, margin: '2cm } body { display: none' }),
    /margin/i,
    'a value that closes the rule must be refused, not inlined',
  );
});
