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
