// Runs the test suites against a real server (`npm test`, or `node tests/run.mjs [suite...]`).
// Each suite gets a fresh data folder and its own settings; suites about restarts stop and start
// the server between their phases. The server must be built first (`npm run build -w server`).
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, openSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TESTS = dirname(fileURLToPath(import.meta.url));
const SERVER = join(TESTS, '..', 'server', 'dist', 'index.js');
const NOW = { LISTING_MIN_LEAD_MINUTES: '0' }; // auctions can start right away

// Steps: a phase name passed to the suite, or 'stop' / 'start' / 'restart' for the server
const SUITES = {
  access: { env: { ...NOW, SESSION_IDLE_MINUTES: '0.1', SESSION_MAX_DAYS: '0.00015' }, steps: [''] },
  account: { env: { LOGIN_LOCK_MINUTES: '0.1' }, steps: [''] },
  'create-auction': { env: {}, steps: ['create', 'restart', 'after-restart'] },
  cancel: { env: NOW, steps: ['main', 'stop', 'age', 'start', 'after-restart'] },
  'delete-account': { env: { ...NOW, LOGIN_LOCK_MINUTES: '0.1' }, steps: ['main', 'stop', 'age', 'start', 'after-end', 'restart', 'after-restart'] },
  bids: { env: NOW, steps: ['main', 'stop', 'age', 'start', 'after'] },
  'bids-failures': { env: NOW, steps: ['main', 'restart', 'after'] },
  spectators: { env: NOW, steps: [''] },
  lifecycle: {
    env: { ...NOW, LISTING_MIN_DURATION_MINUTES: '1', BID_EXTENSION_WINDOW_MINUTES: '1', BID_EXTENSION_MAX_MINUTES: '0.05' },
    steps: ['main', 'stop', 'down', 'start', 'after'],
  },
  'sample-photos': { env: {}, steps: ['stop', 'break', 'start', 'after'] },
  'session-sweep': { env: { ...NOW, SESSION_IDLE_MINUTES: '0.1' }, steps: [''] },
};

async function runSuite(name, { env, steps }) {
  // Run from an empty folder, so the server doesn't read server/.env or serve the web app
  const dir = mkdtempSync(join(tmpdir(), `arremate-${name}-`));
  const data = join(dir, 'data');
  const log = join(dir, 'server.log');
  mkdirSync(data);
  let server = null;

  const start = async () => {
    const out = openSync(log, 'a');
    server = spawn(process.execPath, [SERVER], { cwd: dir, env: { ...process.env, ...env, PORT: '3399', DATA_DIR: data }, stdio: ['ignore', out, out] });
    for (let i = 0; i < 100; i++) {
      if (await fetch('http://localhost:3399/api/health').then((r) => r.ok, () => false)) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`${name}: the server didn't start (see ${log})`);
  };
  const stop = async () => {
    if (!server) return;
    const exited = new Promise((r) => server.once('exit', r));
    server.kill('SIGTERM');
    await exited;
    server = null;
  };

  let failed = 0;
  try {
    await start();
    for (const step of steps) {
      if (step === 'stop') await stop();
      else if (step === 'start') await start();
      else if (step === 'restart') await stop().then(start);
      else {
        const result = spawnSync(process.execPath, [join(TESTS, `${name}.test.mjs`), ...(step ? [step] : [])], {
          env: { ...process.env, DATA_DIR: data, LOG: log },
          encoding: 'utf8',
        });
        const output = result.stdout + result.stderr;
        const failures = output.split('\n').filter((line) => line.startsWith('FAIL'));
        for (const line of failures) console.log(`  ${line}`);
        if (result.status !== 0 && !failures.length) console.log(output.trim().split('\n').slice(-10).join('\n'));
        failed += result.status === 0 ? 0 : Math.max(1, failures.length);
      }
    }
  } finally {
    await stop();
  }
  console.log(`${failed ? '✗' : '✓'} ${name}${failed ? `: ${failed} failed (data and log in ${dir})` : ''}`);
  if (!failed) rmSync(dir, { recursive: true, force: true });
  return failed;
}

const names = process.argv.slice(2);
const unknown = names.filter((name) => !(name in SUITES));
if (unknown.length) {
  console.error(`Unknown suite: ${unknown.join(', ')}. Suites: ${Object.keys(SUITES).join(', ')}`);
  process.exit(1);
}

let failed = 0;
for (const name of names.length ? names : Object.keys(SUITES)) failed += await runSuite(name, SUITES[name]);
console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
