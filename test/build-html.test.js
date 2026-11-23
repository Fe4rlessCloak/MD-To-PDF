import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildHtml, mermaidBootstrapSource, katexBootstrapSource, neutralizeClosingTag } from '../src/core/build-html.js';
import { readinessFlagsSource } from '../src/core/readiness-protocol.js';
import { createDocumentOptions } from '../src/core/document-options.js';

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
  assert.ok(html.includes('font-family: Georgia'));
  assert.ok(html.includes('.mermaid svg'));
  assert.ok(html.includes('.math-display'));
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
  assert.ok(html.indexOf(USER_CSS) < html.indexOf('.mermaid svg'));
});

test('includes both bootstrap scripts and the protocol they publish through', () => {
  const html = withOptions();
  assert.ok(html.includes('mermaid.esm.min.mjs'));
  assert.ok(html.includes('katex.mjs'));
  // Flag names are owned by the readiness protocol; assert the protocol is
  // inlined for both bootstraps, and that each one is wired to it.
  assert.ok(html.includes(readinessFlagsSource()));
  // Each browser program is a module now, so assembly inlines its source and
  // calls its entry point with the protocol handle rather than owning the
  // publication itself.
  assert.ok(html.includes(mermaidBootstrapSource().trim()), 'assembly must inline the Mermaid program');
  assert.ok(html.includes(katexBootstrapSource().trim()), 'assembly must inline the math program');
  assert.ok(
    html.includes('runMermaidBootstrap({ flags: RF, fatalReportIndex: '),
    'assembly must call the Mermaid program with the protocol',
  );
  assert.ok(
    html.includes('runKatexBootstrap({ flags: RF, fatalReportIndex: '),
    'assembly must call the math program with the protocol',
  );
});

test('includes the KaTeX stylesheet link', () => {
  assert.ok(withOptions().includes('katex.min.css'));
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
  assert.ok(html.includes('--mermaid-normalize'));
  assert.ok(html.includes("removeProperty('color')"));

  const readTheme = (name) =>
    readFile(new URL(`../styles/${name}`, import.meta.url), 'utf-8');

  for (const theme of [
    'oled-style.css',
    'paper-style.css',
    'contrast-style.css',
    'compact-style.css',
  ]) {
    assert.ok(
      (await readTheme(theme)).includes('--mermaid-normalize: 1'),
      `${theme} should opt in to Mermaid normalisation`,
    );
  }

  const light = await readTheme('style.css');
  assert.ok(!light.includes('--mermaid-normalize'));
});

test('base CSS provides an @page margin fallback before user CSS', () => {
  const html = buildHtml({
    bodyHtml: BODY,
    userCss: USER_CSS,
    options: createDocumentOptions(),
  });
  assert.match(html, /@page\s*\{[^}]*margin:/);
  assert.ok(html.indexOf('@page') < html.indexOf(USER_CSS));
});

test('assembly inlines the Mermaid program so the document needs no second fetch', async () => {
  const { readFile } = await import('node:fs/promises');
  const html = withOptions();
  const program = await readFile(
    new URL('../src/core/mermaid-bootstrap.js', import.meta.url),
    'utf-8',
  );

  // Every line of the program must appear in the document; the only runtime
  // fetch left is the Mermaid CDN import inside the program itself.
  for (const line of program.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('import ') || trimmed === 'export' ) continue;
    assert.ok(html.includes(trimmed), `inlined program is missing: ${trimmed}`);
  }

  assert.equal(
    (html.match(/mermaid\.esm\.min\.mjs/g) ?? []).length,
    1,
    'the runtime URL must appear once, in the inlined program',
  );
});

test('the Mermaid program renders per-node and always signals done', async () => {
  const { readFile } = await import('node:fs/promises');
  const program = await readFile(
    new URL('../src/core/mermaid-bootstrap.js', import.meta.url),
    'utf-8',
  );

  assert.ok(program.includes('mermaid.render('));
  assert.ok(program.includes('finally'), 'completion must be published in a finally');
  assert.ok(program.includes('view[flags.mermaidRenderDone] = true'));

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

  // Each program guards its CDN import behind a node-count check and waits on
  // a promise rather than a timer, so a document with no diagrams and no math
  // fetches nothing and no clock is involved.
  assert.ok(mermaid.includes('if (nodes.length > 0)'));
  assert.ok(math.includes('if (displayNodes.length > 0 || inlineNodes.length > 0)'));
  assert.ok(math.includes('view[flags.mermaidReady]'));
  assert.ok(!html.includes('25000'));
  assert.ok(math.includes('view[flags.mathErrors]'));
  assert.ok(math.includes('el.textContent = raw'));

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

test('oled stylesheet preserves element backgrounds and uses light ink on canvas Mermaid labels', async () => {
  const oled = await readFile(new URL('../styles/oled-style.css', import.meta.url), 'utf-8');
  assert.ok(!oled.match(/^div,\s*$/m));
  assert.ok(oled.includes('.mermaid svg .messageText'));
  assert.ok(oled.includes('fill: #f0f2ff !important'));
  assert.ok(oled.includes('.mermaid svg .node path'));
});
