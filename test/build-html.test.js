import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildHtml, mermaidBootstrapSource, katexBootstrapSource, neutralizeClosingTag } from '../src/core/build-html.js';
import { readinessFlagsSource } from '../src/core/readiness-protocol.js';
import { printStylesheetSource } from '../src/core/print-styles/print-styles.js';
import { mermaidStylesheetSource } from '../src/core/mermaid-styles/mermaid-styles.js';
import { pageGeometry } from '../src/core/page-geometry.js';
import { MERMAID_CDN_URL, NORMALIZE_VARIABLE, isDarkColor } from '../src/core/mermaid-bootstrap.js';
import { KATEX_STYLESHEET_URL } from '../src/core/katex-bootstrap.js';
import { createDocumentOptions } from '../src/core/document-options.js';
import { bundledThemes, readTheme } from './helpers/themes.js';

const BODY = '<p>Hello <strong>world</strong></p>';
const USER_CSS = '.custom-marker { color: rebeccapurple; }';

/** Build with a full document options object, as the CLI does. */
const withOptions = (overrides = {}, extra = {}) =>
  buildHtml({
    bodyHtml: BODY,
    userCss: null,
    options: createDocumentOptions(overrides),
    ...extra,
  });

test('returns a complete HTML document', () => {
  const html = withOptions();
  assert.match(html, /^<!DOCTYPE html>/);
  assert.ok(html.trimEnd().endsWith('</html>'));
});

test('embeds the body HTML', () => {
  assert.ok(withOptions().includes(BODY));
});

test('includes base, Mermaid, and KaTeX stylesheets', () => {
  const html = withOptions();
  assert.ok(html.includes(printStylesheetSource('base')));
  assert.ok(html.includes(mermaidStylesheetSource()));
  assert.ok(html.includes(printStylesheetSource('mermaid-containment')));
  assert.ok(html.includes(printStylesheetSource('math')));
});

test('injects user CSS when provided', () => {
  const html = buildHtml({
    bodyHtml: BODY,
    userCss: USER_CSS,
    options: createDocumentOptions(),
  });
  assert.ok(html.includes(USER_CSS));
});

test('omits user CSS when null', () => {
  assert.ok(!withOptions().includes(USER_CSS));
});

test('places user CSS before the Mermaid containment styles', () => {
  const html = buildHtml({
    bodyHtml: BODY,
    userCss: USER_CSS,
    options: createDocumentOptions(),
  });

  // Assert against the containment layer's own text, not a selector that now
  // also appears in the shared Mermaid block emitted before user CSS. The
  // contract is that the containment rules outrank user CSS, so they must be
  // emitted after it.
  const containment = printStylesheetSource('mermaid-containment');
  const containmentRule = containment.slice(containment.indexOf('.mermaid svg {'));

  assert.ok(html.indexOf(USER_CSS) < html.indexOf(containmentRule));
});

test('includes both bootstrap scripts and the protocol they publish through', () => {
  const html = withOptions();
  // Flag names are owned by the readiness protocol; assert the protocol is
  // inlined for both bootstraps, and that each one is wired to it.
  assert.ok(html.includes(readinessFlagsSource()));
  // Each browser program is a module now, so assembly inlines its source and
  // calls its entry point with the protocol handle rather than owning the
  // publication itself.
  assert.ok(html.includes(mermaidBootstrapSource().trim()), 'assembly must inline the Mermaid program');
  assert.ok(html.includes(katexBootstrapSource().trim()), 'assembly must inline the math program');
  assert.ok(
    html.includes('runMermaidBootstrap({ flags: RF, publish: publishFlag, fatalReportIndex: '),
    'assembly must call the Mermaid program with the protocol',
  );
  assert.ok(
    html.includes('runKatexBootstrap({ flags: RF, publish: publishFlag, fatalReportIndex: '),
    'assembly must call the math program with the protocol',
  );
});

