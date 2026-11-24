/**
 * @file Structural guard for the CI workflow.
 *
 * The workflow is the only thing that runs this suite without a human
 * remembering to, so it is the one file whose silence is treated as success.
 * A short YAML file gets no type-checking and no second reader: a dropped
 * trigger, a swapped `npm install`, or a reinstated Chromium download all look
 * exactly like a healthy workflow in review, and the first sign of trouble is a
 * green check on a broken pull request.
 *
 * So the contract is asserted from inside the suite the workflow runs. If the
 * workflow stops covering a push, stops pinning a supported Node, stops
 * installing from the lockfile, stops running `npm test`, or starts needing a
 * browser, `npm test` fails locally and therefore fails in CI — the guard
 * cannot rot without the rot being visible.
 *
 * Everything here is read as text. There is no YAML dependency in this project
 * and this file does not add one: the checks are on trigger keys, step
 * commands and the absence of a browser install, which are lines in a file
 * rather than a data structure.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const repoRoot = new URL('../', import.meta.url);
const workflowUrl = new URL('.github/workflows/ci.yml', repoRoot);

/**
 * Read the workflow, with whole-line YAML comments removed.
 *
 * Comments are prose, and this workflow explains why it downloads no browser.
 * A check that could not tell a comment from a step would punish the
 * explanation, so whole-line comments are dropped. Trailing comments are left
 * alone rather than risk mangling a quoted `#`.
 *
 * @returns {Promise<string>} The workflow source, comments removed.
 */
async function readWorkflow() {
  let text;
  try {
    text = await readFile(workflowUrl, 'utf8');
  } catch (error) {
    assert.fail(
      `the CI contract is missing: .github/workflows/ci.yml could not be read (${error.code})`,
    );
  }

  return text
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');
}

/**
 * The keys under the workflow's top-level `on:` trigger.
 *
 * Both spellings GitHub accepts are honoured: the inline list
 * (`on: [push, pull_request]`) and the block form where each trigger is a key
 * on its own line. Anything else under `on:` — `workflow_dispatch`, a
 * `branches` filter — is a key too, and harmless to report.
 *
 * @param {string} workflow  Source with comments removed.
 * @returns {string[]} Trigger names, in file order.
 */
function triggerKeys(workflow) {
  const lines = workflow.split('\n');
  const start = lines.findIndex((line) => /^on:\s*(.*)$/.test(line));
  if (start === -1) return [];

  // `on:` alone means the triggers are a block below it; nothing follows the
  // colon. Only the inline forms carry a value on this line.
  const inline = /^on:\s*(.*)$/.exec(lines[start])[1].trim();
  if (inline) {
    return inline
      .replace(/^\[|\]$/g, '')
      .split(',')
      .map((key) => key.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean);
  }

  const keys = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break; // the next top-level key: `on:` has ended
    const key = /^\s+([A-Za-z_][\w-]*):/.exec(line);
    if (key) keys.push(key[1]);
  }
  return keys;
}

/**
 * The Node major version the workflow pins, or null when it pins no number.
 *
 * A floating value such as `lts/*` or `node` cannot be compared against the
 * package's `engines` floor, so it reads as "no version declared" rather than
 * as any particular version.
 *
 * @param {string} workflow  Source with comments removed.
 * @returns {number|null}
 */
