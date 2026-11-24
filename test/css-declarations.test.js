/**
 * @file Tests for the CSS declaration reader.
 *
 * Two modules read custom-property declarations out of theme stylesheets, and
 * both depend on the same three judgements: a comment is not a declaration, an
 * empty declaration is a missing one, and a value wrapped across lines is
 * still one value. Getting any of them wrong fails silently in the caller —
 * a hollow theme reads as a complete one — so the shared reader is pinned here
 * once rather than re-proven in each module's suite.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  declarations,
  emptyNames,
  stripComments,
} from '../src/core/css-declarations.js';

test('comments are stripped, so prose about a property is not a declaration', () => {
  const css = [
    '/* --page-margin: 3cm; says what the module owns, not what this theme sets */',
    ':root { --page-margin: 2cm; }',
  ].join('\n');

  assert.deepEqual([...declarations(css).declared], ['--page-margin']);
});

test('an unterminated block comment does not swallow the file', () => {
  // A theme mid-edit could ship one; the reader must not silently empty its
  // answer, because an empty answer reads as "declares nothing" rather than
  // "could not parse".
  assert.equal(stripComments('/* unterminated'), '/* unterminated');
});

test('a hollow declaration is reported as present but empty', () => {
  const { declared, empty } = declarations(':root { --page-footer-color: ; }');

  assert.ok(declared.has('--page-footer-color'), 'the name is declared');
  assert.ok(empty.has('--page-footer-color'), 'but it carries no value');
});

test('whitespace-only values and the no-space form both read as empty', () => {
  const { empty: noSpace } = declarations(':root { --page-margin:; }');
  const { empty: spaces } = declarations(':root { --page-margin:    ; }');

  assert.ok(noSpace.has('--page-margin'));
  assert.ok(spaces.has('--page-margin'));
});

test('a value wrapped onto the next line is read as a value, not an empty declaration', () => {
  // The declaration this reader replaced matched `:`-then-end-of-line, so a
  // theme written in the common wrapped style looked hollow and lost its
  // margin. A value continues until the next terminator, wherever it starts.
  const css = [
    ':root {',
    '  --page-margin:',
    '    2cm 2.2cm;',
    '}',
  ].join('\n');

  const { declared, empty } = declarations(css);

  assert.ok(declared.has('--page-margin'));
  assert.ok(!empty.has('--page-margin'), 'a wrapped value is still a value');
});

test('a declaration at end of file with no trailing newline is read', () => {
  const { declared, empty } = declarations(':root { --page-margin: 2cm');

  assert.ok(declared.has('--page-margin'));
  assert.ok(!empty.has('--page-margin'));
});

test('the prefix restricts the answer to one family of properties', () => {
  const css = ':root { --page-margin: 2cm; --mermaid-ink: #111; }';

  assert.deepEqual([...declarations(css, '--page-').declared], ['--page-margin']);
  assert.deepEqual([...declarations(css, '--mermaid-').declared], ['--mermaid-ink']);
  assert.deepEqual([...declarations(css).declared], ['--page-margin', '--mermaid-ink']);
});

test('a later declaration of the same property wins, as the cascade does', () => {
  const { declared, empty } = declarations(':root { --page-margin: 2cm; } .alt { --page-margin: ; }');

  assert.ok(declared.has('--page-margin'));
  assert.ok(empty.has('--page-margin'), 'the hollow overriding declaration is the one that applies');
});

test('emptyNames answers for a prefix without the caller holding the map', () => {
  const css = ':root { --page-margin: 2cm; --page-background: ; --mermaid-ink: ; }';

  assert.deepEqual([...emptyNames(stripComments(css), '--page-')], ['--page-background']);
});

test('CSS with no custom properties reads as declaring nothing', () => {
  assert.deepEqual(declarations('body { color: red; }').declared.size, 0);
});