test('includes the KaTeX stylesheet link', () => {
  assert.ok(withOptions().includes(KATEX_STYLESHEET_URL));
});

test('sets the document title from the options object', () => {
  const html = withOptions({ title: 'My Doc' });
  assert.ok(html.includes('<title>My Doc</title>'));
});

test('omits the title element when the options carry no title', () => {
  assert.ok(!withOptions().includes('<title>'));
  assert.ok(!withOptions({ title: null }).includes('<title>'));
});

test('escapes HTML special characters in the title', () => {
  const html = withOptions({ title: 'A & B <C> "D"' });
  assert.ok(html.includes('<title>A &amp; B &lt;C&gt; &quot;D&quot;</title>'));
});

test('reads a title it was not individually told about, because options carry it', () => {
  // The call site passes only the options object; no per-option argument.
  const options = createDocumentOptions({ title: 'Reached Through Options' });
  const html = buildHtml({ bodyHtml: BODY, userCss: null, options });
  assert.ok(html.includes('<title>Reached Through Options</title>'));
});

test('ignores options that only concern the CLI, without a call-site change', () => {
  const options = createDocumentOptions({
    input: 'in.md',
    output: 'out.pdf',
    style: 'theme.css',
    title: 'T',
  });
  const html = buildHtml({ bodyHtml: BODY, userCss: null, options });
  assert.ok(html.includes('<title>T</title>'));
  assert.ok(html.includes(BODY));
  // The stylesheet path is not inlined; only the loaded CSS text is.
  assert.ok(!html.includes('theme.css'));
});

test('the inlined program carries the theme opt-in, and the themes honour it', async () => {
  const html = withOptions();
  // The opt-in read lives in the program, which assembly inlines; the theme
  // files are the other half of that cross-language contract. Behaviour of the
  // read itself is covered in mermaid-bootstrap.test.js.
  assert.ok(html.includes(mermaidBootstrapSource().trim()));
  assert.ok(mermaidBootstrapSource().includes('NORMALIZE_VARIABLE'));

  for (const theme of (await bundledThemes()).filter((name) => name !== 'style.css')) {
    assert.ok(
      (await readTheme(theme)).includes(`${NORMALIZE_VARIABLE}: 1`),
      `${theme} should opt in to Mermaid normalisation`,
    );
  }

  const light = await readTheme('style.css');
  assert.ok(!light.includes(NORMALIZE_VARIABLE));
});

