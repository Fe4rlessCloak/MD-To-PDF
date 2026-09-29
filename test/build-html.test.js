import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildHtml } from '../src/core/build-html.js';

const BODY = '<p>Hello <strong>world</strong></p>';
const USER_CSS = '.custom-marker { color: rebeccapurple; }';

test('returns a complete HTML document', () => {
  const html = buildHtml({ bodyHtml: BODY, userCss: null });
  assert.match(html, /^<!DOCTYPE html>/);
  assert.ok(html.trimEnd().endsWith('</html>'));
});

test('embeds the body HTML', () => {
  const html = buildHtml({ bodyHtml: BODY, userCss: null });
  assert.ok(html.includes(BODY));
});

test('includes base, Mermaid, and KaTeX stylesheets', () => {
  const html = buildHtml({ bodyHtml: BODY, userCss: null });
  assert.ok(html.includes('font-family: Georgia'));
  assert.ok(html.includes('.mermaid svg'));
  assert.ok(html.includes('.math-display'));
});

test('injects user CSS when provided', () => {
  const html = buildHtml({ bodyHtml: BODY, userCss: USER_CSS });
  assert.ok(html.includes(USER_CSS));
});

test('omits user CSS when null', () => {
  const html = buildHtml({ bodyHtml: BODY, userCss: null });
  assert.ok(!html.includes(USER_CSS));
});

test('places user CSS before the Mermaid containment styles', () => {
  const html = buildHtml({ bodyHtml: BODY, userCss: USER_CSS });
  assert.ok(html.indexOf(USER_CSS) < html.indexOf('.mermaid svg'));
});

test('includes both bootstrap scripts and completion flags', () => {
  const html = buildHtml({ bodyHtml: BODY, userCss: null });
  assert.ok(html.includes('mermaid.esm.min.mjs'));
  assert.ok(html.includes('katex.mjs'));
  assert.ok(html.includes('__MERMAID_RENDER_DONE__'));
  assert.ok(html.includes('__MATH_RENDER_DONE__'));
});

test('includes the KaTeX stylesheet link', () => {
  const html = buildHtml({ bodyHtml: BODY, userCss: null });
  assert.ok(html.includes('katex.min.css'));
});

test('renders a title when provided and omits it otherwise', () => {
  const withTitle = buildHtml({ bodyHtml: BODY, userCss: null, title: 'My Doc' });
  assert.ok(withTitle.includes('<title>My Doc</title>'));

  const withoutTitle = buildHtml({ bodyHtml: BODY, userCss: null });
  assert.ok(!withoutTitle.includes('<title>'));
});

test('escapes HTML special characters in the title', () => {
  const html = buildHtml({ bodyHtml: BODY, userCss: null, title: 'A & B <C> "D"' });
  assert.ok(html.includes('<title>A &amp; B &lt;C&gt; &quot;D&quot;</title>'));
});

test('bootstrap strips inline Mermaid text colours when a theme opts in', async () => {
  const html = buildHtml({ bodyHtml: BODY, userCss: null });
  assert.ok(html.includes('--mermaid-normalize'));
  assert.ok(html.includes("removeProperty('color')"));

  const oled = await readFile(new URL('../styles/oled-style.css', import.meta.url), 'utf-8');
  assert.ok(oled.includes('--mermaid-normalize: 1'));

  const light = await readFile(new URL('../styles/style.css', import.meta.url), 'utf-8');
  assert.ok(!light.includes('--mermaid-normalize'));
});