function nodeMajor(workflow) {
  const declared = /^\s*node-version:\s*(.+)$/m.exec(workflow);
  if (!declared) return null;

  const value = declared[1].trim().replace(/^['"]|['"]$/g, '');
  return /^\d+(?:\.\d+)*$/.test(value) ? Number.parseInt(value, 10) : null;
}

// ---------------------------------------------------------------------------
// The triggers — a suite nobody runs catches nothing
// ---------------------------------------------------------------------------

test('the workflow runs on every push and pull request', async () => {
  const triggers = triggerKeys(await readWorkflow());

  assert.ok(
    triggers.includes('push'),
    `CI must run on push, or a direct commit merges untested (found: ${triggers.join(', ') || 'nothing'})`,
  );
  assert.ok(
    triggers.includes('pull_request'),
    `CI must run on pull_request, or a branch is reviewed without its suite (found: ${triggers.join(', ') || 'nothing'})`,
  );
});

// ---------------------------------------------------------------------------
// The runtime — supported Node, on a runner GitHub owns
// ---------------------------------------------------------------------------

test('the workflow runs on a runner GitHub hosts, not a machine someone maintains', async () => {
  const workflow = await readWorkflow();

  assert.match(workflow, /^\s*runs-on:/m, 'the job must name a runner at all');

  // A self-hosted label is how host-specific library workarounds get back in:
  // the job would inherit whatever Chromium a given machine happens to carry,
  // and the workflow would stop being reproducible from the lockfile alone.
  assert.ok(
    !/self-hosted/.test(workflow),
    'CI must not run on a self-hosted runner; a hosted image is what makes the job reproducible',
  );
});

test('the workflow pins a Node version that satisfies the engines floor', async () => {
  const workflow = await readWorkflow();
  const major = nodeMajor(workflow);

  assert.ok(
    major !== null,
    'the workflow must pin a numeric Node version, so the engines floor can be checked against it',
  );
  assert.ok(
    major >= 18,
    `CI runs Node ${major}, below the engines floor of >=18; raise node-version in the workflow`,
  );

  const pkg = JSON.parse(await readFile(new URL('package.json', repoRoot), 'utf8'));
  const floor = /(\d+)/.exec(pkg.engines?.node ?? '');
  assert.ok(floor, 'package.json must declare an engines.node floor for this check to mean anything');

  assert.ok(
    major >= Number.parseInt(floor[1], 10),
    `CI runs Node ${major} but package.json promises ${pkg.engines.node}; CI must exercise a supported runtime`,
  );
});

// ---------------------------------------------------------------------------
// The install and the run — reproducible, in that order
// ---------------------------------------------------------------------------

test('dependencies are installed from the lockfile before the suite runs', async () => {
  const workflow = await readWorkflow();

  // Only `run:` lines matter: a step name or a comment that happens to contain
  // "npm install" is prose, while a command is what actually executes.
  const commands = [...workflow.matchAll(/^\s*run:\s*(.+)$/gm)].map((match) => match[1].trim());
  assert.ok(commands.length > 0, 'the workflow must actually run something');

  const install = commands.find((command) => /^npm ci\b/.test(command));
  assert.ok(
    install,
    'CI must install with `npm ci`, so a run matches the lockfile instead of drifting',
  );

  const drifted = commands.filter((command) =>
    /^(?:npm install|npm i|yarn(?:\s|$)|pnpm install)\b/.test(command),
  );
  assert.deepEqual(
    drifted,
    [],
    `CI must not fall back to a drifting install, but these commands do: ${drifted.join(', ')}`,
  );

  const testAt = commands.findIndex((command) => /^npm test\b/.test(command));
  assert.ok(testAt !== -1, 'the workflow must run `npm test`; that is the suite this guard lives in');
  assert.ok(
    commands.indexOf(install) < testAt,
    'CI must install dependencies before running the suite',
  );
});

test('the workflow runs the suite with npm test', async () => {
  const workflow = await readWorkflow();

  // The suite is `node --test` behind a script; naming the script in CI keeps
  // a change to how tests are invoked in one place, package.json. Trailing
  // arguments are allowed — a reporter flag is harmless — but a watch mode is
  // not: it never exits, so a CI job running it would hang until the timeout.
  const run = /^\s*run:\s*npm test\b(.*)$/m.exec(workflow);
  assert.ok(
    run,
    'CI must invoke the suite through `npm test`; that is the script this guard lives in',
  );
  assert.ok(
    !/(?:^|\s)--watch\b/.test(run[1]),
    'CI must not run the suite in watch mode, which never exits',
  );
  assert.ok(
    !workflow.includes('continue-on-error'),
    'a failing test must fail the job; continue-on-error would report red as green',
  );
});

// ---------------------------------------------------------------------------
// The absence of a browser — the reason CI takes seconds
// ---------------------------------------------------------------------------

test('CI installs no browser and needs no shared-library workaround', async () => {
  const workflow = await readWorkflow();

  const browserWork = [
    [/puppeteer\s+browsers\s+install/i, 'a `puppeteer browsers install` step'],
    [/setup-chrome/i, 'an `actions/setup-chrome` step'],
    [/playwright\s+install/i, 'a `playwright install` step'],
    [/apt-get\s+install[^\n]*chromi/i, 'an apt-get install of Chromium'],
    [/apt-get\s+install[^\n]*firefox/i, 'an apt-get install of Firefox'],
    [/LD_LIBRARY_PATH/, 'an `LD_LIBRARY_PATH` workaround'],
    [/PUPPETEER_EXECUTABLE_PATH/, 'a `PUPPETEER_EXECUTABLE_PATH` pointing at a host browser'],
  ];

  const found = browserWork.filter(([pattern]) => pattern.test(workflow)).map(([, what]) => what);
  assert.deepEqual(found, [], `CI must stay browser-free, but the workflow adds ${found.join(', ')}`);
});

test('the install skips the puppeteer browser download, which would fetch Chromium', async () => {
  const workflow = await readWorkflow();

  // puppeteer is a runtime dependency here, not a devDependency, so `npm ci`
  // runs its postinstall and pulls a browser unless told not to. This variable
  // is the whole reason the install step stays browser-free.
  assert.match(
    workflow,
    /^\s*PUPPETEER_SKIP_DOWNLOAD:\s*['"]?true['"]?\s*$/m,
    'CI must set PUPPETEER_SKIP_DOWNLOAD: true, or npm ci downloads Chromium',
  );
  assert.ok(
    !/PUPPETEER_SKIP_DOWNLOAD:\s*['"]?(?:false|0)/i.test(workflow),
    'PUPPETEER_SKIP_DOWNLOAD must not be turned back off',
  );
});

test('the suite this workflow runs launches no browser', async () => {
  // The workflow is browser-free because the tests are. If a test ever starts
  // Puppeteer, this guard names it, so the workflow cannot quietly become a
  // lie about what `npm test` needs.
  const testFiles = (await readdir(new URL('test/', repoRoot))).filter((name) => name.endsWith('.test.js'));

  assert.ok(testFiles.length > 0, 'expected the test suite to contain test files');

  const launching = [];
  for (const name of testFiles) {
    const source = await readFile(new URL(`test/${name}`, repoRoot), 'utf8');

    // Only code counts. A comment may name the browser in order to explain why
    // it is not used — this file does exactly that — and forbidding the
    // explanation would be a guard against documentation rather than a guard
    // against a browser launch.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .map((line) => line.replace(/(^|\s)\/\/.*$/, ''))
      .join('\n');

    // This guard names the dependency in order to forbid it, so it is not its
    // own subject: a mention here is the rule, not a violation of it.
    if (name === 'ci-workflow.test.js') continue;

    if (/\bpuppeteer\b|\.launch\s*\(/.test(code)) launching.push(name);
  }

  assert.deepEqual(
    launching,
    [],
    `these tests need a browser, so CI could not run them: ${launching.join(', ')}`,
  );
});
