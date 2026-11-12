import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../src/core/render-markdown.js';

test('renders a mermaid fence as a .mermaid container', async () => {
  const html = await renderMarkdown('```mermaid\nflowchart TD\n  A --> B\n```\n');
  assert.ok(html.includes('<div class="mermaid">'));
  assert.ok(html.includes('A --> B'));
  assert.ok(!html.includes('<pre><code'));
});

test('renders inline math as a .math-inline span', async () => {
  const html = await renderMarkdown('Einstein wrote $E=mc^2$ in 1905.');
  assert.ok(html.includes('<span class="math-inline">E=mc^2</span>'));
});

test('renders block math as a .math-display div', async () => {
  const html = await renderMarkdown('$$\n\\int_0^1 x\\,dx\n$$\n');
  assert.ok(html.includes('<div class="math-display">'));
});

test('leaves math inside fenced code blocks untouched', async () => {
  const html = await renderMarkdown('```\n$E=mc^2$\n```\n');
  assert.ok(!html.includes('math-inline'));
  assert.ok(html.includes('$E=mc^2$'));
});

test('leaves math inside inline code spans untouched', async () => {
  const html = await renderMarkdown('Use `$x$` for math.');
  assert.ok(!html.includes('math-inline'));
  assert.ok(html.includes('$x$'));
});

test('does not treat currency as math', async () => {
  const html = await renderMarkdown('It costs $5 and I have $10.');
  assert.ok(!html.includes('math-inline'));
});

test('does not treat escaped dollars as math', async () => {
  const html = await renderMarkdown('Costs \\$5 today.');
  assert.ok(!html.includes('math-inline'));
});

test('still renders ordinary markdown', async () => {
  const html = await renderMarkdown('# Heading\n\nThis is **bold**.\n');
  assert.ok(html.includes('<h1>Heading</h1>'));
  assert.ok(html.includes('<strong>bold</strong>'));
});

test('does not let marked re-mangle math contents', async () => {
  const em = await renderMarkdown('math $x*y*z$ here');
  assert.ok(em.includes('<span class="math-inline">x*y*z</span>'));
  assert.ok(!em.includes('<em>'));

  const strong = await renderMarkdown('math $x**2**$ here');
  assert.ok(strong.includes('<span class="math-inline">x**2**</span>'));
  assert.ok(!strong.includes('<strong>'));

  const code = await renderMarkdown('math $`x`$ here');
  assert.ok(code.includes('<span class="math-inline">`x`</span>'));
  assert.ok(!code.includes('<code>'));
});

test('leaves math inside tilde code fences untouched', async () => {
  const html = await renderMarkdown('~~~\n$x$\n~~~\n');
  assert.ok(!html.includes('math-inline'));
  assert.ok(html.includes('$x$'));
});

test('leaves math inside indented code blocks untouched', async () => {
  const html = await renderMarkdown('text\n\n    $x$ and $$y$$\n');
  assert.ok(!html.includes('math-inline'));
  assert.ok(!html.includes('math-display'));
  assert.ok(html.includes('$x$ and $$y$$'));
});

test('leaves indented block math as literal code', async () => {
  const html = await renderMarkdown('    $$x$$\n');
  assert.ok(!html.includes('math-display'));
  assert.ok(!html.includes('</div>'));
  assert.ok(html.includes('$$x$$'));
});

test('keeps link URLs intact when they contain math', async () => {
  const html = await renderMarkdown('[x](http://a.com/$id$)');
  assert.ok(!html.includes('math-inline'));
  assert.ok(html.includes('href="http://a.com/$id$"'));
});

test('does not emit a block div for $$ math sharing a line with text', async () => {
  const html = await renderMarkdown('Text $$x$$ more.');
  assert.ok(!html.includes('<div class="math-display">'));
  assert.ok(html.includes('<span class="math-inline">x</span>'));
});

test('block math with blank lines stays a single block', async () => {
  const html = await renderMarkdown('$$\n\\alpha\n\n\\beta\n$$\n');
  assert.ok(html.includes('<div class="math-display">'));
  assert.ok(!html.includes('<p>\\beta</p>'));
});

test('renders mermaid fences without a trailing newline', async () => {
  const html = await renderMarkdown('```mermaid\nA-->B\n```');
  assert.ok(html.includes('<div class="mermaid">'));
  assert.ok(!html.includes('<pre><code'));
});

test('renders mermaid fences case-insensitively and with longer fences', async () => {
  const upper = await renderMarkdown('```Mermaid\nA-->B\n```\n');
  assert.ok(upper.includes('<div class="mermaid">'));

  const four = await renderMarkdown('````mermaid\nA-->B\n````\n');
  assert.ok(four.includes('<div class="mermaid">'));
});

test('escapes mermaid source so labels cannot break the container', async () => {
  const html = await renderMarkdown('```mermaid\nA["</div>"] --> B\n```\n');
  assert.ok(html.includes('&lt;/div>'));
  assert.ok(!html.includes('A["</div>"]'));
});
