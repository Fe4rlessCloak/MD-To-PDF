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
 *
 * Themes are the other half of the contract, and they are untyped CSS that can
 * arrive wrong: a theme can omit its margin, or paint a dark sheet and leave a
 * page number tuned for white paper. Two guards close that: the theme variable
 * names the page rule reads must stay in step with what the themes set, and
 * {@link PAGE_GEOMETRY_INVARIANTS} states the cross-variable rules every theme
 * must satisfy. The invariant sweep discovers themes from `styles/`, so a sixth
 * theme is checked the moment its file exists — no list to update.
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

test('a theme that paints a sheet background without footer ink is reported as a contrast fault', () => {
  const unreadableFooter = ':root { --page-margin: 2cm; --page-background: #101010; }';

  const violated = violatedInvariants(unreadableFooter);

  assert.deepEqual(
    violated.map((finding) => finding.invariant),
    ['footer-contrast'],
    'a painted sheet without matching footer ink is the fault the rule exists for',
  );
  assert.deepEqual(
    violated[0].missing,
    ['--page-footer-color'],
    'the finding must name the ink the theme has to declare',
  );
});

test('the contrast rule does not apply to a theme that leaves the sheet unpainted', () => {
  // The rule is conditional by design: a theme that inherits the transparent
  // default never needs its own footer ink, and demanding one would duplicate
  // DEFAULT_PAGE_GEOMETRY into every theme.
  const unpainted = ':root { --page-margin: 2cm; }';

  assert.deepEqual(
    violatedInvariants(unpainted),
    [],
    'an unpainted theme must not be forced to declare footer ink',
  );
});

// ---------------------------------------------------------------------------
// Discovery: the directory is the source of truth
// ---------------------------------------------------------------------------

test('a required variable declared with no value counts as missing, as it does for Mermaid palette variables', () => {
  // `--page-margin: ;` resolves to the empty string in var(), so the browser
  // drops the declaration and falls back — a theme that looks like it sets a
  // margin sets nothing.
  const hollow = ':root { --page-margin: ; --page-background: #ffffff; '
    + '--page-footer-color: #333333; }';

  const violated = violatedInvariants(hollow);

  assert.deepEqual(
    violated.map((finding) => finding.invariant),
    ['page-margin'],
    'an empty declaration is a missing one',
  );
  assert.deepEqual(
    violated[0].missing,
    ['--page-margin'],
    'the finding names the missing variable, so a theme author knows what to add',
  );
});

test('a conditional requirement declared with no value still violates the contrast invariant', () => {
  const hollowInk = ':root { --page-margin: 2cm; --page-background: #000000; '
    + '--page-footer-color: ; }';

  assert.deepEqual(
    violatedInvariants(hollowInk).map((finding) => finding.invariant),
    ['footer-contrast'],
    'a hollow footer ink is not contrast; the sheet still has no readable page number',
  );
});

test('a hollow --page-background paints nothing, so the contrast rule does not activate', () => {
  // `--page-background: ;` resolves to the empty string, the declaration is
  // dropped, and the sheet falls back to the transparent default. The rule is
  // about a painted sheet, so a hollow declaration must not demand footer ink.
  const hollowSheet = ':root { --page-margin: 2cm; --page-background: ; }';

  assert.deepEqual(
    violatedInvariants(hollowSheet),
    [],
    'a sheet that is not painted does not need its own page-number ink',
  );
});

test('a variable named only in a comment is not a declaration', () => {
  // The theme headers explain what the module owns and mention variables by
  // name. A check that could not tell prose from a declaration would forbid the
  // explanation, which is why the evaluator strips comments first.
  const proseOnly = [
    '/* --page-margin: 2cm 2.2cm; --page-background: #000; --page-footer-color: #fff; */',
    ':root { --page-margin: 2cm; }',
  ].join('\n');

  assert.deepEqual(
    violatedInvariants(proseOnly),
    [],
    'a commented-out declaration must not satisfy or create an invariant',
  );

  const commentHidesFault = [
    '/* a painted sheet would need --page-footer-color here */',
    ':root { --page-margin: 2cm; --page-background: #101010; }',
  ].join('\n');

  assert.deepEqual(
    violatedInvariants(commentHidesFault).map((finding) => finding.invariant),
    ['footer-contrast'],
    'a comment mentioning the missing ink must not excuse it',
  );
});

test('every registered invariant names what it requires and why', () => {
  assert.ok(PAGE_GEOMETRY_INVARIANTS.length >= 2, 'both the margin and contrast rules must be registered');

  const names = new Set();
  for (const invariant of PAGE_GEOMETRY_INVARIANTS) {
    assert.match(invariant.name, /^[a-z][\w-]*$/, `${invariant.name} must be a lowercase rule name`);
    assert.ok(!names.has(invariant.name), `${invariant.name} is registered twice`);
    names.add(invariant.name);

    assert.match(invariant.purpose, /\S/, `${invariant.name} must say why it exists`);
    assert.ok(Array.isArray(invariant.requires) && invariant.requires.length > 0,
      `${invariant.name} must name the variables it requires`);
    for (const required of invariant.requires) {
      assert.ok(
        Object.values(PAGE_GEOMETRY_VARIABLES).includes(required),
        `${invariant.name} requires ${required}, which is not a page-geometry variable`,
      );
    }
    assert.ok(invariant.when === null || typeof invariant.when === 'string',
      `${invariant.name} must declare when it applies, as null or a variable name`);
  }
});

