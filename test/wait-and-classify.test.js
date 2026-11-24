/**
 * @file Tests for the readiness protocol's waiting and classification steps,
 * driven through a scripted fake page evaluator so that timeout behaviour and
 * the fatal-versus-warning distinction are asserted without a browser.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  READINESS_FLAGS,
  READINESS_POLL_INTERVAL_MS,
  READINESS_TIMEOUT_MS,
  FATAL_REPORT_INDEX,
  waitForReadiness,
  classifyErrorReports,
  describeReport,
  checkErrorReports,
} from '../src/core/readiness-protocol.js';

/**
 * A fake page evaluator that answers a fixed sequence of readiness values and
 * records the flag names it was asked about.
 *
 * The last answer repeats forever, so `[false, false, true]` means "set on the
 * third poll" and `[false]` means "never set".
 *
 * @param {...boolean} answers
 * @returns {((flag: string) => Promise<boolean>) & { calls: string[] }}
 */
function evaluatorOf(...answers) {
  const calls = [];
  const evaluate = async (flag) => {
    calls.push(flag);
    return answers[Math.min(calls.length - 1, answers.length - 1)];
  };
  evaluate.calls = calls;
  return evaluate;
}

/** Collects sink output from the classification adapter. */
function sinkOf() {
  const lines = [];
  const sink = (line) => lines.push(line);
  sink.lines = lines;
  return sink;
}

test('owned poll interval and timeout are named constants in milliseconds', () => {
  assert.equal(READINESS_POLL_INTERVAL_MS, 100);
  assert.equal(READINESS_TIMEOUT_MS, 30_000);
});

test('waiting returns at once when the flag is already set', async () => {
  const evaluate = evaluatorOf(true);

  await waitForReadiness(evaluate, READINESS_FLAGS.mermaidRenderDone, { label: 'Mermaid' });

  assert.deepEqual(evaluate.calls, [READINESS_FLAGS.mermaidRenderDone]);
});

test('waiting keeps polling until a flag set late becomes true', async () => {
  const evaluate = evaluatorOf(false, false, true);

  await waitForReadiness(evaluate, READINESS_FLAGS.mathRenderDone, {
    label: 'KaTeX',
    pollIntervalMs: 1,
    timeoutMs: 1_000,
  });

  assert.equal(evaluate.calls.length, 3);
  assert.ok(evaluate.calls.every((flag) => flag === READINESS_FLAGS.mathRenderDone));
});

test('a flag that is never set times out with a message naming the label', async () => {
  const evaluate = evaluatorOf(false);

  await assert.rejects(
    () => waitForReadiness(evaluate, READINESS_FLAGS.mermaidRenderDone, {
      label: 'Mermaid',
      pollIntervalMs: 2,
      timeoutMs: 20,
    }),
    (err) => {
      assert.equal(err.name, 'RenderError');
      assert.match(err.message, /^Mermaid did not finish rendering within/);
      return true;
    },
  );

  assert.ok(evaluate.calls.length > 1, 'the timeout must be reached by polling');
});

test('the fatal sentinel is a named constant, not a bare index at the call site', () => {
  assert.equal(FATAL_REPORT_INDEX, -1);
});

test('a report carrying the fatal sentinel classifies as fatal, not a warning', () => {
  const reports = [
    { index: 0, error: 'bad diagram' },
    { index: FATAL_REPORT_INDEX, error: 'CDN unreachable' },
  ];

  const { fatal, warnings } = classifyErrorReports(reports);

  assert.equal(fatal.error, 'CDN unreachable');
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].index, 0);
});

test('reports without a fatal entry classify as warnings only', () => {
  const reports = [
    { index: 0, error: 'bad diagram' },
    { index: 3, error: 'also bad' },
  ];

  const { fatal, warnings } = classifyErrorReports(reports);

  assert.equal(fatal, null);
  assert.deepEqual(warnings.map((entry) => entry.index), [0, 3]);
});

