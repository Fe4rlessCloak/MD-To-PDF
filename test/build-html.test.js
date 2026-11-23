import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildHtml } from '../src/core/build-html.js';
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

test('includes both bootstrap scripts and completion flags', () => {
  const html = withOptions();
  assert.ok(html.includes('mermaid.esm.min.mjs'));
  assert.ok(html.includes('katex.mjs'));
  // Flag names are owned by the readiness protocol; assert the reference the
  // bootstraps actually make, and that the protocol is inlined for them.
  assert.ok(html.includes(readinessFlagsSource()));
  assert.ok(html.includes(`window[RF.mermaidRenderDone] = true`));
  assert.ok(html.includes(`window[RF.mathRenderDone] = true`));
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

test('bootstrap strips inline Mermaid text colours when a theme opts in', async () => {
  const html = withOptions();
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

test('mermaid bootstrap renders diagrams per-node and always signals done', () => {
  const html = withOptions();
  assert.ok(html.includes('mermaid.render('));
  assert.ok(html.includes('window[RF.mermaidErrors].push('));
  assert.ok(html.includes('finally'));
});

test('skips CDN module imports at runtime when no diagrams or math are present and avoids 25s race', () => {
  const html = withOptions();
  assert.ok(html.includes('if (nodes.length > 0)'));
  assert.ok(html.includes('if (displayNodes.length > 0 || inlineNodes.length > 0)'));
  assert.ok(html.includes('window[RF.mermaidReady]'));
  assert.ok(!html.includes('25000'));
  assert.ok(html.includes('window[RF.mathErrors]'));
  assert.ok(html.includes('el.textContent = raw'));
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