test('the contract is frozen, so a test cannot register an invariant by mutating it', () => {
  assert.ok(Object.isFrozen(PAGE_GEOMETRY_INVARIANTS), 'the invariant list must be frozen');
  for (const invariant of PAGE_GEOMETRY_INVARIANTS) {
    assert.ok(Object.isFrozen(invariant), `${invariant.name} must be frozen`);
    assert.ok(Object.isFrozen(invariant.requires), `${invariant.name} requires list must be frozen`);
  }
  assert.throws(
    () => { PAGE_GEOMETRY_INVARIANTS.push({ name: 'x' }); },
    TypeError,
    'pushing a rule must fail loudly rather than silently changing the contract',
  );
});

test('every registered rule is enforced, and the rule list is not restated here', () => {
  // The point of a declarative contract is that a rule added to it is enforced
  // with no test edit. So this asserts the property that makes that true — the
  // evaluator reports every registered rule that a theme breaks, for whatever
  // the list currently contains — rather than pinning the list itself. Pinning
  // it would re-introduce the very maintenance burden the contract removes.
  assert.ok(PAGE_GEOMETRY_INVARIANTS.length >= 2, 'both the margin and contrast rules must be registered');

  // A theme that declares nothing breaks every unconditional rule, and the
  // contrast rule too (no background means nothing to contrast against, so
  // only the margin rule applies). Whatever is registered, the evaluator must
  // report the unconditional ones by their own names.
  const empty = ':root { }';
  const reported = violatedInvariants(empty).map((finding) => finding.invariant);
  const unconditional = PAGE_GEOMETRY_INVARIANTS
    .filter((invariant) => invariant.when === null)
    .map((invariant) => invariant.name);

  assert.deepEqual(
    reported,
    unconditional,
    'every unconditional rule is enforced against a theme that declares nothing',
  );

  // A theme violating two rules at once reports both, not just the first.
  const doublyBroken = ':root { --page-background: #101010; }';
  const expected = PAGE_GEOMETRY_INVARIANTS
    .filter((invariant) => invariant.when === null || invariant.when === '--page-background')
    .map((invariant) => invariant.name);

  assert.deepEqual(
    violatedInvariants(doublyBroken).map((finding) => finding.invariant),
    expected,
    'every violation is reported, so a theme author fixes them in one pass',
  );
});


test('every bundled theme satisfies every registered geometry invariant', async () => {
  // Discovered, never listed: a sixth theme opts itself in by existing, which
  // is the property the ticket is really about.
  for (const name of await bundledThemes()) {
    const violated = violatedInvariants(await readTheme(name));

    assert.deepEqual(
      violated.map((finding) => finding.message),
      [],
      `${name} violates the page-geometry contract:\n${violated.map((finding) => finding.message).join('\n')}`,
    );
  }
});

test('a theme may omit the optional footer typography and stay valid', () => {
  // DEFAULT_PAGE_GEOMETRY owns the default typography. A theme that inherits
  // it must not have to copy the values in, which is the bloat this contract
  // is shaped to avoid.
  const inheriting = ':root { --page-margin: 2cm 2.2cm; --page-background: #ffffff; '
    + '--page-footer-color: #444444; }';

  assert.deepEqual(
    violatedInvariants(inheriting),
    [],
    'omitting --page-footer-font-size, --page-footer-font-weight and '
    + '--page-footer-content must not be a violation',
  );

  for (const optional of [
    PAGE_GEOMETRY_VARIABLES.footerFontSize,
    PAGE_GEOMETRY_VARIABLES.footerFontWeight,
    PAGE_GEOMETRY_VARIABLES.footerContent,
  ]) {
    assert.ok(
      !PAGE_GEOMETRY_INVARIANTS.some((invariant) => invariant.requires.includes(optional)),
      `${optional} must stay optional; DEFAULT_PAGE_GEOMETRY owns that default`,
    );
  }
});

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

test('contrast keeps the heavier, black footer its old page rule carried', async () => {
  // Regression: contrast's page number is 10pt/600/#000000 to meet its
  // maximum-contrast brief. These are deliberate overrides of the 9pt/400/
  // #888888 defaults, and they are the only reason this theme needs any footer
  // typography at all — the rest still inherits DEFAULT_PAGE_GEOMETRY.
  const contrast = await readTheme('contrast-style.css');

  assert.match(contrast, /--page-footer-font-size:\s*10pt;/, 'contrast footer is 10pt, not the 9pt default');
  assert.match(contrast, /--page-footer-font-weight:\s*600;/, 'contrast footer is 600, not the 400 default');
  assert.match(contrast, /--page-footer-color:\s*#000000;/, 'contrast footer ink is black');
  assert.match(contrast, /--page-background:\s*#ffffff;/, 'contrast paints its own white sheet');
});

test('compact and contrast, the themes with deliberate footer typography, both keep it', async () => {
  // One assertion for the pair the ticket names, so a future edit that
  // "tidies" footer overrides out of either theme fails by name.
  const overrides = {
    'compact-style.css': { size: '8pt', color: '#4a4a4a' },
    'contrast-style.css': { size: '10pt', weight: '600', color: '#000000' },
  };

  for (const [name, expected] of Object.entries(overrides)) {
    const css = await readTheme(name);
    for (const [field, value] of Object.entries(expected)) {
      const property = field === 'size'
        ? '--page-footer-font-size'
        : field === 'weight' ? '--page-footer-font-weight' : '--page-footer-color';
      assert.match(
        css,
        new RegExp(`${property}:\\s*${value};`),
        `${name} must keep ${property}: ${value}; it is a deliberate override, not a default`,
      );
    }
  }
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