test('an empty or missing report set classifies cleanly', () => {
  for (const input of [[], undefined, null]) {
    const { fatal, warnings } = classifyErrorReports(input);
    assert.equal(fatal, null);
    assert.deepEqual(warnings, []);
  }
});

test('a report line names its kind when it has one and the caller’s noun otherwise', () => {
  assert.equal(describeReport({ index: 2, error: 'boom' }, 'diagram'), 'diagram 2: boom');
  assert.equal(describeReport({ index: 2, kind: 'display', error: 'boom' }), 'display 2: boom');
});

test('the fallback noun is a parameter, because two bootstraps share this module', () => {
  // Baked-in 'diagram' put Mermaid's word in KaTeX's warnings. Each consumer
  // now names its own noun, and the shared module has no opinion.
  assert.equal(describeReport({ index: 1, error: 'boom' }, 'expression'), 'expression 1: boom');
  assert.equal(describeReport({ index: 1, error: 'boom' }), 'report 1: boom');
  assert.equal(describeReport({ index: 1, kind: 'bootstrap', error: 'x' }), 'bootstrap 1: x');
});

test('a fatal report raises a RenderError naming the runtime', () => {
  assert.throws(
    () => checkErrorReports([{ index: FATAL_REPORT_INDEX, error: 'CDN unreachable' }], {
      runtime: 'Mermaid',
      noun: 'Mermaid diagram',
      sink: sinkOf(),
    }),
    /^RenderError: Failed to load Mermaid runtime: CDN unreachable$/,
  );
});

test('warnings are reported through the injected sink and do not throw', () => {
  const sink = sinkOf();

  checkErrorReports(
    [{ index: 1, error: 'bad diagram' }, { index: 4, kind: 'inline', error: 'bad math' }],
    { runtime: 'KaTeX', noun: 'math expression', reportKind: 'expression', sink },
  );

  assert.deepEqual(sink.lines, [
    'Warning: 2 math expression(s) failed to render:',
    '  - expression 1: bad diagram',
    '  - inline 4: bad math',
  ]);
});

test('checkErrorReports applies a caller-supplied prefix when provided', () => {
  const sink = sinkOf();

  checkErrorReports(
    [{ index: 0, error: 'syntax error' }],
    { runtime: 'Mermaid', noun: 'Mermaid diagram', reportKind: 'diagram', prefix: '[renderPdf()] Warning', sink },
  );

  assert.deepEqual(sink.lines, [
    '[renderPdf()] Warning: 1 Mermaid diagram(s) failed to render:',
    '  - diagram 0: syntax error',
  ]);
});

test('checking a clean report set writes nothing', () => {
  const sink = sinkOf();

  checkErrorReports([], { runtime: 'Mermaid', noun: 'Mermaid diagram', sink });

  assert.deepEqual(sink.lines, []);
});

test('checking reports returns nothing, because its caller used neither half', () => {
  // The return was destructured by nobody. Throwing or writing the lines is the
  // entire outcome, and a caller that wants the classification asks
  // classifyErrorReports directly.
  assert.equal(checkErrorReports([], { runtime: 'Mermaid', noun: 'Mermaid', sink: sinkOf() }), undefined);
  assert.equal(
    checkErrorReports([{ index: 0, error: 'x' }], { runtime: 'Mermaid', noun: 'Mermaid', sink: sinkOf() }),
    undefined,
  );
});

test('the renderer owns neither a polling loop nor a fatal-index comparison', async () => {
  const source = await readFile(new URL('../src/core/render-pdf.js', import.meta.url), 'utf8');

  assert.ok(!source.includes('setInterval'), 'polling belongs to the protocol module');
  assert.ok(!/index\s*===\s*-1/.test(source), 'the fatal sentinel belongs to the protocol module');
  assert.ok(!source.includes('30 seconds'), 'the timeout message belongs to the protocol module');
});
