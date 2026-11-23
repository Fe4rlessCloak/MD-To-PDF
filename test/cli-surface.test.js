import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const CONVERT = fileURLToPath(new URL('../convert.js', import.meta.url));

/**
 * Run the CLI and capture exit code plus stderr.
 * @param {string[]} args
 * @returns {Promise<{ code: number, stderr: string }>}
 */
async function runCli(args) {
  try {
    const { stderr } = await run(process.execPath, [CONVERT, ...args]);
    return { code: 0, stderr };
  } catch (err) {
    return { code: err.code, stderr: `${err.stderr ?? ''}${err.stdout ?? ''}` };
  }
}

test('an unknown flag exits with the input-error code and names the flag', async () => {
  const { code, stderr } = await runCli(['in.md', 'out.pdf', '--bogus']);
  assert.equal(code, 2);
  assert.match(stderr, /--bogus/);
});

test('--format exits with the input-error code and says it is not implemented', async () => {
  const { code, stderr } = await runCli(['in.md', 'out.pdf', '--format', 'A4']);
  assert.equal(code, 2);
  assert.match(stderr, /--format/);
  assert.match(stderr, /not yet implemented/i);
});

test('--margin exits with the input-error code and says it is not implemented', async () => {
  const { code, stderr } = await runCli(['in.md', 'out.pdf', '--margin', '2cm']);
  assert.equal(code, 2);
  assert.match(stderr, /--margin/);
  assert.match(stderr, /not yet implemented/i);
});

test('a missing title value exits with the input-error code', async () => {
  const { code, stderr } = await runCli(['in.md', 'out.pdf', '--title']);
  assert.equal(code, 2);
  assert.match(stderr, /--title/);
});

test('a missing input file exits with the input-error code', async () => {
  const { code, stderr } = await runCli(['no-such-file.md', '/tmp/never.pdf']);
  assert.equal(code, 2);
  assert.match(stderr, /no-such-file\.md/);
});
