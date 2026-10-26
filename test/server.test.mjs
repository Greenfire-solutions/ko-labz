// Starts a real server on the test port with a throwaway data folder.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8352;
const BASE = `http://127.0.0.1:${PORT}`;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'kolabz-test-'));
let proc;

async function waitUp() {
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(`${BASE}/api/whoami`); const j = await r.json(); if (j.app === 'ko-labz' && j.data === DATA) return; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('test server did not start (or port 8352 belongs to something else)');
}
const post = (p, body) => fetch(BASE + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

before(async () => {
  proc = spawn(process.execPath, ['server.mjs'], { cwd: ROOT, env: { ...process.env, KOLABZ_PORT: String(PORT), KOLABZ_DATA: DATA }, stdio: 'pipe' });
  await waitUp();
});
after(() => { proc?.kill(); fs.rmSync(DATA, { recursive: true, force: true }); });

test('whoami identifies the app and its data folder', async () => {
  const j = await (await fetch(`${BASE}/api/whoami`)).json();
  assert.equal(j.app, 'ko-labz');
  assert.equal(j.data, DATA);
});

test('page, app code, three.js, addons and fonts are served', async () => {
  const html = await (await fetch(BASE + '/')).text();
  assert.match(html, /Ko-Labz Persistence Hub/);
  assert.doesNotMatch(html, /__BUILD__/);
  for (const p of ['/app.js', '/scene.js', '/audio.js', '/style.css', '/shared/rules.mjs', '/vendor/three/build/three.module.js',
    '/vendor/three/examples/jsm/postprocessing/UnrealBloomPass.js', '/fonts/orbitron/orbitron-latin-400-normal.woff2']) {
    const r = await fetch(BASE + p);
    assert.equal(r.status, 200, p);
  }
});

test('path traversal is refused', async () => {
  const r = await fetch(BASE + '/vendor/three/..%2f..%2fpackage.json');
  assert.notEqual(r.status, 200);
  const r2 = await fetch(BASE + '/shared/..%2fserver.mjs');
  assert.notEqual(r2.status, 200);
});

test('actions persist to disk and survive a restart', async () => {
  let r = await post('/api/action', { type: 'crew.setup', players: [{ name: 'Ava' }, { name: 'Bo' }] });
  assert.equal(r.status, 200);
  let j = await r.json();
  r = await post('/api/action', { type: 'project.create', ownerId: j.hub.players[0].id, title: 'Test', minor: [{ title: 'A' }] });
  assert.equal(r.status, 200);
  await new Promise(r => setTimeout(r, 100));
  const saved = JSON.parse(fs.readFileSync(path.join(DATA, 'hub.json'), 'utf8'));
  assert.equal(saved.projects[0].title, 'TEST');
  proc.kill(); await new Promise(r => proc.once('exit', r));
  proc = spawn(process.execPath, ['server.mjs'], { cwd: ROOT, env: { ...process.env, KOLABZ_PORT: String(PORT), KOLABZ_DATA: DATA }, stdio: 'pipe' });
  await waitUp();
  j = await (await fetch(`${BASE}/api/state`)).json();
  assert.equal(j.hub.players.length, 2);
  assert.equal(j.hub.projects[0].title, 'TEST');
  assert.ok(j.templates.length >= 3);
});

test('rule errors come back as 400 with a readable message', async () => {
  const r = await post('/api/action', { type: 'assist.offer', projectId: 'nope', needId: 'x', method: 'self' });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /no longer exists/);
});

test('reset requires the typed confirmation', async () => {
  const r = await post('/api/action', { type: 'hub.reset' });
  assert.equal(r.status, 400);
});

test('events stream sends the hub on connect', async () => {
  const ctrl = new AbortController();
  const r = await fetch(`${BASE}/api/events`, { signal: ctrl.signal });
  const reader = r.body.getReader();
  const { value } = await reader.read();
  ctrl.abort();
  assert.match(new TextDecoder().decode(value), /event: hub/);
});

test('import accepts the original single-file save and backs up first', async () => {
  const r = await post('/api/import', {
    turnInfo: { currentPlayerIndex: 0, turnNumber: 1 },
    players: [{ id: 1, name: 'ALICE', color: '#ff4444', score: 0 }],
    activeProject: { title: 'LUNAR', ownerId: 1 },
    needs: [{ id: 'm1', ring: 'minor', title: 'Power', status: 'active' }]
  });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.hub.projects[0].title, 'LUNAR');
  assert.ok(fs.readdirSync(path.join(DATA, 'backups')).some(f => f.startsWith('hub-before-import')));
});

test('a second server on the same port exits with code 3', async () => {
  const p2 = spawn(process.execPath, ['server.mjs'], { cwd: ROOT, env: { ...process.env, KOLABZ_PORT: String(PORT), KOLABZ_DATA: DATA }, stdio: 'pipe' });
  const code = await new Promise(r => p2.once('exit', r));
  assert.equal(code, 3);
});
