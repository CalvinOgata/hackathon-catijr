// Shared by the test suites. Each suite runs against a real server started by run.mjs, which
// passes the data folder (DATA_DIR) and the server's log (LOG), and the phase as the first argument.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { io } from 'socket.io-client';

export { io };

export const URL = 'http://localhost:3399';
export const DATA = process.env.DATA_DIR;
export const LOG = process.env.LOG;
export const phase = process.argv[2];

let failures = 0;

export function check(label, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? '  → ' + extra : ''}`);
  if (!cond) failures++;
}

/** Prints the result and exits: call it at the end of the suite. */
export function finish() {
  console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
  process.exit(failures ? 1 : 0);
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const json = async (res) => ({ status: res.status, headers: res.headers, body: res.status === 204 ? null : await res.json() });

export const api = (method, path, body, token) =>
  fetch(`${URL}/api${path}`, {
    method,
    headers: { ...(body && { 'content-type': 'application/json' }), ...(token && { authorization: `Bearer ${token}` }) },
    body: body && JSON.stringify(body),
  }).then(json);

/** A live connection, logged in with `token` (or as a guest). */
export const connect = (token) =>
  new Promise((resolve) => {
    const socket = io(URL, { auth: token ? { token } : {}, forceNew: true });
    socket.on('connect', () => resolve(socket));
  });

/** Everything `socket` receives as `event`, as it arrives. */
export const collect = (socket, event) => {
  const list = [];
  socket.on(event, (payload) => list.push(payload));
  return list;
};

/** A tiny valid PNG header: enough for the server's type check. */
export const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);

// Kept between a suite's phases (the server restarts in between)
const STATE = () => join(DATA, '..', 'state.json');
export const saveState = (value) => writeFileSync(STATE(), JSON.stringify(value));
export const loadState = () => JSON.parse(readFileSync(STATE(), 'utf8'));