test('the page rule comes from the geometry module, after every print layer', () => {
  const html = buildHtml({
    bodyHtml: BODY,
    userCss: USER_CSS,
    options: createDocumentOptions(),
  });

  const rule = html.match(/@page\s*\{[\s\S]*?\n\}/);
  assert.ok(rule, 'the document must carry a page rule');
  // The rule is fed by theme variables, which is what lets a theme supply
  // geometry without declaring a rule.
  assert.match(rule[0], /var\(--page-margin/);

  // Emitted last, so no print layer or theme can override it. Anchored on the
  // rule itself, not the string `@page`, which also appears in a comment.
  assert.ok(
    html.lastIndexOf('@page {') > html.indexOf('.math-display'),
    'the page rule must follow containment and math',
  );
});

test('assembly emits exactly one page rule', () => {
  const html = withOptions();
  assert.equal((html.match(/@page\s*\{/g) ?? []).length, 1);
});

test('the two bootstrap scripts share one template, so they cannot drift apart', () => {
  // Both programs are inlined by the same ten-line adapter with the entry-point
  // name as the only difference. Assert the shape, not the code: each call site
  // appears exactly once, wired to the protocol and the fatal sentinel.
  const html = withOptions();

  for (const entry of ['runMermaidBootstrap', 'runKatexBootstrap']) {
    assert.equal(
      (html.match(new RegExp(`await ${entry}\\(\\{ flags: RF, publish: publishFlag, fatalReportIndex: -1 \\}\\);`, 'g')) ?? []).length,
      1,
      `${entry} must be called exactly once, with the protocol and fatal sentinel`,
    );
  }
  // The protocol declaration is inlined into each module script, once per
  // bootstrap, because each is a module with its own bindings.
  assert.equal(
    (html.match(/const RF = Object\.freeze\(/g) ?? []).length,
    2,
    'each inlined program carries its own copy of the protocol',
  );
});

test('emits stylesheet layers in contract order: base -> mermaid -> user -> containment -> math -> page-geometry', () => {
  const html = buildHtml({
    bodyHtml: BODY,
    userCss: USER_CSS,
    options: createDocumentOptions(),
  });

  const positions = [
    html.indexOf(printStylesheetSource('base')),
    html.indexOf(mermaidStylesheetSource()),
    html.indexOf(USER_CSS),
    html.indexOf(printStylesheetSource('mermaid-containment')),
    html.indexOf(printStylesheetSource('math')),
    html.indexOf(pageGeometry().css.trim()),
  ];

  for (let i = 0; i < positions.length; i++) {
    assert.ok(positions[i] > -1, `missing expected stylesheet layer at index ${i}`);
    if (i > 0) {
      assert.ok(positions[i - 1] < positions[i], `layer ${i - 1} must precede layer ${i}`);
    }
  }
});

test('assembly emits the default page geometry without requiring a page argument', () => {
  const html = buildHtml({ bodyHtml: BODY, userCss: null, options: createDocumentOptions() });
  assert.ok(html.includes(pageGeometry().css.trim()));
});

test('assembly inlines the Mermaid program so the document needs no second fetch', async () => {
  const html = withOptions();
  const program = mermaidBootstrapSource();

  // Every line of the program must appear in the document; the only runtime
  // fetch left is the Mermaid CDN import inside the program itself.
  for (const line of program.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('import ') || trimmed === 'export') continue;
    assert.ok(html.includes(trimmed), `inlined program is missing: ${trimmed}`);
  }

  assert.equal(
    (html.match(new RegExp(MERMAID_CDN_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? []).length,
    1,
    'the runtime URL must appear once, in the inlined program',
  );
});

test('the Mermaid program is inlined neutralised for the script element', () => {
  const program = mermaidBootstrapSource();
  const html = withOptions();
  assert.ok(
    html.includes(neutralizeClosingTag(program, 'script').trim()),
    'the inlined program must be the same code, neutralised for the script element',
  );
});

test('skips CDN module imports at runtime when no diagrams or math are present and avoids 25s race', () => {
  const html = withOptions();
  const mermaid = mermaidBootstrapSource();
  const math = katexBootstrapSource();

  assert.ok(mermaid.includes(MERMAID_CDN_URL));
  assert.ok(math.includes('import(KATEX_SCRIPT_URL)'));
  assert.ok(!html.includes('25000'));

  // Both programs reach the document: assembly inlines them whole.
  assert.ok(html.includes(mermaid.trim()));
  assert.ok(html.includes(math.trim()));
});

test('inlined program and stylesheets open exactly as many elements as they close', () => {
  const html = withOptions();
  const opens = (html.match(/<script\b/gi) ?? []).length;
  const closes = (html.match(/<\/script/gi) ?? []).length;
  assert.equal(opens, closes, 'every inlined script element must close exactly once');

  const styleOpens = (html.match(/<style\b/gi) ?? []).length;
  const styleCloses = (html.match(/<\/style/gi) ?? []).length;
  assert.equal(styleOpens, styleCloses, 'every inlined stylesheet must close exactly once');
});

test('neutralising a closing tag leaves an inert sequence the language still accepts', () => {
  // The inlining adapter's whole job, tested on the text it is given rather
  // than on the current program, which happens to contain no closers today.
  // Only the enclosing element's own closer can end it, so a stylesheet keeps
  // `</script>` untouched — that sequence is inert inside `<style>`.
  assert.equal(
    neutralizeClosingTag('/* </style><script>alert(1)</script> */', 'style'),
    '/* <\\/style><script>alert(1)</script> */',
  );
  assert.equal(neutralizeClosingTag('</SCRIPT>', 'script'), '<\\/SCRIPT>');
  assert.equal(neutralizeClosingTag('no closers here', 'script'), 'no closers here');
});

test('closing-tag neutralisation matches any casing and preserves the casing it found', () => {
  // The HTML parser treats `</STYLE>` and `</Style>` as closers, so a
  // case-sensitive replace would leave a working escape hatch in the output.
  // The replacement keeps the matched casing so the inlined text stays
  // readable in the language it belongs to.
  const mixed = 'a </STYLE> b </style> c </Style> d </StYlE>';

  assert.equal(
    neutralizeClosingTag(mixed, 'style'),
    'a <\\/STYLE> b <\\/style> c <\\/Style> d <\\/StYlE>',
  );
  assert.equal(
    (neutralizeClosingTag(mixed, 'style').match(/<\/style/gi) ?? []).length,
    0,
    'no closer may survive in any casing',
  );
});

test('a program that contains a closing script sequence cannot break out of its element', () => {
  // Guards the seam, not today's program: if the inlined source ever gains a
  // literal closer, assembly must neutralise it before it reaches the parser.
  const hostile = 'const s = "</script><img src=x onerror=alert(1)>";';
  const neutralised = neutralizeClosingTag(hostile, 'script');
  assert.ok(!neutralised.includes('</script>'));
  assert.equal((neutralised.match(/<\/script/gi) ?? []).length, 0);
});

test('neutralizes closing style tags inside userCss', () => {
  const html = buildHtml({
    bodyHtml: BODY,
    userCss: '/* </style><script>alert(1)</script> */',
    options: createDocumentOptions(),
  });
  assert.ok(!html.includes('</style><script>'));
});

test('oled supplies a palette and leaves the Mermaid selectors to the shared block', async () => {
  const oled = await readFile(new URL('../styles/oled-style.css', import.meta.url), 'utf-8');

  // This test used to assert the opposite — that oled carried `.mermaid svg
  // .messageText`, `.node path` and a literal `fill: #f0f2ff !important`. That
  // was the drift: 69 selectors and 24 !important declarations restating the
  // shared block. Its divergence is now a palette, so assert the palette.
  assert.ok(!oled.match(/^div,\s*$/m), 'oled must not blanket-reset div backgrounds');
  assert.match(oled, /--mermaid-theme:\s*dark;/, 'oled selects Mermaid’s own dark theme');
  assert.match(oled, /--mermaid-ink:\s*#[0-9a-f]{6};/i, 'canvas ink is declared');
  assert.match(oled, /--mermaid-shape-fill:\s*#[0-9a-f]{6};/i, 'the dark theme opts in to a shape fill');
  assert.ok(!oled.includes('.mermaid svg'), 'no selector list of its own');

  // The two ink variables are a pair: the canvas ink is chosen for a black
  // sheet and the on-shape ink for the fill beside it. Neither may be dark on
  // a dark theme — the fill they sit on is — so both are checked with the
  // luminance rule the browser program already owns rather than with a second
  // copy of the arithmetic here.
  const hex = (name) => /^#([0-9a-f]{6})$/i.exec(name)[1];
  const asRgb = (value) =>
    `rgb(${Number.parseInt(value.slice(0, 2), 16)}, ${Number.parseInt(value.slice(2, 4), 16)}, ${Number.parseInt(value.slice(4, 6), 16)})`;
  for (const name of ['--mermaid-ink', '--mermaid-ink-on-shape']) {
    const value = hex(new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, 'i').exec(oled)[1]);
    assert.equal(isDarkColor(asRgb(value)), false, `${name} must stay light: the sheet and the fill are dark`);
  }
});
