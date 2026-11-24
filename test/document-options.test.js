import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DOCUMENT_OPTION_DEFAULTS,
  DOCUMENT_OPTION_FLAGS,
  UNIMPLEMENTED_OPTIONS,
  createDocumentOptions,
} from '../src/core/document-options.js';
import { InputError } from '../src/core/errors.js';

test('the defaults cover the complete set of document options', () => {
  assert.deepEqual(DOCUMENT_OPTION_DEFAULTS, {
    input: null,
    output: null,
    style: null,
    title: null,
  });
  assert.ok(Object.isFrozen(DOCUMENT_OPTION_DEFAULTS));
});

test('createDocumentOptions fills missing values from the defaults', () => {
  assert.deepEqual(createDocumentOptions({ input: 'in.md', output: 'out.pdf' }), {
    input: 'in.md',
    output: 'out.pdf',
    style: null,
    title: null,
  });
});

test('createDocumentOptions keeps supplied values and does not alias the defaults', () => {
  const opts = createDocumentOptions({ title: 'My Doc', style: 'theme.css' });
  assert.equal(opts.title, 'My Doc');
  assert.equal(opts.style, 'theme.css');

  opts.title = 'changed';
  assert.equal(DOCUMENT_OPTION_DEFAULTS.title, null);
});

test('createDocumentOptions rejects an option the module does not own', () => {
  assert.throws(
    () => createDocumentOptions({ pageSize: 'A4' }),
    (err) => {
      assert.ok(err instanceof InputError);
      assert.match(err.message, /pageSize/);
      return true;
    },
  );
});

test('every supported flag maps to a key in the defaults', () => {
  for (const [flag, key] of Object.entries(DOCUMENT_OPTION_FLAGS)) {
    assert.ok(
      Object.hasOwn(DOCUMENT_OPTION_DEFAULTS, key),
      `${flag} maps to "${key}", which is not a document option`,
    );
  }
});

test('the unimplemented options carry a human-readable description', () => {
  assert.deepEqual(Object.keys(UNIMPLEMENTED_OPTIONS), ['--format', '--margin']);
  for (const description of Object.values(UNIMPLEMENTED_OPTIONS)) {
    assert.equal(typeof description, 'string');
    assert.ok(description.length > 0);
  }
});
