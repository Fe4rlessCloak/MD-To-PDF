import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from '../src/cli/parse-args.js';
import { InputError } from '../src/core/errors.js';
import { createDocumentOptions } from '../src/core/document-options.js';

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

test('parses input and output with no style or title', () => {
  assert.deepEqual(parseArgs(['in.md', 'out.pdf']), {
    input: 'in.md',
    output: 'out.pdf',
    style: null,
    title: null,
  });
});

test('parses an explicit --style path', () => {
  assert.deepEqual(parseArgs(['in.md', 'out.pdf', '--style', 'theme.css']), {
    input: 'in.md',
    output: 'out.pdf',
    style: 'theme.css',
    title: null,
  });
});

test('throws InputError when --style has no value', () => {
  assert.throws(() => parseArgs(['in.md', 'out.pdf', '--style']), InputError);
});

test('parses an explicit --title', () => {
  assert.deepEqual(parseArgs(['in.md', 'out.pdf', '--title', 'My Title']), {
    input: 'in.md',
    output: 'out.pdf',
    style: null,
    title: 'My Title',
  });
});

test('parses --title=value syntax and a title containing spaces', () => {
  assert.equal(
    parseArgs(['in.md', 'out.pdf', '--title=Quarterly Report']).title,
    'Quarterly Report',
  );
});

test('throws InputError when --title has no value', () => {
  assert.throws(
    () => parseArgs(['in.md', 'out.pdf', '--title']),
    (err) => {
      assert.ok(err instanceof InputError);
      assert.match(err.message, /--title/);
      return true;
    },
  );
});

test('parses --title and --style together in either order', () => {
  const expected = {
    input: 'in.md',
    output: 'out.pdf',
    style: 'theme.css',
    title: 'My Title',
  };
  assert.deepEqual(
    parseArgs(['in.md', 'out.pdf', '--title', 'My Title', '--style', 'theme.css']),
    expected,
  );
  assert.deepEqual(
    parseArgs(['--style', 'theme.css', 'in.md', '--title', 'My Title', 'out.pdf']),
    expected,
  );
});

test('rejects an unknown flag with an error naming it', () => {
  assert.throws(
    () => parseArgs(['in.md', 'out.pdf', '--verbose']),
    (err) => {
      assert.ok(err instanceof InputError);
      assert.match(err.message, /--verbose/);
      assert.match(err.message, /unknown|unrecognis|unrecogniz/i);
      return true;
    },
  );
});

test('rejects a typo of a supported flag rather than ignoring it', () => {
  assert.throws(
    () => parseArgs(['in.md', 'out.pdf', '--titel', 'My Title']),
    (err) => {
      assert.ok(err instanceof InputError);
      assert.match(err.message, /--titel/);
      return true;
    },
  );
});

test('rejects --format as not yet implemented', () => {
  assert.throws(
    () => parseArgs(['in.md', 'out.pdf', '--format', 'A4']),
    (err) => {
      assert.ok(err instanceof InputError);
      assert.match(err.message, /--format/);
      assert.match(err.message, /not yet implemented/i);
      return true;
    },
  );
});

test('rejects --format=value as not yet implemented', () => {
  assert.throws(
    () => parseArgs(['in.md', 'out.pdf', '--format=letter']),
    (err) => {
      assert.ok(err instanceof InputError);
      assert.match(err.message, /--format/);
      assert.match(err.message, /not yet implemented/i);
      return true;
    },
  );
});

test('rejects --margin as not yet implemented', () => {
  assert.throws(
    () => parseArgs(['in.md', 'out.pdf', '--margin', '2cm']),
    (err) => {
      assert.ok(err instanceof InputError);
      assert.match(err.message, /--margin/);
      assert.match(err.message, /not yet implemented/i);
      return true;
    },
  );
});

test('rejects --margin=value as not yet implemented', () => {
  assert.throws(
    () => parseArgs(['in.md', 'out.pdf', '--margin=2cm']),
    (err) => {
      assert.ok(err instanceof InputError);
      assert.match(err.message, /--margin/);
      assert.match(err.message, /not yet implemented/i);
      return true;
    },
  );
});

test('returns an object shaped by the document options module', () => {
  assert.deepEqual(
    parseArgs(['in.md', 'out.pdf', '--title', 'T']),
    createDocumentOptions({ input: 'in.md', output: 'out.pdf', title: 'T' }),
  );
});

test('treats a bare --term separator as the end of options', () => {
  assert.deepEqual(parseArgs(['--', 'in.md', 'out.pdf']), {
    input: 'in.md',
    output: 'out.pdf',
    style: null,
    title: null,
  });
});

test('throws InputError when input or output path is empty', () => {
  assert.throws(() => parseArgs(['', 'out.pdf']), InputError);
  assert.throws(() => parseArgs(['in.md', '']), InputError);
});

test('ignores extra trailing positional arguments', () => {
  assert.deepEqual(parseArgs(['in.md', 'out.pdf', 'extra', 'more']), {
    input: 'in.md',
    output: 'out.pdf',
    style: null,
    title: null,
  });
});

test('parses --style before positional args and --style=path syntax', () => {
  assert.deepEqual(parseArgs(['--style', 'theme.css', 'in.md', 'out.pdf']), {
    input: 'in.md',
    output: 'out.pdf',
    style: 'theme.css',
    title: null,
  });
  assert.deepEqual(parseArgs(['in.md', 'out.pdf', '--style=theme.css']), {
    input: 'in.md',
    output: 'out.pdf',
    style: 'theme.css',
    title: null,
  });
});

test('throws InputError when --style value is empty or another flag', () => {
  assert.throws(() => parseArgs(['in.md', 'out.pdf', '--style=']), InputError);
  assert.throws(() => parseArgs(['in.md', 'out.pdf', '--style', '--verbose']), InputError);
});
