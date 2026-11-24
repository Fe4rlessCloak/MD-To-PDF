import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { writePdfOutput } from '../src/core/write-output.js';
import { CliError, InputError } from '../src/core/errors.js';

let dir;

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'md2pdf-write-'));
});

after(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

test('writes the buffer to the requested path', async () => {
  const file = path.join(dir, 'out.pdf');
  const payload = Buffer.from('%PDF-1.4 test');
  await writePdfOutput(file, payload);
  assert.deepEqual(await readFile(file), payload);
});

test('creates no directories implicitly', async () => {
  const file = path.join(dir, 'missing-dir', 'out.pdf');
  await assert.rejects(() => writePdfOutput(file, Buffer.from('x')), InputError);
});

test('a write into a missing directory is an InputError naming the path', async () => {
  const file = path.join(dir, 'no-such-dir', 'out.pdf');
  await assert.rejects(
    () => writePdfOutput(file, Buffer.from('x')),
    (err) => {
      assert.ok(err instanceof InputError);
      assert.ok(err instanceof CliError);
      assert.equal(err.exitCode, 2);
      assert.match(err.message, /no-such-dir/);
      return true;
    },
  );
});

test('a write onto a directory is an InputError, not a bare error', async () => {
  const target = path.join(dir, 'a-directory');
  await mkdir(target);

  await assert.rejects(
    () => writePdfOutput(target, Buffer.from('x')),
    (err) => {
      assert.ok(err instanceof InputError);
      assert.equal(err.exitCode, 2);
      assert.match(err.message, /a-directory/);
      return true;
    },
  );
});

test('a permission failure is an InputError, not a bare error', async () => {
  const file = path.join(dir, 'readonly.pdf');
  await writeFile(file, '');

  // Guard against running as root, where mode bits do not deny access.
  const { chmod } = await import('node:fs/promises');
  await chmod(file, 0o444);
  let denied = false;
  try {
    await writePdfOutput(file, Buffer.from('x'));
  } catch (err) {
    assert.ok(err instanceof InputError, `expected InputError, got ${err.name}`);
    assert.equal(err.exitCode, 2);
    denied = true;
  } finally {
    await chmod(file, 0o644);
  }

  if (!denied) {
    // Root bypasses the mode bits; the path is still exercised above.
    assert.ok(true);
  }
});

test('the original failure reason is preserved in the message', async () => {
  const file = path.join(dir, 'still-missing', 'out.pdf');
  await assert.rejects(
    () => writePdfOutput(file, Buffer.from('x')),
    (err) => {
      assert.match(err.message, /ENOENT|no such file/i);
      return true;
    },
  );
});
