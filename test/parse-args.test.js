import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from '../src/cli/parse-args.js';
import { InputError } from '../src/core/errors.js';

test('throws InputError when fewer than two arguments are given', () => {
  assert.throws(() => parseArgs([]), InputError);
});

test('throws InputError with a usage message for a single argument', () => {
  assert.throws(
    () => parseArgs(['in.md']),
    (err) => {
      assert.ok(err instanceof InputError);
      assert.match(err.message, /Usage:/);
      return true;
    },
  );
});

test('parses input and output with no style', () => {
  assert.deepEqual(parseArgs(['in.md', 'out.pdf']), {
    input: 'in.md',
    output: 'out.pdf',
    style: null,
  });
});

test('parses an explicit --style path', () => {
  assert.deepEqual(parseArgs(['in.md', 'out.pdf', '--style', 'theme.css']), {
    input: 'in.md',
    output: 'out.pdf',
    style: 'theme.css',
  });
});

test('throws InputError when --style has no value', () => {
  assert.throws(() => parseArgs(['in.md', 'out.pdf', '--style']), InputError);
});

test('ignores unknown flags', () => {
  assert.deepEqual(parseArgs(['in.md', 'out.pdf', '--verbose', '--unknown']), {
    input: 'in.md',
    output: 'out.pdf',
    style: null,
  });
});

test('ignores extra trailing positional arguments', () => {
  assert.deepEqual(parseArgs(['in.md', 'out.pdf', 'extra', 'more']), {
    input: 'in.md',
    output: 'out.pdf',
    style: null,
  });
});
