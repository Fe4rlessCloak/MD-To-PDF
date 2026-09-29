import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readMarkdown, readStylesheet } from '../src/core/load-input.js';
import { InputError } from '../src/core/errors.js';

let dir;

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'md2pdf-'));
});

after(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

test('readMarkdown returns file contents', async () => {
  const file = path.join(dir, 'doc.md');
  await writeFile(file, '# Title\n\nbody\n', 'utf-8');
  assert.equal(await readMarkdown(file), '# Title\n\nbody\n');
});

test('readMarkdown rejects with InputError for a missing file', async () => {
  const missing = path.join(dir, 'nope.md');
  await assert.rejects(
    () => readMarkdown(missing),
    (err) => {
      assert.ok(err instanceof InputError);
      assert.match(err.message, /nope\.md/);
      return true;
    },
  );
});

test('readStylesheet returns null when no path is given', async () => {
  assert.equal(await readStylesheet(null), null);
  assert.equal(await readStylesheet(undefined), null);
});

test('readStylesheet returns file contents', async () => {
  const file = path.join(dir, 'theme.css');
  await writeFile(file, 'body { color: red; }\n', 'utf-8');
  assert.equal(await readStylesheet(file), 'body { color: red; }\n');
});

test('readStylesheet rejects with InputError for a missing file', async () => {
  const missing = path.join(dir, 'nope.css');
  await assert.rejects(() => readStylesheet(missing), InputError);
});
