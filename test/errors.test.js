import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CliError, InputError, RenderError, fatal } from '../src/core/errors.js';

test('CliError defaults to exit code 1', () => {
  const err = new CliError('boom');
  assert.equal(err.name, 'CliError');
  assert.equal(err.exitCode, 1);
  assert.equal(err.message, 'boom');
  assert.ok(err instanceof Error);
});

test('CliError accepts a custom exit code', () => {
  const err = new CliError('boom', 7);
  assert.equal(err.exitCode, 7);
});

test('InputError is a CliError with exit code 2', () => {
  const err = new InputError('bad input');
  assert.equal(err.name, 'InputError');
  assert.equal(err.exitCode, 2);
  assert.equal(err.message, 'bad input');
  assert.ok(err instanceof CliError);
});

test('RenderError is a CliError with exit code 3', () => {
  const err = new RenderError('bad render');
  assert.equal(err.name, 'RenderError');
  assert.equal(err.exitCode, 3);
  assert.equal(err.message, 'bad render');
  assert.ok(err instanceof CliError);
});

test('fatal() writes the message and exits with the error code', () => {
  const originalExit = process.exit;
  const originalWrite = process.stderr.write;
  let exitCode;
  let written = '';

  process.exit = (code) => {
    exitCode = code;
  };
  process.stderr.write = (chunk) => {
    written += chunk;
    return true;
  };

  try {
    fatal(new InputError('kaboom'));
  } finally {
    process.exit = originalExit;
    process.stderr.write = originalWrite;
  }

  assert.equal(exitCode, 2);
  assert.match(String(written), /kaboom/);
});
