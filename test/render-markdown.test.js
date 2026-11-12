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

test('escapes HTML inside code and link URLs containing dollar signs', async () => {
  const inline = await renderMarkdown('Use `$a<b$` and `$c>d$` in code.');
  assert.ok(inline.includes('<code>$a&lt;b$</code>'));
  assert.ok(inline.includes('<code>$c&gt;d$</code>'));

  const indented = await renderMarkdown('    $<img src=x onerror=alert(1)>$\n');
  assert.ok(indented.includes('&lt;img src=x'));
  assert.ok(!indented.includes('<img '));

  const link = await renderMarkdown('[link](http://a.com/$a"b$)');
  assert.ok(!link.includes('href="http://a.com/$a"'));
  assert.ok(link.includes('href="http://a.com/$a%22b$"'));
});

test('does not swallow prose between lines starting and ending with $$', async () => {
  const doc = await renderMarkdown('$$a$$ is first.\n\nProse **here**.\n\n$$b$$');
  assert.ok(doc.includes('<span class="math-inline">a</span>'));
  assert.ok(doc.includes('<strong>here</strong>'));
  assert.ok(doc.includes('<div class="math-display">\nb\n</div>'));

  const sameLine = await renderMarkdown('$$a$$ and $$b$$');
  assert.ok(!sameLine.includes('<div class="math-display">'));
  assert.ok(sameLine.includes('<span class="math-inline">a</span> and <span class="math-inline">b</span>'));
});

test('triple-backtick inline code spans and adjacent code spans do not corrupt math', async () => {
  const triple = await renderMarkdown('```$x$``` is inline code\n\nReal math: $y = 1$.\n');
  assert.ok(triple.includes('<code>$x$</code>'));
  assert.ok(triple.includes('<span class="math-inline">y = 1</span>'));

  const adjacent = await renderMarkdown('Price `$5` and `$10`');
  assert.ok(adjacent.includes('<code>$5</code> and <code>$10</code>'));
});

test('handles indented, empty, and non-mixed mermaid fences cleanly', async () => {
  const indented = await renderMarkdown('  ```mermaid\nA[$x$] --> B\n  ```\n');
  assert.ok(indented.includes('<div class="mermaid">'));
  assert.ok(!indented.includes('math-inline'));
  assert.ok(indented.includes('A[$x$] --> B'));

  const empty = await renderMarkdown('```mermaid\n```\n');
  assert.ok(empty.includes('<div class="mermaid">'));

  const mixed = await renderMarkdown('```mermaid\nA-->B\n~~~\n');
  assert.ok(!mixed.includes('<div class="mermaid">'));
});

test('handles self-closing code tags, escaped dollars, currency ranges, CRLF, and nested blocks', async () => {
  const selfClose = await renderMarkdown('<code/> hello $x$');
  assert.ok(selfClose.includes('<span class="math-inline">x</span>'));

  const escInside = await renderMarkdown('$\\text{price } \\$5$');
  assert.ok(escInside.includes('<span class="math-inline">\\text{price } \\$5</span>'));

  const range = await renderMarkdown('Cost is $5-$10.');
  assert.ok(!range.includes('math-inline'));

  const crlf = await renderMarkdown('Intro\r\n\r\n$$\r\nE = mc^2\r\n$$\r\n');
  assert.ok(crlf.includes('<div class="math-display">\nE = mc^2\n</div>'));

  const listBlock = await renderMarkdown('- Item 1\n\n  $$\n  E=mc^2\n  $$\n\n- Item 2\n');
  assert.equal((listBlock.match(/<ul>/g) || []).length, 1);
  assert.ok(listBlock.includes('<div class="math-display">\nE=mc^2\n</div>'));
});
